package fr.rechargeds3.coque

/**
 * Identifiant et clé locale du câble, saisis dans l'écran natif. Lot C3 : EN MÉMOIRE SEULEMENT, jamais écrits sur le
 * disque, jamais journalisés (le chiffrement par le magasin de clés d'Android est le lot C4). Perdus quand le processus
 * s'arrête, ce qui oblige à les ressaisir : voulu à ce stade.
 */
object CableConfig {
    @Volatile private var deviceId: String? = null
    @Volatile private var cleLocale: String? = null

    fun configure(): Boolean = deviceId != null && cleLocale != null

    fun definir(id: String, cle: String) { deviceId = id; cleLocale = cle }

    fun identifiant(): String? = deviceId
    fun cle(): String? = cleLocale

    fun effacer() { deviceId = null; cleLocale = null }
}
