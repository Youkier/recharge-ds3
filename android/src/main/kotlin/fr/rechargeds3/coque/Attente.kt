package fr.rechargeds3.coque

import fr.rechargeds3.coque.cable.Action
import fr.rechargeds3.coque.cable.Decision
import fr.rechargeds3.coque.cable.Plage
import java.time.ZonedDateTime

/** Heures à régler à la main dans Smart Life : début ET fin de la plage de charge du câble. */
data class HeuresManuelles(val debut: String, val fin: String)

/**
 * Logique pure de l'attente en arrière-plan (décisions des 2026-11-21 et 2026-11-22) : issue d'une attente à partir du
 * résultat BRUT de OperationsCable.programmer (jamais de faux OK : seule une relecture conforme à la demande donne
 * « programmée »), heures à régler à la main en cas d'échec, textes fixes des notifications (res/values/strings.xml).
 * Aucune chaîne venue de la page n'est jamais affichée : la page ne fournit que des heures HH:MM validées.
 */
object Attente {
    private val HEURE = Regex("^([01][0-9]|2[0-3]):[0-5][0-9]$")

    fun heureValide(h: String?): Boolean = h != null && HEURE.matches(h)

    /** Issue d'une attente, telle qu'annoncée par la notification de résultat. */
    enum class Issue { PROGRAMMEE, AUCUNE, TARDIVE, TROP_TARD, NON_FAITE, INCERTAINE, ANNULEE, INCONNUE }

    private fun mod24(x: Int): Int = ((x % 1440) + 1440) % 1440

    /**
     * Issue d'une attente qui est allée jusqu'à l'envoi, d'après le résultat brut de [OperationsCable.programmer].
     *  - « ok » seulement si les valeurs relues sont celles de la demande : plage active, début et fin demandés ; pour un début
     *    reporté (tardif), début -> fin -> départ cohérents dans la nuit ; pour « pas de charge », plage courte relue
     *    (début = fin - 1 min, fin = fin demandée). Toute autre valeur relue : INCERTAINE (on dit de vérifier dans Smart Life) ;
     *  - « trop_tard » : rien n'a été écrit ;
     *  - échec avec écriture partie, ou dont l'état réel est inconnu (délai, relecture différente, format) : INCERTAINE ;
     *  - tout autre échec (câble muet, clé refusée…) : NON_FAITE, rien n'a été modifié.
     */
    fun issue(action: Action, r: Map<String, Any?>): Issue {
        if (r["ok"] != true) {
            // Réponse anormale (« ok » ni vrai ni faux) : on ne sait pas si l'écriture est partie (règle 2).
            if (r["ok"] != false) return Issue.INCERTAINE
            val e = r["erreur"] as? String
            if (e == "trop_tard") return Issue.TROP_TARD
            return if (r["ecrit"] == true || e in ERREURS_INCERTAINES) Issue.INCERTAINE else Issue.NON_FAITE
        }
        val debut = r["debut"] as? String
        val fin = r["fin"] as? String
        if (!heureValide(debut) || !heureValide(fin) || r["plage_active"] != true) return Issue.INCERTAINE
        return when (action) {
            is Action.Desactiver ->
                if (r["courte"] == true && debut == Plage.moinsUneMinute(fin!!) && fin == action.fin) Issue.AUCUNE else Issue.INCERTAINE
            is Action.Allumage ->
                if (r["tardif"] == true) {
                    val nuit = mod24(Plage.minutes(action.depart) - Plage.minutes(debut!!))
                    val jusquaFin = mod24(Plage.minutes(fin!!) - Plage.minutes(debut))
                    if (nuit > 0 && jusquaFin in 1..nuit) Issue.TARDIVE else Issue.INCERTAINE
                } else if (debut == action.hhmm && fin == action.fin) Issue.PROGRAMMEE else Issue.INCERTAINE
        }
    }

    /** Échecs dont l'état réel du câble est peut-être différent de ce qu'on croit (comme `incertain` de site/service.js). */
    private val ERREURS_INCERTAINES = setOf("delai", "relecture_differente", "format")

    /**
     * Heures à régler à la main si l'envoi échoue, calculées AU MOMENT DE L'ÉCHEC : celles que le câble aurait reçues
     * (début décalé si l'heure de début est dépassée, démarrage tardif). [repli] : celles données par la page au toucher,
     * si la décision est impossible (départ trop proche : rien n'est calculable). « Pas de charge » : fin - 1 min, fin.
     */
    fun heuresManuelles(action: Action, repli: HeuresManuelles, maintenant: ZonedDateTime): HeuresManuelles = when (action) {
        is Action.Desactiver -> HeuresManuelles(Plage.moinsUneMinute(action.fin), action.fin)
        is Action.Allumage -> when (val d = Plage.decider(action.hhmm, action.fin, action.dureeMin, action.depart, maintenant)) {
            is Decision.Normale -> HeuresManuelles(d.debut, d.fin)
            is Decision.Tardive -> HeuresManuelles(d.debut, d.fin)
            else -> repli
        }
    }

    /**
     * (titre, texte) de la notification de résultat. Les deux prennent le début en %1$s et la fin en %2$s (un paramètre
     * qui n'apparaît pas dans le texte est ignoré). Les textes d'échec donnent toujours le début ET la fin à régler.
     */
    fun textes(issue: Issue): Pair<Int, Int> = when (issue) {
        Issue.PROGRAMMEE -> R.string.resultat_ok_titre to R.string.resultat_ok_texte
        Issue.AUCUNE -> R.string.resultat_aucune_titre to R.string.resultat_aucune_texte
        Issue.TARDIVE -> R.string.resultat_tardif_titre to R.string.resultat_tardif_texte
        Issue.TROP_TARD -> R.string.resultat_trop_tard_titre to R.string.resultat_trop_tard_texte
        Issue.NON_FAITE -> R.string.resultat_ko_titre to R.string.resultat_a_la_main
        Issue.INCERTAINE -> R.string.resultat_ko_titre to R.string.resultat_verifier
        Issue.ANNULEE -> R.string.resultat_annulee_titre to R.string.resultat_a_la_main
        Issue.INCONNUE -> R.string.resultat_inconnu_titre to R.string.resultat_verifier
    }

    /** Issues qui n'ont besoin d'aucune heure dans leur texte. */
    fun sansHeure(issue: Issue): Boolean = issue == Issue.AUCUNE || issue == Issue.TROP_TARD
}
