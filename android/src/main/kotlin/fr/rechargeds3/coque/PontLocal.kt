package fr.rechargeds3.coque

import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.webkit.WebView
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.WebMessageCompat
import androidx.webkit.WebViewCompat
import fr.rechargeds3.coque.cable.Action
import fr.rechargeds3.coque.cable.Plage
import org.json.JSONException
import org.json.JSONObject
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit

/**
 * Pont entre la page (WebView) et le câble : des OPÉRATIONS de haut niveau (lire l'état, programmer, chercher le câble),
 * exécutées par le protocole local en Kotlin (paquet cable, via OperationsCable). Plus aucune route générique : la page
 * ne peut ni ouvrir une connexion, ni envoyer d'octets, ni lire la clé (décision du 2026-11-21). Seul TransportTcp ouvre
 * une connexion, vers une adresse IPv4 privée, port 6668 (règle n°9 de CLAUDE.md).
 *
 * Mécanisme : WebViewCompat.addWebMessageListener, asynchrone, origine https://appassets.androidplatform.net seulement
 * (developer.android.com, WebViewCompat.addWebMessageListener ; WebMessageListener.onPostMessage s'exécute sur le fil
 * principal et JavaScriptReplyProxy est @UiThread : les réponses repartent par le fil principal).
 * Le contrat des messages est décrit en tête de android/essai/transport-pont.js.
 *
 * Garanties : messages de 4 Ko au plus, opérations hors du fil principal, une seule opération sur le câble à la fois
 * (« occupe » sinon), délais bornés, valeurs de la page revalidées côté natif (adresse, heure HH:MM, délai), la clé jamais
 * rendue. Rien n'est journalisé.
 */
class PontLocal(
    private val wifi: ReseauWifi,
    private val operations: OperationsCable,
    private val estDebug: Boolean,
    private val surSaisirCle: () -> Unit,
    private val prendreActionAuto: () -> JSONObject?,
    // Essai E0 (version de mise au point seulement) : démarre (« debut ») ou arrête (« fin ») le service d'attente,
    // ou rend seulement l'état de l'écran (« etat »). Appelé sur le fil principal.
    private val essaiArrierePlan: (String) -> JSONObject,
    // Attente en arrière-plan (version publiée) : notifications, demanderNotifications, attenteDebut, attenteEtat,
    // attenteFin. Traitées par l'activité, sur le fil principal ; aucune ne touche le réseau ni le coffre.
    private val attente: (op: String, q: JSONObject, repondre: (JSONObject) -> Unit) -> Unit,
) : WebViewCompat.WebMessageListener {

    private val principal = Handler(Looper.getMainLooper())

    // Opérations lentes (coffre, réseau) : jamais sur le fil principal. L'exclusivité sur le câble est dans OperationsCable.
    private val travail = ThreadPoolExecutor(4, 4, 5, TimeUnit.SECONDS, ArrayBlockingQueue(8)).apply { allowCoreThreadTimeOut(true) }

    override fun onPostMessage(view: WebView, message: WebMessageCompat, sourceOrigin: Uri, isMainFrame: Boolean, replyProxy: JavaScriptReplyProxy) {
        // Défense en profondeur : la règle d'origine de addWebMessageListener est déjà restrictive. Pas de réponse sinon.
        if (!isMainFrame || !FiltreReseau.origineAutorisee(sourceOrigin.scheme, sourceOrigin.host, sourceOrigin.port)) return
        if (message.type != WebMessageCompat.TYPE_STRING) return
        val texte = message.data ?: return
        if (texte.length > TAILLE_MESSAGE_MAX) return
        val q = try { JSONObject(texte) } catch (e: JSONException) { return }
        val n = q.optInt("n", -1)
        if (n < 0) return
        val rep = { r: JSONObject -> repondre(replyProxy, n, r) }
        try {
            val op = q.optString("op", "")
            // Table fermée des routes (RoutesPont) : une opération de mise au point est refusée dans la version publiée.
            if (!RoutesPont.autorisee(op, estDebug)) return rep(erreur("operation_inconnue"))
            when (op) {
                "demarrage" -> demarrage(rep)
                "variante" -> rep(JSONObject().put("ok", true).put("variante", variante()))
                "prefixeWifi" -> prefixeWifi(rep)
                "saisirCle" -> { operations.oublierMemoire(); surSaisirCle(); rep(ok()) }
                "cable" -> enArrierePlan(rep) { enJson(operations.cable()) }
                "lire" -> enArrierePlan(rep) { enJson(operations.lire(adresse(q), delai(q))) }
                "programmer" -> programmer(q, rep)
                "chercher" -> chercher(q, rep)
                "memoriser" -> enArrierePlan(rep) { enJson(operations.memoriser()) }
                "oublierMemoire" -> enArrierePlan(rep) { operations.oublierMemoire(); ok() }
                // Réservées à la version de mise au point, comme les actions adb : refusées dans la version publiée.
                "essaiArrierePlan" -> rep(if (estDebug) essaiArrierePlan(q.optString("quoi", "")) else erreur("operation_inconnue"))
                "essaiFiltre" -> if (estDebug) enArrierePlan(rep) { essaiFiltre() } else rep(erreur("operation_inconnue"))
                "attenteFin" -> {
                    operations.oublierMemoire() // la configuration gardée pour l'attente n'a plus d'usage
                    attente(op, q, rep)
                }
                "notifications", "demanderNotifications", "attenteDebut", "attenteEtat" -> attente(op, q, rep)
                // Toute autre opération, dont les anciennes routes génériques (ouvrir, envoyer, recevoir, sonder…) : refusée.
                else -> rep(erreur("operation_inconnue"))
            }
        } catch (e: RejectedExecutionException) {
            rep(erreur("occupe"))
        } catch (e: Exception) {
            rep(erreur("requete_invalide"))
        }
    }

    // --- Opérations rapides (fil principal) ---

    private fun variante() = if (estDebug) "debug" else "release"

    private fun demarrage(repondre: (JSONObject) -> Unit) {
        fermerToutAsync() // une nouvelle page repart sans opération héritée de la précédente
        val r = ok().put("variante", variante())
        r.put("auto", if (estDebug) prendreActionAuto() ?: JSONObject.NULL else JSONObject.NULL)
        repondre(r)
    }

    private fun prefixeWifi(repondre: (JSONObject) -> Unit) {
        val p = wifi.prefixe()
        repondre(if (p == null) erreur("pas_wifi") else ok().put("prefixe", p))
    }

    // --- Opérations sur le câble (fil de travail) ---

    private fun enArrierePlan(repondre: (JSONObject) -> Unit, corps: () -> JSONObject) {
        travail.execute {
            val r = try { corps() } catch (e: Exception) { erreur("requete_invalide") }
            repondre(r)
        }
    }

    // Adresse facultative : absente = adresse retenue. Une valeur qui n'est pas une chaîne est refusée par le filtre.
    private fun adresse(q: JSONObject): String? = if (q.has("ip")) q.optString("ip", "") else null

    private fun delai(q: JSONObject): Long? = if (q.has("delai")) q.optLong("delai") else null

    // Exactement une des deux actions du projet : { allumage: "HH:MM" } ou { desactiver: true }.
    private fun programmer(q: JSONObject, repondre: (JSONObject) -> Unit) {
        val action: Action? = when {
            q.has("allumage") && !q.has("desactiver") ->
                (q.opt("allumage") as? String)?.takeIf { Plage.heureValide(it) }?.let { Action.Allumage(it) }
            q.has("desactiver") && !q.has("allumage") ->
                if (q.opt("desactiver") == true) Action.Desactiver else null
            else -> null
        }
        if (action == null) return repondre(erreur("requete_invalide"))
        enArrierePlan(repondre) { enJson(operations.programmer(adresse(q), action, delai(q))) }
    }

    // Réponses de progression { n, progres: true, etape, appareils, lectures, echeance } puis la réponse finale.
    private fun chercher(q: JSONObject, repondre: (JSONObject) -> Unit) {
        val ip = adresse(q)
        enArrierePlan(repondre) {
            enJson(operations.chercher(ip) { p ->
                repondre(
                    JSONObject().put("progres", true).put("etape", p.etape).put("appareils", p.appareils)
                        .put("lectures", p.lectures).put("echeance", p.echeanceMs),
                )
            })
        }
    }

    // Mise au point : le transport natif refuse tout sauf IPv4 privée:6668, sans qu'aucun octet ne parte.
    private fun essaiFiltre(): JSONObject {
        val echecs = org.json.JSONArray()
        val refus = listOf(
            "port6669" to ("10.0.2.2" to 6669), "loopback" to ("127.0.0.1" to 6668),
            "zeroDeTete" to ("010.0.0.1" to 6668), "publique" to ("8.8.8.8" to 6668),
            "lienLocal" to ("169.254.1.1" to 6668), "nom" to ("exemple.test" to 6668),
        )
        for ((nom, cible) in refus) {
            val refuse = try {
                TransportTcp { }.ouvrir(cible.first, cible.second, 1000); false
            } catch (e: fr.rechargeds3.coque.cable.TransportException) { e.code == "hors_ligne" }
            if (!refuse) echecs.put(nom)
        }
        if (TransportTcp.sonder("127.0.0.1", 400) { }) echecs.put("sondeLoopback")
        if (TransportTcp.sonder("169.254.1.1", 400) { }) echecs.put("sondeLienLocal")
        return ok().put("conforme", echecs.length() == 0).put("echecs", echecs)
    }

    // --- Cycle de vie ---

    /** Coupe les connexions ouvertes et arrête la recherche en cours (sortie de l'activité, nouvelle page). Sans attendre. */
    fun fermerToutAsync() {
        Thread { operations.annulerTout() }.start()
    }

    /** Fin de l'activité : tout est coupé, la configuration gardée en mémoire est effacée, plus aucune opération acceptée. */
    fun arreter() {
        travail.shutdownNow()
        operations.oublierMemoire()
        Thread { operations.annulerTout() }.start()
    }

    fun connexionOuverte(): Boolean = operations.enCours()

    /** Fin du service d'attente : la configuration gardée en mémoire est effacée. */
    fun oublierMemoire() = operations.oublierMemoire()

    // --- Réponses ---

    private fun ok(): JSONObject = JSONObject().put("ok", true)
    private fun erreur(code: String): JSONObject = JSONObject().put("ok", false).put("erreur", code)

    private fun enJson(m: Map<String, Any?>): JSONObject {
        val j = JSONObject()
        for ((k, v) in m) if (v != null) j.put(k, v)
        return j
    }

    private fun repondre(proxy: JavaScriptReplyProxy, n: Int, r: JSONObject) {
        r.put("n", n)
        val texte = r.toString()
        principal.post {
            try { proxy.postMessage(texte) } catch (e: Exception) { /* page rechargée ou détruite */ }
        }
    }

    companion object {
        const val NOM_JS = "PontLocal"
        private const val TAILLE_MESSAGE_MAX = 4096
    }
}
