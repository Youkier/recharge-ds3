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

/** Qui a lancé une opération : la page (WebView) ou, en E3, l'attente native. Une annulation ne touche que son origine. */
enum class Origine { PAGE, SERVICE }

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
 * UNE SEULE instance par processus (ProprietaireCable) : l'activité et le service d'attente la partagent. Annuler les
 * opérations de la page (nouvelle page, sortie de l'activité) ne coupe jamais une opération lancée par le service.
 *
 * Nouvelles tentatives (ici, pas dans la page) : « reessayer » = une seconde lecture plus longue, une seconde écriture,
 * un second balayage. Règle unique : JAMAIS de nouvel envoi après une écriture partie (Resultat.ecrit), ni pour un échec
 * qui n'est pas un échec de contact.
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
    private val delaiSecondeLectureMs: Long = DELAI_SECONDE_LECTURE_MS,
) {
    private val occupe = AtomicBoolean(false)
    private val generations = Origine.values().associateWith { AtomicInteger(0) }
    private val transports: MutableMap<Transport, Origine> = Collections.synchronizedMap(HashMap())

    /** Une opération en cours : son origine et la génération de cette origine au départ (annulée si elle a changé). */
    private class Op(val origine: Origine, val gen: Int)

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

    /** Nouvelle page ou sortie de l'activité : les connexions ouvertes par la page sont coupées, sa recherche s'arrête. */
    fun annulerPage() = annuler(Origine.PAGE)

    /** Coupe les connexions et arrête la recherche des opérations de cette origine seulement. */
    fun annuler(origine: Origine) {
        generations.getValue(origine).incrementAndGet()
        val liste = synchronized(transports) { transports.filterValues { it == origine }.keys.toList() }
        for (t in liste) try { t.fermer() } catch (e: Exception) { /* déjà fermé */ }
    }

    /** Annule toutes les origines (arrêt complet). */
    fun annulerTout() { for (o in Origine.values()) annuler(o) }

    fun enCours(): Boolean = occupe.get()

    private fun exclusif(origine: Origine, corps: (Op) -> Map<String, Any?>): Map<String, Any?> {
        if (!occupe.compareAndSet(false, true)) return erreur("occupe")
        try {
            return corps(Op(origine, generations.getValue(origine).get()))
        } finally {
            transports.clear()
            occupe.set(false)
        }
    }

    private fun annule(op: Op) = op.gen != generations.getValue(op.origine).get()

    /** Transport lié à l'opération : null si elle a été annulée entre-temps (rien n'est alors ouvert). */
    private fun nouveauTransport(op: Op): Transport? {
        if (annule(op)) return null
        val t = env.creerTransport() ?: return null
        transports[t] = op.origine
        if (annule(op)) { // annuler() est passé entre la vérification et l'enregistrement
            transports.remove(t)
            try { t.fermer() } catch (e: Exception) { /* jamais ouvert */ }
            return null
        }
        return t
    }

    private fun causeSansTransport(op: Op) = erreur(if (annule(op)) "hors_ligne" else "pas_wifi")

    /** Échec de contact qui mérite une seconde tentative, et seulement si aucune écriture n'est partie. */
    private fun retentable(r: Resultat) = !r.ok && !r.ecrit && r.erreur in ECHECS_A_RETENTER

    private fun avecDelai(cfg: ConfigCable, ms: Long) = ConfigCable(cfg.deviceId, cfg.cleLocale, cfg.ip, ms.coerceIn(1000, 30_000))

    // --- Opérations ---

    /** Configuration connue, sans la clé et SANS la déchiffrer : { configure, adresse? }. Une clé illisible (téléphone
     *  verrouillé, magasin invalidé) se voit à la lecture, qui rend « pas_de_cle ». */
    fun cable(): Map<String, Any?> {
        val r = LinkedHashMap<String, Any?>()
        r["ok"] = true
        r["configure"] = memoireValide() || env.configure()
        env.adresse()?.let { r["adresse"] = it }
        return r
    }

    /**
     * Lit la plage de charge. [ip] : adresse à utiliser à la place de l'adresse retenue (filtrée). [reessayer] : si le
     * contact échoue (hors_ligne, delai, cle), une seconde lecture de [delaiSecondeLectureMs] (premier contact souvent
     * lent ou refusé, constaté au premier essai réel du 2026-11-21).
     */
    fun lire(ip: String?, delaiMs: Long?, reessayer: Boolean = false, origine: Origine = Origine.PAGE): Map<String, Any?> =
        exclusif(origine) { op ->
            avecConfig(ip, delaiMs) { cfg ->
                val t = nouveauTransport(op) ?: return@avecConfig causeSansTransport(op)
                var r = ClientCable.lireEtat(cfg, t)
                if (reessayer && retentable(r) && !annule(op)) {
                    // Pause : une seconde lecture immédiate échoue avec la première (Wi-Fi qui se reconnecte, CI du 25/11).
                    pause(PAUSE_AVANT_NOUVELLE_TENTATIVE_MS)
                    val t2 = if (annule(op)) null else nouveauTransport(op)
                    if (t2 != null) r = ClientCable.lireEtat(avecDelai(cfg, delaiSecondeLectureMs), t2)
                }
                reponse(r, cfg.ip)
            }
        }

    /**
     * Règle la plage (début, fin, avec le démarrage tardif de Plage.decider), ou la rend « courte » : les deux seules
     * écritures. [reessayer] : seconde tentative
     * SEULEMENT si l'échec vient du contact et qu'aucune écriture n'est partie ; les deux tentatives tiennent dans
     * [BUDGET_ECRITURE_MS] (sous le plafond de 30 s de la page) et la seconde ne part pas s'il reste moins de
     * [RESTE_MINI_SECONDE_ECRITURE_MS] (elle pourrait écrire après l'affichage de l'échec).
     */
    fun programmer(ip: String?, action: Action, delaiMs: Long?, reessayer: Boolean = false, origine: Origine = Origine.PAGE): Map<String, Any?> =
        exclusif(origine) { op ->
            // Début du budget : dès l'exclusivité obtenue, déchiffrement de la clé compris (relecture du 2026-11-22).
            val debut = horloge()
            if (action is Action.Allumage && !Plage.demandeValide(action.hhmm, action.fin, action.dureeMin, action.depart)) {
                return@exclusif erreur("requete_invalide")
            }
            if (action is Action.Desactiver && !Plage.heureValide(action.fin)) return@exclusif erreur("requete_invalide")
            avecConfig(ip, delaiMs) { cfg0 ->
                // Avec une seconde tentative possible, la première ne mange pas tout le budget : elle laisse de quoi en faire une
                // seconde (sinon les 30 s permises à la page dépasseraient les 27 s annoncées).
                val cfg = if (reessayer) avecDelai(cfg0, minOf(cfg0.delaiGlobalMs, BUDGET_ECRITURE_MS - RESTE_MINI_SECONDE_ECRITURE_MS)) else cfg0
                val t = nouveauTransport(op) ?: return@avecConfig causeSansTransport(op)
                var r = ClientCable.programmer(cfg, t, action, maintenant, pause)
                if (reessayer && retentable(r) && !annule(op)) {
                    val reste = BUDGET_ECRITURE_MS - (horloge() - debut)
                    if (reste >= RESTE_MINI_SECONDE_ECRITURE_MS) {
                        val t2 = nouveauTransport(op)
                        if (t2 != null) r = ClientCable.programmer(avecDelai(cfg, reste), t2, action, maintenant, pause)
                    }
                }
                reponse(r, cfg.ip)
            }
        }

    /**
     * Cherche le câble sur le /24 du Wi-Fi : adresse de départ ([ip] ou retenue) si elle est sur ce réseau, puis fouille.
     * [reessayer] : un second balayage si le premier ne trouve rien (« introuvable » puis trouvé au second passage, premier
     * essai réel) ; l'échéance annoncée par [progres] couvre alors les deux balayages.
     * [progres] est appelé depuis des fils de travail, jamais après le retour.
     */
    fun chercher(ip: String?, reessayer: Boolean = false, origine: Origine = Origine.PAGE, progres: (Progres) -> Unit): Map<String, Any?> =
        exclusif(origine) { op ->
            if (ip != null && FiltreReseau.adressePrivee(ip) == null) return@exclusif erreur("refuse")
            val prefixe = env.prefixeWifi() ?: return@exclusif erreur("pas_wifi")
            val c = configuration() ?: return@exclusif erreur("pas_de_cle")
            try {
                val depart = ip ?: env.adresse()
                val departs = if (depart != null && prefixe24(depart) == prefixe) listOf(depart) else emptyList()
                var res: ResultatRecherche? = null
                var passages = if (reessayer) 2 else 1
                var passage = 0
                while (passage < passages) {
                    passage++
                    if (annule(op)) break
                    // Tant qu'un second passage est possible, l'échéance annoncée est celle du dernier passage possible.
                    val rallonge = if (passage < passages) RechercheCable.DELAI_TOTAL_MS else 0L
                    res = RechercheCable.chercher(
                        departs, prefixe,
                        sonder = { a, d -> env.sonder(a, d) },
                        lire = { a, d ->
                            val t = nouveauTransport(op)
                            if (t == null) Resultat(false, "hors_ligne")
                            else ClientCable.lireEtat(ConfigCable(c.first, c.second, a, d.coerceIn(1000, 30_000)), t)
                        },
                        progres = { p -> progres(if (rallonge == 0L) p else p.copy(echeanceMs = p.echeanceMs + rallonge)) },
                        annule = { annule(op) },
                    )
                    if (res.ok) break
                    // Réseau pas prêt : un nouveau passage même sans « reessayer » (une fois), après la pause.
                    if (res.reseauPasPret && passages == 1) passages = 2
                    if (passage >= passages || annule(op)) break
                    pause(PAUSE_AVANT_NOUVELLE_TENTATIVE_MS)
                }
                val etat = res?.etat
                if (res != null && !res.ok && res.reseauPasPret) return@exclusif erreur("reseau_pas_pret")
                if (res == null || !res.ok || res.ip == null || etat == null) return@exclusif erreur("introuvable")
                val r = reponse(etat, res.ip).toMutableMap() // reponse() retient l'adresse
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
        m["tardif"] = r.tardif
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
        /** Échecs de contact (connexion refusée, lente, ou fermée pendant la négociation, que le protocole lit « cle »). */
        val ECHECS_A_RETENTER = setOf("hors_ligne", "delai", "cle")
        const val DELAI_SECONDE_LECTURE_MS = 8_000L
        /** Pause avant une seconde lecture ou un second balayage (2026-11-27 : sans pause, la seconde tentative échoue avec la première). */
        const val PAUSE_AVANT_NOUVELLE_TENTATIVE_MS = 2_000L
        const val BUDGET_ECRITURE_MS = 27_000L // sous le plafond de 30 s de site/app.js
        const val RESTE_MINI_SECONDE_ECRITURE_MS = 5_000L

        fun erreur(code: String): Map<String, Any?> = mapOf("ok" to false, "erreur" to code)
    }
}
