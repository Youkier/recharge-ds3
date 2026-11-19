package fr.rechargeds3.coque

import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.util.Base64
import android.webkit.WebView
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.WebMessageCompat
import androidx.webkit.WebViewCompat
import org.json.JSONException
import org.json.JSONObject
import java.io.IOException
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.Socket
import java.net.SocketTimeoutException
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.ScheduledThreadPoolExecutor
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit

/**
 * Pont entre la page (WebView) et le réseau : une connexion TCP vers une adresse IPv4 privée, port 6668, rien d'autre
 * (règle n°9 de CLAUDE.md, exception du 2026-11-15). Toute la logique (quoi lire, quoi écrire) reste dans
 * local/tuya-local.js ; ici, seulement des octets.
 *
 * Mécanisme : WebViewCompat.addWebMessageListener, asynchrone, origine https://appassets.androidplatform.net seulement
 * (developer.android.com, WebViewCompat.addWebMessageListener ; WebMessageListener.onPostMessage s'exécute sur le fil
 * principal et JavaScriptReplyProxy est @UiThread : les réponses repartent par le fil principal).
 * Le contrat des messages est décrit en tête de android/essai/transport-pont.js.
 *
 * Garanties : filtre d'adresse sans DNS (FiltreReseau), port 6668 seulement, messages de 2 Ko au plus, délais bornés partout,
 * une seule connexion de données à la fois (Registre : un identifiant par connexion, fermer idempotent), sondes plafonnées
 * à 32 en parallèle, durée de vie d'une connexion limitée à 30 s, connexions liées au réseau Wi-Fi. Rien n'est journalisé.
 */
class PontLocal(
    private val wifi: ReseauWifi,
    private val estDebug: Boolean,
    private val surSaisirCle: () -> Unit,
    private val prendreActionAuto: () -> JSONObject?,
) : WebViewCompat.WebMessageListener {

    private val principal = Handler(Looper.getMainLooper())
    private val registre = Registre<Socket>()

    // Sondes : au plus 32 en parallèle, 64 en attente ; au-delà, « occupe ».
    private val sondes = ThreadPoolExecutor(
        32, 32, 5, TimeUnit.SECONDS, ArrayBlockingQueue(64),
    ).apply { allowCoreThreadTimeOut(true) }

    // Connexion de données : un seul fil, donc les opérations d'une connexion restent dans l'ordre.
    private val donnees = ThreadPoolExecutor(1, 1, 5, TimeUnit.SECONDS, ArrayBlockingQueue(16)).apply { allowCoreThreadTimeOut(true) }

    // Fermetures et limite de durée de vie : jamais bloquées par une lecture en cours.
    private val controle: ScheduledExecutorService = ScheduledThreadPoolExecutor(1)
    private var vieMax: ScheduledFuture<*>? = null

    override fun onPostMessage(view: WebView, message: WebMessageCompat, sourceOrigin: Uri, isMainFrame: Boolean, replyProxy: JavaScriptReplyProxy) {
        // Défense en profondeur : la règle d'origine de addWebMessageListener est déjà restrictive. Pas de réponse sinon.
        if (!isMainFrame || !FiltreReseau.origineAutorisee(sourceOrigin.scheme, sourceOrigin.host, sourceOrigin.port)) return
        if (message.type != WebMessageCompat.TYPE_STRING) return
        val texte = message.data ?: return
        if (texte.length > TAILLE_MESSAGE_MAX) return
        val q = try { JSONObject(texte) } catch (_: JSONException) { return }
        val n = q.optInt("n", -1)
        if (n < 0) return
        val rep = { r: JSONObject -> repondre(replyProxy, n, r) }
        try {
            when (q.optString("op", "")) {
                "demarrage" -> demarrage(rep)
                "variante" -> rep(JSONObject().put("ok", true).put("variante", variante()))
                "prefixeWifi" -> prefixeWifi(rep)
                "cable" -> cable(rep)
                "saisirCle" -> { surSaisirCle(); rep(ok()) }
                "sonder" -> sonder(q, rep)
                "ouvrir" -> ouvrir(q, rep)
                "envoyer" -> envoyer(q, rep)
                "recevoir" -> recevoir(q, rep)
                "fermer" -> fermer(q, rep)
                else -> rep(erreur("operation_inconnue"))
            }
        } catch (_: RejectedExecutionException) {
            rep(erreur("occupe"))
        } catch (_: Exception) {
            rep(erreur("requete_invalide"))
        }
    }

    // --- Opérations rapides (fil principal) ---

    private fun variante() = if (estDebug) "debug" else "release"

    private fun demarrage(repondre: (JSONObject) -> Unit) {
        fermerToutAsync() // une nouvelle page repart sans connexion héritée de la précédente
        val r = ok().put("variante", variante())
        r.put("auto", if (estDebug) prendreActionAuto() ?: JSONObject.NULL else JSONObject.NULL)
        repondre(r)
    }

    private fun prefixeWifi(repondre: (JSONObject) -> Unit) {
        val p = wifi.prefixe()
        repondre(if (p == null) erreur("pas_wifi") else ok().put("prefixe", p))
    }

    // La clé n'est rendue qu'à la page d'essai, au moment d'une action ; elle n'est ni journalisée ni conservée ici.
    private fun cable(repondre: (JSONObject) -> Unit) {
        val id = CableConfig.identifiant()
        val cle = CableConfig.cle()
        repondre(if (id == null || cle == null) ok().put("configure", false) else ok().put("configure", true).put("deviceId", id).put("cle", cle))
    }

    // --- Sonde : connexion puis fermeture, sans envoyer d'octet ---

    private fun sonder(q: JSONObject, repondre: (JSONObject) -> Unit) {
        val octets = FiltreReseau.adressePrivee(q.optString("ip", null)) ?: return repondre(erreur("refuse"))
        val reseau = wifi.courant() ?: return repondre(erreur("pas_wifi"))
        val delai = FiltreReseau.delaiBorne(if (q.has("delai")) q.optLong("delai") else null, 50, 1000, 400).toInt()
        sondes.execute {
            var ouvert = false
            val s = Socket()
            try {
                reseau.bindSocket(s)
                s.connect(InetSocketAddress(InetAddress.getByAddress(octets), FiltreReseau.PORT), delai)
                ouvert = true
            } catch (_: IOException) {
                ouvert = false
            } finally {
                fermerSansErreur(s)
            }
            repondre(ok().put("ouvert", ouvert))
        }
    }

    // --- Connexion de données ---

    private fun ouvrir(q: JSONObject, repondre: (JSONObject) -> Unit) {
        val octets = FiltreReseau.adressePrivee(q.optString("ip", null)) ?: return repondre(erreur("refuse"))
        if (!FiltreReseau.portAutorise(q.optInt("port", -1))) return repondre(erreur("refuse"))
        val reseau = wifi.courant() ?: return repondre(erreur("pas_wifi"))
        val delai = FiltreReseau.delaiBorne(if (q.has("delai")) q.optLong("delai") else null, 200, 5000, 5000).toInt()
        val id = registre.reserver() ?: return repondre(erreur("occupe"))
        try {
            donnees.execute {
                val s = Socket()
                try {
                    reseau.bindSocket(s)
                    s.tcpNoDelay = true
                    s.connect(InetSocketAddress(InetAddress.getByAddress(octets), FiltreReseau.PORT), delai)
                    if (registre.installer(id, s)) {
                        planifierFermeture(id)
                        repondre(ok().put("cx", id))
                    } else {
                        repondre(erreur("ferme")) // fermée pendant l'ouverture : installer() a déjà fermé le socket
                    }
                } catch (_: IOException) {
                    fermerSansErreur(s)
                    registre.liberer(id)
                    repondre(erreur("injoignable"))
                }
            }
        } catch (e: RejectedExecutionException) {
            registre.liberer(id)
            throw e
        }
    }

    private fun envoyer(q: JSONObject, repondre: (JSONObject) -> Unit) {
        val socket = registre.obtenir(q.optInt("cx", -1)) ?: return repondre(erreur("cx_inconnu"))
        val d = q.optString("d", null) ?: return repondre(erreur("requete_invalide"))
        if (d.length > BASE64_MAX) return repondre(erreur("refuse"))
        val octets = try { Base64.decode(d, Base64.NO_WRAP) } catch (_: IllegalArgumentException) { return repondre(erreur("requete_invalide")) }
        if (!FiltreReseau.tailleAutorisee(octets.size) || octets.isEmpty()) return repondre(erreur("refuse"))
        donnees.execute {
            try {
                socket.getOutputStream().apply { write(octets); flush() }
                repondre(ok())
            } catch (_: IOException) {
                repondre(erreur("ferme"))
            }
        }
    }

    private fun recevoir(q: JSONObject, repondre: (JSONObject) -> Unit) {
        val socket = registre.obtenir(q.optInt("cx", -1)) ?: return repondre(erreur("cx_inconnu"))
        val delai = FiltreReseau.delaiBorne(if (q.has("delai")) q.optLong("delai") else null, 50, 10_000, 5000).toInt()
        donnees.execute {
            try {
                socket.soTimeout = delai
                val tampon = ByteArray(FiltreReseau.TAILLE_MAX)
                val n = socket.getInputStream().read(tampon)
                if (n < 0) repondre(erreur("ferme"))
                else repondre(ok().put("d", Base64.encodeToString(tampon, 0, n, Base64.NO_WRAP)))
            } catch (_: SocketTimeoutException) {
                repondre(erreur("delai"))
            } catch (_: IOException) {
                repondre(erreur("ferme")) // aussi quand fermer() coupe la lecture en cours
            }
        }
    }

    // Idempotent ; passe par le fil de contrôle pour ne jamais attendre une lecture en cours ni fermer sur le fil principal.
    private fun fermer(q: JSONObject, repondre: (JSONObject) -> Unit) {
        val cx = q.optInt("cx", -1)
        controle.execute {
            if (registre.fermer(cx)) annulerFermeture()
            repondre(ok())
        }
    }

    private fun planifierFermeture(id: Int) {
        synchronized(this) {
            vieMax?.cancel(false)
            vieMax = controle.schedule(Runnable { registre.fermer(id) }, DUREE_VIE_MAX_S, TimeUnit.SECONDS)
        }
    }

    private fun annulerFermeture() {
        synchronized(this) { vieMax?.cancel(false); vieMax = null }
    }

    // --- Cycle de vie ---

    /** Ferme la connexion de données (sortie de l'activité, nouvelle page). Sans attendre, sur un fil à part. */
    fun fermerToutAsync() {
        Thread { annulerFermeture(); registre.fermerTout() }.start()
    }

    /** Fin de l'activité : tout est fermé, plus aucune opération acceptée. */
    fun arreter() {
        sondes.shutdownNow()
        donnees.shutdownNow()
        controle.shutdownNow()
        Thread { registre.fermerTout() }.start()
    }

    fun connexionOuverte(): Boolean = registre.ouverte()

    // --- Réponses ---

    private fun ok(): JSONObject = JSONObject().put("ok", true)
    private fun erreur(code: String): JSONObject = JSONObject().put("ok", false).put("erreur", code)

    private fun repondre(proxy: JavaScriptReplyProxy, n: Int, r: JSONObject) {
        r.put("n", n)
        val texte = r.toString()
        principal.post {
            try { proxy.postMessage(texte) } catch (_: Exception) { /* page rechargée ou détruite */ }
        }
    }

    private fun fermerSansErreur(s: Socket) { try { s.close() } catch (_: IOException) { /* déjà fermé */ } }

    companion object {
        const val NOM_JS = "PontLocal"
        private const val TAILLE_MESSAGE_MAX = 4096
        private const val BASE64_MAX = 2800 // 2048 octets en base64 : 2732 caractères
        private const val DUREE_VIE_MAX_S = 30L
    }
}
