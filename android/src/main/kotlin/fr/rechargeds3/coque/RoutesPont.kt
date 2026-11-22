package fr.rechargeds3.coque

/**
 * Table fermée des opérations que la page peut demander au pont (Kotlin pur, testé en JUnit : RoutesPontTest).
 * Toute autre opération, dont les anciennes routes génériques (ouvrir, envoyer, recevoir, sonder…), est refusée ;
 * les opérations de mise au point ne sont acceptées que par la version de mise au point.
 */
object RoutesPont {
    val PUBLIQUES = setOf(
        "demarrage", "variante", "prefixeWifi", "saisirCle", "cable", "lire", "programmer", "chercher",
        "notifications", "demanderNotifications", "attenteDebut", "attenteEtat", "attenteAnnuler", "attenteAcquitter",
    )
    val MISE_AU_POINT = setOf("essaiFiltre")

    fun autorisee(op: String, estDebug: Boolean): Boolean = op in PUBLIQUES || (estDebug && op in MISE_AU_POINT)
}
