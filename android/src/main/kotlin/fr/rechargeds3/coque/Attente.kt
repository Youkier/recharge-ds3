package fr.rechargeds3.coque

/**
 * Logique pure de l'attente en arrière-plan (décisions du 2026-11-21) : validation de l'heure reçue de la page et choix
 * des textes de notification. Les textes sont FIXES (res/values/strings.xml) ; la page ne fournit qu'une heure validée
 * (ou rien, si elle n'a pas pu la calculer) et un résultat pris dans une liste fermée, jamais une chaîne affichée.
 */
object Attente {
    private val HEURE = Regex("^([01][0-9]|2[0-3]):[0-5][0-9]$")

    fun heureValide(h: String?): Boolean = h != null && HEURE.matches(h)

    /** Heure reçue de la page : HH:MM validée, null si absente ou vide ; [INVALIDE] si présente mais mal formée. */
    fun heureRecue(h: String?): String? = when {
        h.isNullOrEmpty() -> null
        heureValide(h) -> h
        else -> INVALIDE
    }
    const val INVALIDE = "invalide"

    /** Issue d'une attente, telle qu'annoncée par la notification de résultat. */
    enum class Issue { PROGRAMMEE, AUCUNE, IMMEDIATE, NON_FAITE, INCERTAINE, ANNULEE, INCONNUE, APPLI_FERMEE }

    /** Résultat annoncé par la page (« ok » | « ko » | « annulee ») ; null si la valeur est hors liste. */
    fun issue(resultat: String?, incertain: Boolean): Issue? = when (resultat) {
        "ok" -> Issue.PROGRAMMEE
        "aucune" -> Issue.AUCUNE
        "immediat" -> Issue.IMMEDIATE
        "ko" -> if (incertain) Issue.INCERTAINE else Issue.NON_FAITE
        "annulee" -> Issue.ANNULEE
        else -> null
    }

    /**
     * (titre, texte) de la notification de résultat. Avec une heure, les deux prennent l'heure en paramètre %1$s (ignoré
     * s'il manque) ; sans heure (null), variantes qui n'en parlent pas.
     */
    fun textes(issue: Issue, avecHeure: Boolean): Pair<Int, Int> = if (avecHeure) when (issue) {
        Issue.PROGRAMMEE -> R.string.resultat_ok_titre to R.string.resultat_ok_texte
        Issue.AUCUNE -> R.string.resultat_aucune_titre to R.string.resultat_aucune_texte
        Issue.IMMEDIATE -> R.string.resultat_immediat_titre to R.string.resultat_ok_texte
        Issue.NON_FAITE -> R.string.resultat_ko_titre to R.string.resultat_a_la_main
        Issue.INCERTAINE -> R.string.resultat_ko_titre to R.string.resultat_verifier
        Issue.ANNULEE -> R.string.resultat_annulee_titre to R.string.resultat_a_la_main
        Issue.INCONNUE -> R.string.resultat_inconnu_titre to R.string.resultat_verifier
        Issue.APPLI_FERMEE -> R.string.resultat_fermee_titre to R.string.resultat_fermee_texte
    } else when (issue) {
        Issue.PROGRAMMEE -> R.string.resultat_ok_titre_sans_heure to R.string.resultat_ok_texte
        Issue.AUCUNE -> R.string.resultat_aucune_titre to R.string.resultat_aucune_texte
        Issue.IMMEDIATE -> R.string.resultat_immediat_titre to R.string.resultat_ok_texte
        Issue.NON_FAITE -> R.string.resultat_ko_titre to R.string.resultat_a_la_main_sans_heure
        Issue.INCERTAINE -> R.string.resultat_ko_titre to R.string.resultat_verifier_sans_heure
        Issue.ANNULEE -> R.string.resultat_annulee_titre to R.string.resultat_a_la_main_sans_heure
        Issue.INCONNUE -> R.string.resultat_inconnu_titre to R.string.resultat_verifier_sans_heure
        Issue.APPLI_FERMEE -> R.string.resultat_fermee_titre to R.string.resultat_fermee_texte_sans_heure
    }
}
