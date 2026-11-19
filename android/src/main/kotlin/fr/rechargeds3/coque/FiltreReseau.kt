package fr.rechargeds3.coque

/**
 * Filtre du pont, sans aucune dépendance Android (testé en JUnit local : FiltreReseauTest).
 *
 * Règle n°9 du projet : le pont ne sait faire qu'une chose, une connexion TCP vers une adresse IPv4 privée, port 6668.
 * Aucune résolution de nom (pas de DNS) : l'adresse est analysée ici, en notation décimale pointée stricte, puis
 * transformée en octets ; seuls ces octets servent à ouvrir la connexion.
 */
object FiltreReseau {
    const val PORT = 6668
    const val TAILLE_MAX = 2048
    const val ORIGINE = "https://appassets.androidplatform.net"
    const val HOTE_ORIGINE = "appassets.androidplatform.net"

    // Quatre groupes de 1 à 3 chiffres ASCII ; [0-9] et non \d pour exclure tout autre chiffre Unicode.
    private val FORME = Regex("^([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})$")

    /**
     * Octets de l'adresse si [ip] est une IPv4 privée (10/8, 172.16/12, 192.168/16) en écriture décimale stricte,
     * sinon null. Refusés : zéros de tête (010.0.0.1), notations hexadécimale ou entière (0x7f.1, 2130706433), IPv6,
     * noms d'hôte (x.nip.io), 127.x, 169.254.x, 0.0.0.0, 255.x, adresses publiques, et les derniers octets 0 et 255
     * (adresses de réseau et de diffusion d'un /24).
     */
    fun adressePrivee(ip: String?): ByteArray? {
        if (ip == null || ip.length > 15) return null
        val m = FORME.matchEntire(ip) ?: return null
        val o = IntArray(4)
        for (i in 0..3) {
            val groupe = m.groupValues[i + 1]
            val n = groupe.toInt()
            if (n > 255 || n.toString() != groupe) return null // refuse aussi les zéros de tête
            o[i] = n
        }
        val prive = o[0] == 10 || (o[0] == 172 && o[1] in 16..31) || (o[0] == 192 && o[1] == 168)
        if (!prive) return null
        if (o[3] == 0 || o[3] == 255) return null
        return ByteArray(4) { o[it].toByte() }
    }

    fun portAutorise(port: Int): Boolean = port == PORT

    /** Taille d'un message envoyé ou reçu : de 0 à 2 Ko. */
    fun tailleAutorisee(octets: Int): Boolean = octets in 0..TAILLE_MAX

    /** Origine de la page autorisée à parler au pont : https://appassets.androidplatform.net (port 443). */
    fun origineAutorisee(schema: String?, hote: String?, port: Int): Boolean =
        schema == "https" && hote == HOTE_ORIGINE && (port == -1 || port == 443)

    /** Délai demandé par la page, ramené dans [min, max] ; [defaut] si absent. */
    fun delaiBorne(demande: Long?, min: Long, max: Long, defaut: Long): Long =
        if (demande == null) defaut else demande.coerceIn(min, max)

    /** « 10.0.2.15 » -> « 10.0.2 » (réseau /24, rien de plus), null si l'adresse n'est pas une IPv4 privée. */
    fun prefixe24(octets: ByteArray): String? {
        if (octets.size != 4) return null
        val o = IntArray(4) { octets[it].toInt() and 0xff }
        val prive = o[0] == 10 || (o[0] == 172 && o[1] in 16..31) || (o[0] == 192 && o[1] == 168)
        return if (prive) "${o[0]}.${o[1]}.${o[2]}" else null
    }
}
