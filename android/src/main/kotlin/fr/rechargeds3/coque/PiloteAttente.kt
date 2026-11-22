package fr.rechargeds3.coque

import fr.rechargeds3.coque.Attente.Issue
import fr.rechargeds3.coque.cable.Action
import fr.rechargeds3.coque.cable.JsonStrict
import fr.rechargeds3.coque.cable.Plage
import java.time.ZonedDateTime
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit

/** Phase de l'attente. « terminee » garde le résultat jusqu'à ce que la page l'ait vu ([PiloteAttente.acquitter]). */
enum class Phase(val code: String) {
    INACTIVE("inactive"), ATTENTE("attente"), ENVOI("envoi"), TERMINEE("terminee");

    companion object {
        fun de(code: String?): Phase? = values().firstOrNull { it.code == code }
    }
}

/** Fichier privé de l'attente : AUCUN secret (heures, phase, résultat brut). null : efface. */
interface StockageAttente {
    fun lire(): String?
    fun ecrire(contenu: String?)
}

/** Ce que l'hôte (le service) fait des changements : mettre à jour la notification, publier le résultat, s'arrêter. */
interface EcouteurAttente {
    /** L'envoi commence : « Annuler » n'agit plus. */
    fun envoiCommence()

    /** L'attente est terminée. [debut] et [fin] : heures de la notification (relues, ou à régler à la main) ; null : sans heure. */
    fun termine(issue: Issue, debut: String?, fin: String?)
}

/**
 * Pilote de l'attente en arrière-plan (lot E3, décisions des 2026-11-21 et 2026-11-22) : c'est LUI qui attend le Wi-Fi de la
 * maison puis le câble, et qui envoie ; la page n'est qu'une vue ([etat]). Kotlin pur : horloge, pause, opérations et
 * environnement sont injectés (testé en JUnit avec le faux câble). Hébergé par le service AttenteWifi, qui lui prête un fil
 * ([lancer]) et un verrou de réveil.
 *
 * Comportement :
 *  - attente du Wi-Fi de la maison (le téléphone est sur le /24 de l'adresse retenue du câble) ;
 *  - lecture du câble toutes les 5 s ; après 60 s de silence sur le réseau, UNE recherche sur ce /24 (2 balayages au plus) ;
 *  - dès que le câble répond : envoi par [OperationsCable.programmer] avec nouvelle tentative (règle unique « jamais de second
 *    envoi après une écriture partie ») ; la décision du démarrage tardif ([Plage.decider]) est prise par elle AU MOMENT DE L'ENVOI ;
 *  - 10 min d'attente au plus (échéance revérifiée juste avant l'envoi) ; le service est borné à 15 min ([finaliserInconnu]) ;
 *  - « Annuler » n'agit qu'AVANT l'envoi de l'écriture : dès que la phase est « envoi », il est refusé ;
 *  - la configuration du câble (clé comprise) est gardée par OperationsCable en octets, 15 min au plus, et mise à zéro à la fin
 *    de l'attente dans tous les cas ([terminer]) ; elle n'est jamais écrite dans le fichier de l'attente.
 *
 * Persistance : l'état complet (phase, demande, heures, début, résultat brut) est écrit à chaque changement de phase. Au
 * lancement d'un nouveau processus, une attente trouvée « en cours » ne peut plus aboutir (processus tué : économiseur de batterie,
 * force-stop) : elle devient « terminee » avec le résultat « non_suivie », montré à la page au lancement suivant (revue UX n°12).
 *
 * Contrat de [etat] (rendu tel quel à la page, qui l'interprète avec service.js) :
 *  { ok, phase: inactive|attente|envoi|terminee, demande?, heureManuelle?: {debut, fin}, etape?: wifi|cable|recherche,
 *    restant_ms? (attente), resultat? (terminee) }
 *  resultat = la forme de « programmer » ({ ok, debut, fin, plage_active, tardif, courte } ou { ok:false, erreur, ecrit? }),
 *  avec, pour une attente qui n'a rien envoyé, les erreurs attente_annulee, attente_expiree (jamais sur le Wi-Fi), attente_cable
 *  (sur le Wi-Fi, câble muet), attente_cle (clé refusée ou câble non relié), sans_adresse, et non_suivie (suivi perdu).
 */
class PiloteAttente(
    private val operations: OperationsCable,
    private val env: EnvironnementCable,
    private val stockage: StockageAttente,
    private val horloge: () -> Long = { System.currentTimeMillis() },
    private val maintenant: () -> ZonedDateTime = { ZonedDateTime.now(Plage.PARIS) },
    /** Pause injectée par les tests (temps virtuel) ; absente : attente réelle, interrompue par [annuler]. */
    private val pause: ((Long) -> Unit)? = null,
    private val dureeMaxMs: Long = DUREE_MAX_MS,
    private val silenceMs: Long = SILENCE_MS,
) {
    @Volatile
    var ecouteur: EcouteurAttente? = null

    private val verrou = Any()
    private val reveil = LinkedBlockingQueue<Boolean>(1)

    private var phase = Phase.INACTIVE
    private var action: Action? = null
    private var manuel: HeuresManuelles? = null
    private var debutMs = 0L
    private var etape = "wifi"
    private var resultat: Map<String, Any?>? = null
    private var session = 0

    init {
        restaurer()
    }

    // --- Lecture de l'état ---

    fun phaseActuelle(): Phase = synchronized(verrou) { phase }

    /** Une attente attend encore un résultat (attente du câble, ou envoi en cours). */
    fun enCours(): Boolean = synchronized(verrou) { phase == Phase.ATTENTE || phase == Phase.ENVOI }

    /** Début à régler à la main donné au toucher (texte de la notification continue). */
    fun debutManuel(): String? = synchronized(verrou) { manuel?.debut }

    fun etat(): Map<String, Any?> = synchronized(verrou) {
        val m = LinkedHashMap<String, Any?>()
        m["ok"] = true
        m["phase"] = phase.code
        val a = action
        val h = manuel
        if (phase != Phase.INACTIVE && a != null && h != null) {
            m["demande"] = actionEnMap(a)
            m["heureManuelle"] = linkedMapOf<String, Any?>("debut" to h.debut, "fin" to h.fin)
        }
        if (phase == Phase.ATTENTE) {
            m["etape"] = etape
            m["restant_ms"] = (dureeMaxMs - (horloge() - debutMs)).coerceIn(0L, dureeMaxMs)
        }
        if (phase == Phase.ENVOI) m["etape"] = "envoi"
        if (phase == Phase.TERMINEE) resultat?.let { m["resultat"] = it }
        m
    }

    // --- Démarrage, annulation, fin ---

    /**
     * Démarre une attente : valide la demande, lit la configuration du câble (téléphone déverrouillé : la clé du coffre est
     * illisible verrouillé) et la garde en mémoire, puis passe en phase « attente ». Bloquant (magasin de clés) : jamais sur
     * le fil principal. Ne lance pas la boucle : c'est [lancer], sur le fil du service.
     * -> { ok } | erreur requete_invalide, occupe, pas_de_cle.
     */
    fun demarrer(a: Action, manuelle: HeuresManuelles): Map<String, Any?> {
        if (!actionValide(a) || !Attente.heureValide(manuelle.debut) || !Attente.heureValide(manuelle.fin)) return erreur("requete_invalide")
        if (enCours()) return erreur("occupe")
        if (!env.configure()) return erreur("pas_de_cle")
        val m = operations.memoriser()
        if (m["ok"] != true) return m
        synchronized(verrou) {
            if (phase == Phase.ATTENTE || phase == Phase.ENVOI) return erreur("occupe") // course : l'autre attente garde sa mémoire
            session++
            phase = Phase.ATTENTE
            action = a
            manuel = manuelle
            debutMs = horloge()
            etape = "wifi"
            resultat = null
            persister()
        }
        return mapOf("ok" to true)
    }

    /** Annulation voulue par l'utilisateur : seulement AVANT l'envoi de l'écriture. -> vrai si l'attente est annulée. */
    fun annuler(): Boolean {
        val s = synchronized(verrou) { if (phase != Phase.ATTENTE) return false; session }
        val fait = terminer(s, Issue.ANNULEE, erreur("attente_annulee"), avantEnvoiSeulement = true)
        if (fait) { operations.annuler(Origine.SERVICE); reveiller() }
        return fait
    }

    /**
     * Nouvelle clé, « Oublier le câble », écran de saisie : l'attente s'arrête, et la mémoire de la configuration est effacée.
     * Avant l'envoi : annulée comme [annuler]. Pendant l'envoi : la connexion est coupée (résultat incertain si l'écriture était partie).
     */
    fun arreterPourCle() {
        if (!annuler() && phaseActuelle() == Phase.ENVOI) operations.annuler(Origine.SERVICE)
        operations.oublierMemoire()
    }

    /** Filet de 15 min du service : une attente sans résultat est close en « inconnu » (jamais de silence, règle 2). */
    fun finaliserInconnu() {
        val s = synchronized(verrou) { if (phase != Phase.ATTENTE && phase != Phase.ENVOI) return; session }
        if (terminer(s, Issue.INCONNUE, erreur("non_suivie"))) { operations.annuler(Origine.SERVICE); reveiller() }
    }

    /** La page a vu le résultat : il ne sera plus rendu. */
    fun acquitter() {
        synchronized(verrou) {
            if (phase != Phase.TERMINEE) return
            phase = Phase.INACTIVE
            action = null; manuel = null; resultat = null
            persister()
        }
    }

    // --- Boucle (fil du service) ---

    /** Attend le Wi-Fi et le câble, puis envoie. Bloquant jusqu'à la fin de l'attente ; sans effet si aucune attente n'est démarrée. */
    fun lancer() {
        val (s, a, debut) = synchronized(verrou) {
            if (phase != Phase.ATTENTE) return
            Triple(session, action!!, debutMs)
        }
        reveil.clear()
        try {
            boucle(s, a, debut)
        } catch (e: Throwable) {
            terminer(s, Issue.INCONNUE, erreur("non_suivie")) // jamais de silence ; la configuration est effacée par terminer
        } finally {
            if (!enCours()) operations.oublierMemoire()
        }
    }

    private fun boucle(s: Int, a: Action, debut: Long) {
        var cableDepuis: Long? = null
        var derniere: Long? = null
        var rechercheFaite = false
        var refusCle = 0
        while (actif(s)) {
            val now = horloge()
            if (now < debut || now - debut >= dureeMaxMs) {
                // Sur le Wi-Fi mais câble muet, ou jamais revenu sur le Wi-Fi : le message de la page diffère.
                terminer(s, Issue.NON_FAITE, erreur(if (cableDepuis != null) "attente_cable" else "attente_expiree"))
                return
            }
            if (env.adresse() == null) { terminer(s, Issue.NON_FAITE, erreur("sans_adresse")); return }
            if (!surReseauMaison()) {
                cableDepuis = null; derniere = null
                setEtape(s, "wifi")
                dormir(PAS_MS)
                continue
            }
            if (cableDepuis == null) cableDepuis = now
            // Câble muet depuis 60 s à son adresse : une seule recherche (2 balayages au plus) sur le /24 retenu.
            if (!rechercheFaite && now - cableDepuis >= silenceMs) {
                rechercheFaite = true
                setEtape(s, "recherche")
                val r = operations.chercher(null, true, Origine.SERVICE) { }
                if (!actif(s)) return
                if (r["ok"] == true) { envoyer(s, a); return }
                if (r["erreur"] == "pas_de_cle") { terminer(s, Issue.NON_FAITE, erreur("attente_cle")); return }
                derniere = horloge()
                setEtape(s, "cable")
                continue
            }
            if (derniere == null || now - derniere >= LECTURE_MS || now < derniere) {
                setEtape(s, "cable")
                val r = operations.lire(null, DELAI_LECTURE_MS, true, Origine.SERVICE)
                derniere = horloge()
                if (!actif(s)) return
                if (r["ok"] == true) { envoyer(s, a); return }
                val e = r["erreur"] as? String
                if (e == "pas_de_cle") { terminer(s, Issue.NON_FAITE, erreur("attente_cle")); return }
                // « cle » peut venir d'un câble qui redémarre (connexion fermée pendant la négociation) : deux refus d'affilée,
                // chacun déjà relu une seconde fois, avant de conclure que la clé est refusée.
                refusCle = if (e == "cle") refusCle + 1 else 0
                if (refusCle >= REFUS_CLE_MAX) { terminer(s, Issue.NON_FAITE, erreur("attente_cle")); return }
            }
            dormir(PAS_MS)
        }
    }

    /** Passage à la phase « envoi » (échéance revérifiée dans le même geste, annulation désormais refusée), puis envoi. */
    private fun envoyer(s: Int, a: Action) {
        val perime = synchronized(verrou) {
            if (session != s || phase != Phase.ATTENTE) return
            val now = horloge()
            if (now < debutMs || now - debutMs >= dureeMaxMs) true
            else { phase = Phase.ENVOI; persister(); false }
        }
        if (perime) { terminer(s, Issue.NON_FAITE, erreur("attente_cable")); return }
        ecouteur?.envoiCommence()
        val r = operations.programmer(null, a, DELAI_ENVOI_MS, true, Origine.SERVICE)
        terminer(s, Attente.issue(a, r), r)
    }

    // --- Fin ---

    /**
     * Passe en « terminee » avec ce résultat BRUT, efface la configuration gardée et prévient l'hôte. Sans effet (faux) si la
     * session n'est plus la courante ou si l'attente est déjà finie. [avantEnvoiSeulement] : refusé une fois l'envoi commencé.
     */
    private fun terminer(s: Int, issue: Issue, res: Map<String, Any?>, avantEnvoiSeulement: Boolean = false): Boolean {
        val (a, h) = synchronized(verrou) {
            if (session != s || (phase != Phase.ATTENTE && phase != Phase.ENVOI)) return false
            if (avantEnvoiSeulement && phase != Phase.ATTENTE) return false
            phase = Phase.TERMINEE
            resultat = res.filterValues { it != null }
            persister()
            Pair(action!!, manuel!!)
        }
        operations.oublierMemoire() // dans tous les cas : la clé ne survit pas à l'attente
        val (debut, fin) = heuresDeLaNotification(issue, a, h, res)
        ecouteur?.termine(issue, debut, fin)
        return true
    }

    private fun heuresDeLaNotification(issue: Issue, a: Action, h: HeuresManuelles, res: Map<String, Any?>): Pair<String?, String?> = when {
        Attente.sansHeure(issue) -> null to null
        issue == Issue.PROGRAMMEE || issue == Issue.TARDIVE -> (res["debut"] as? String) to (res["fin"] as? String)
        else -> Attente.heuresManuelles(a, h, maintenant()).let { it.debut to it.fin }
    }

    // --- Aides ---

    private fun actif(s: Int): Boolean = synchronized(verrou) { session == s && phase == Phase.ATTENTE }

    private fun setEtape(s: Int, e: String) { synchronized(verrou) { if (session == s && phase == Phase.ATTENTE) etape = e } }

    private fun reveiller() { reveil.offer(true) }

    private fun dormir(ms: Long) {
        val p = pause
        if (p != null) p(ms) else try { reveil.poll(ms, TimeUnit.MILLISECONDS) } catch (e: InterruptedException) { /* l'attente se termine */ }
    }

    /** Le téléphone est sur le /24 de l'adresse retenue du câble (donc sur le Wi-Fi de la maison). */
    private fun surReseauMaison(): Boolean {
        val adresse = env.adresse() ?: return false
        val prefixe = env.prefixeWifi() ?: return false
        val octets = FiltreReseau.adressePrivee(adresse) ?: return false
        return FiltreReseau.prefixe24(octets) == prefixe
    }

    private fun actionValide(a: Action): Boolean = when (a) {
        is Action.Allumage -> Plage.demandeValide(a.hhmm, a.fin, a.dureeMin, a.depart)
        is Action.Desactiver -> Plage.heureValide(a.fin)
    }

    private fun erreur(code: String): Map<String, Any?> = mapOf("ok" to false, "erreur" to code)

    // --- Persistance (aucun secret) ---

    private fun actionEnMap(a: Action): Map<String, Any?> = when (a) {
        is Action.Allumage -> linkedMapOf("allumage" to a.hhmm, "fin" to a.fin, "duree_min" to a.dureeMin.toLong(), "depart" to a.depart)
        is Action.Desactiver -> linkedMapOf("desactiver" to true, "fin" to a.fin)
    }

    private fun actionDepuisMap(m: Map<String, Any?>): Action? {
        val fin = m["fin"] as? String ?: return null
        if (m["desactiver"] == true) return Action.Desactiver(fin).takeIf { actionValide(it) }
        val allumage = m["allumage"] as? String ?: return null
        val depart = m["depart"] as? String ?: return null
        val duree = (m["duree_min"] as? Long)?.takeIf { it in 1..Plage.DUREE_MIN_MAX.toLong() } ?: return null
        return Action.Allumage(allumage, fin, duree.toInt(), depart).takeIf { actionValide(it) }
    }

    private fun persister() { // sous verrou
        try {
            if (phase == Phase.INACTIVE) { stockage.ecrire(null); return }
            val m = linkedMapOf<String, Any?>(
                "v" to 1L, "phase" to phase.code, "debut" to debutMs,
                "demande" to actionEnMap(action!!),
                "manuelle" to linkedMapOf<String, Any?>("debut" to manuel!!.debut, "fin" to manuel!!.fin),
            )
            resultat?.let { m["resultat"] = it }
            stockage.ecrire(JsonStrict.serialiser(m))
        } catch (e: Exception) { /* fichier inaccessible : l'attente continue, seul le suivi après un arrêt du processus est perdu */ }
    }

    /** Au lancement du processus : relit le fichier ; une attente « en cours » ne peut plus aboutir, elle devient « non suivie ». */
    private fun restaurer() {
        val brut = try { stockage.lire() } catch (e: Exception) { null } ?: return
        val m = try { JsonStrict.objet(JsonStrict.parser(brut)) } catch (e: Exception) { null }
        val a = JsonStrict.objet(m?.get("demande"))?.let { actionDepuisMap(it) }
        val h = JsonStrict.objet(m?.get("manuelle"))?.let {
            val d = it["debut"] as? String
            val f = it["fin"] as? String
            if (d != null && f != null && Attente.heureValide(d) && Attente.heureValide(f)) HeuresManuelles(d, f) else null
        }
        val p = Phase.de(m?.get("phase") as? String)
        if (m == null || a == null || h == null || p == null || p == Phase.INACTIVE) {
            try { stockage.ecrire(null) } catch (e: Exception) { /* sans effet */ }
            return
        }
        action = a
        manuel = h
        debutMs = (m["debut"] as? Long) ?: 0L
        phase = Phase.TERMINEE
        // Un résultat déjà là (page qui ne l'a pas encore vu) est gardé ; une attente en cours est perdue : suivi perdu.
        resultat = (if (p == Phase.TERMINEE) JsonStrict.objet(m["resultat"]) else null) ?: erreur("non_suivie")
        synchronized(verrou) { persister() }
    }

    companion object {
        const val DUREE_MAX_MS = 10 * 60_000L
        const val LECTURE_MS = 5_000L
        const val SILENCE_MS = 60_000L
        const val PAS_MS = 1_000L
        const val DELAI_LECTURE_MS = 4_000L
        const val DELAI_ENVOI_MS = 20_000L
        const val REFUS_CLE_MAX = 2
    }
}
