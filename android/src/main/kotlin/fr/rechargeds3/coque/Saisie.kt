package fr.rechargeds3.coque

/**
 * Contrôles de la saisie native de l'identifiant et de la clé du câble (sans dépendance Android, testé en JUnit local).
 * La clé locale Tuya compte 16 caractères Latin-1 (le module JavaScript la convertit octet par octet).
 */
object Saisie {
    private val IDENTIFIANT = Regex("^[A-Za-z0-9_-]{1,64}$")

    fun identifiantValide(texte: String): Boolean = IDENTIFIANT.matches(texte)

    fun cleValide(texte: String): Boolean = texte.length == 16 && texte.all { it.code in 0x21..0xff }
}
