package fr.rechargeds3.coque

import fr.rechargeds3.coque.cable.Action
import fr.rechargeds3.coque.cable.ClientCable
import fr.rechargeds3.coque.cable.ConfigCable
import fr.rechargeds3.coque.cable.Plage
import fr.rechargeds3.coque.cable.Resultat
import fr.rechargeds3.coque.cable.Transport
import java.time.ZonedDateTime
import java.util.Collections
import java.util.Timer
import java.util.TimerTask
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger

/** Ce dont les opérations ont besoin du téléphone ; l'implémentation Android est dans MainActivity (Wi-Fi, coffre). */
interface EnvironnementCable {
    /** Un bloc est enregistré (sans le déchiffrer). */
    fun configure(): Boolean
    /** (identifiant, clé) déchiffrés, ou null. Hors du fil principal. */
    fun lireCle(): Pair<String, String>?
    fun adresse(): String?
    /** Mémorise l'adresse du câble (lecture ou écriture réussie avec la bonne clé). */
    fun retenirAdresse(ip: String)
    /** « 10.0.2 » : /24 du Wi-Fi, ou null sans Wi-Fi. */
    fun prefixeWifi(): String?
    /** Un transport vers le câble, lié au Wi-Fi ; null sans Wi-Fi. */
    fun creerTransport(): Transport?
    /** Port 6668 ouvert ? Connexion puis fermeture, sans octet. */
    fun sonder(ip: String, delaiMs: Int): Boolean
}

/**
 * Opérations de haut niveau du pont (décision du 2026-11-21 : le protocole local n'a qu'une implémentation dans l'appli,
 * en Kotlin). La page ne voit jamais la clé : elle demande « lire », « programmer », « chercher » et reçoit des résultats.
 * Kotlin pur (testé en JUnit local avec le faux câble). Chaque méthode est BLOQUANTE : l'appelant les exécute hors du fil
 * principal. Les résultats sont des tables simples ; le pont les met en JSON.
 *
 * Garanties : une seule opération sur le câble à la fois (la seconde reçoit « occupe », rien n'est lancé) ; seules les deux
 * actions du projet existent côté écriture (ClientCable) ; l'adresse passe toujours par FiltreReseau ; l'adresse n'est
 * retenue qu'après une lecture ou une écriture réussie ; la clé n'est copiée qu'en octets, mis à zéro après usage.
 *
 * Mémoire de configuration : « memoriser » garde (identifiant, clé) en octets au plus [dureeMemoireMs] pour qu'une attente
 * en arrière-plan puisse envoyer téléphone verrouillé (la clé du magasin est alors illisible), puis les met à zéro.
 */
class OperationsCable(
    private val env: EnvironnementCable,
    private val dureeMemoireMs: Long = 15 * 60_000L,
    private val horloge: () -> Long = { System.currentTimeMillis() },
    private val maintenant: () -> ZonedDateTime = { ZonedDateTime.now(Plage.PARIS) },
    private val pause: (Long) -> Unit = { ms -> Thread.sleep(ms) },
) {
    private val occupe = AtomicBoolean(false)
    private val generation = AtomicInteger(0)
    private val transports: MutableSet<Transport> = Collections.synchronizedSet(HashSet())

    // --- Mémoire de configuration ---

    private class Memoire(val deviceId: String, val cle: ByteArray, val expire: Long)

    private val verrouMemoire = Any()
    private var memoire: Memoire? = null
    private var minuteur: Timer? = null
    private var tache: TimerTask? = null

    /** Lit la configuration du coffre (téléphone déverrouillé) et la garde en octets, 15 min au plus. */
    fun memoriser(): Map<String, Any?> {
        val v = env.lireCle() ?: return erreur("pas_de_cle")
        val cle = v.second.toByteArray(Charsets.ISO_8859_1)
        synchronized(verrouMemoire) {
            effacerMemoire()
            memoire = Memoire(v.first, cle, horloge() + dureeMemoireMs)
            val m = minuteur ?: Timer("memoire-cable", true).also { minuteur = it }
            val t = object : TimerTask() { override fun run() { oublierMemoire() } }
            tache = t
            m.schedule(t, dureeMemoireMs)
        }
        return ok()
    }

    fun oublierMemoire() {
        synchronized(verrouMemoire) { effacerMemoire() }
    }

    private fun effacerMemoire() { // sous verrouMemoire
        tache?.cancel(); tache = null
        memoire?.cle?.fill(0)
        memoire = null
    }

    private fun memoireValide(): Boolean = synchronized(verrouMemoire) { val m = memoire; m != null && horloge() < m.expire }

    /** (identifiant, COPIE de la clé en octets) de la mémoire si elle est valable, sinon du coffre ; null si illisible. */
    private fun configuration(): Pair<String, ByteArray>? {
        synchronized(verrouMemoire) {
            val m = memoire
            if (m != null) {
                if (horloge() < m.expire) return m.deviceId to m.cle.copyOf()
                effacerMemoire()
            }
        }
        val v = env.lireCle() ?: return null
        return v.first to v.second.toByteArray(Charsets.ISO_8859_1)
    }

    // --- Annulation et exclusivité ---

    /** Sortie de l'appli ou nouvelle page : les connexions ouvertes sont coupées, la recherche en cours s'arrête. */
    fun annulerTout() {
        generation.incrementAndGet()
        val liste = synchronized(transports) { transports.toList() }
        for (t in liste) try { t.fermer() } catch (e: Exception) { /* déjà fermé */ }
    }

    fun enCours(): Boolean = occupe.get()

    private fun exclusif(corps: (Int) -> Map<String, Any?>): Map<String, Any?> {
        if (!occupe.compareAndSet(false, true)) return erreur("occupe")
        try {
            return corps(generation.get())
        } finally {
            transports.clear()
            occupe.set(false)
        }
    }

    /** Transport lié à la génération [gen] : null si l'opération a été annulée entre-temps (rien n'est alors ouvert). */
    private fun nouveauTransport(gen: Int): Transport? {
        if (gen != generation.get()) return null
        val t = env.creerTransport() ?: return null
        transports.add(t)
        if (gen != generation.get()) { // annulerTout est passé entre la vérification et l'enregistrement
            transports.remove(t)
            try { t.fermer() } catch (e: Exception) { /* jamais ouvert */ }
            return null
        }
        return t
    }

    private fun causeSansTransport(gen: Int) = erreur(if (gen != generation.get()) "hors_ligne" else "pas_wifi")

    // --- Opérations ---

    /** Configuration connue, sans la clé : { configure, illisible?, adresse? }. */
    fun cable(): Map<String, Any?> {
        val r = LinkedHashMap<String, Any?>()
        r["ok"] = true
        val configure = env.configure()
        if (memoireValide()) r["configure"] = true
        else if (!configure) r["configure"] = false
        else if (env.lireCle() == null) { r["configure"] = false; r["illisible"] = true }
        else r["configure"] = true
        env.adresse()?.let { r["adresse"] = it }
        return r
    }

    /** Lit la plage de charge. [ip] : adresse à utiliser à la place de l'adresse retenue (filtrée). */
    fun lire(ip: String?, delaiMs: Long?): Map<String, Any?> = exclusif { gen ->
        avecConfig(ip, delaiMs) { cfg ->
            val t = nouveauTransport(gen) ?: return@avecConfig causeSansTransport(gen)
            reponse(ClientCable.lireEtat(cfg, t), cfg.ip)
        }
    }

    /** Règle le début de la plage, ou la rend « courte » : les deux seules écritures. */
    fun programmer(ip: String?, action: Action, delaiMs: Long?): Map<String, Any?> = exclusif { gen ->
        if (action is Action.Allumage && !Plage.heureValide(action.hhmm)) return@exclusif erreur("requete_invalide")
        avecConfig(ip, delaiMs) { cfg ->
            val t = nouveauTransport(gen) ?: return@avecConfig causeSansTransport(gen)
            reponse(ClientCable.programmer(cfg, t, action, maintenant, pause), cfg.ip)
        }
    }

    /**
     * Cherche le câble sur le /24 du Wi-Fi : adresse de départ ([ip] ou retenue) si elle est sur ce réseau, puis fouille.
     * [progres] est appelé depuis des fils de travail, jamais après le retour.
     */
    fun chercher(ip: String?, progres: (Progres) -> Unit): Map<String, Any?> = exclusif { gen ->
        if (ip != null && FiltreReseau.adressePrivee(ip) == null) return@exclusif erreur("refuse")
        val prefixe = env.prefixeWifi() ?: return@exclusif erreur("pas_wifi")
        val c = configuration() ?: return@exclusif erreur("pas_de_cle")
        try {
            val depart = ip ?: env.adresse()
            val departs = if (depart != null && prefixe24(depart) == prefixe) listOf(depart) else emptyList()
            val res = RechercheCable.chercher(
                departs, prefixe,
                sonder = { a, d -> env.sonder(a, d) },
                lire = { a, d ->
                    val t = nouveauTransport(gen)
                    if (t == null) Resultat(false, "hors_ligne")
                    else ClientCable.lireEtat(ConfigCable(c.first, c.second, a, d.coerceIn(1000, 30_000)), t)
                },
                progres = progres,
                annule = { gen != generation.get() },
            )
            val etat = res.etat
            if (!res.ok || res.ip == null || etat == null) return@exclusif erreur("introuvable")
            retenir(res.ip)
            val r = reponse(etat, res.ip).toMutableMap()
            r["ip"] = res.ip
            r["trouve"] = res.trouve
            r
        } finally {
            c.second.fill(0)
        }
    }

    // --- Aides ---

    private fun avecConfig(ipDemandee: String?, delaiMs: Long?, corps: (ConfigCable) -> Map<String, Any?>): Map<String, Any?> {
        if (ipDemandee != null && FiltreReseau.adressePrivee(ipDemandee) == null) return erreur("refuse")
        val ip = ipDemandee ?: env.adresse() ?: return erreur("sans_adresse")
        val c = configuration() ?: return erreur("pas_de_cle")
        try {
            return corps(ConfigCable(c.first, c.second, ip, FiltreReseau.delaiBorne(delaiMs, 1000, 30_000, 20_000)))
        } finally {
            c.second.fill(0) // ClientCable travaille sur sa propre copie
        }
    }

    private fun reponse(r: Resultat, ip: String): Map<String, Any?> {
        if (!r.ok) {
            val m = LinkedHashMap<String, Any?>()
            m["ok"] = false
            m["erreur"] = r.erreur ?: "format"
            if (r.ecrit) m["ecrit"] = true
            return m
        }
        retenir(ip)
        val m = LinkedHashMap<String, Any?>()
        m["ok"] = true
        m["debut"] = r.debut
        m["fin"] = r.fin
        m["plage_active"] = r.plageActive == true
        m["immediat"] = r.immediat
        m["courte"] = r.courte
        return m
    }

    private fun retenir(ip: String) {
        try { env.retenirAdresse(ip) } catch (e: Exception) { /* l'adresse ne sera pas retenue : sans conséquence sur le résultat */ }
    }

    private fun prefixe24(ip: String): String? =
        FiltreReseau.adressePrivee(ip)?.let { FiltreReseau.prefixe24(it) }

    private fun ok(): Map<String, Any?> = mapOf("ok" to true)

    companion object {
        fun erreur(code: String): Map<String, Any?> = mapOf("ok" to false, "erreur" to code)
    }
}
