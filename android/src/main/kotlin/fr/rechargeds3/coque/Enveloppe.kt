package fr.rechargeds3.coque

import java.util.Base64

/**
 * Format de stockage de l'identifiant et de la clé du câble (sans dépendance Android, testé en JUnit local).
 *
 *   bloc     = "v1:" + base64(IV de 12 octets) + ":" + base64(texte chiffré AES-GCM, étiquette de 16 octets comprise)
 *   contenu  = identifiant + "\n" + clé (UTF-8 ; ni l'un ni l'autre ne peut contenir de saut de ligne : Saisie)
 *
 * Le chiffrement lui-même est fait par CoffreCable avec une clé du magasin de clés d'Android ; ici, seulement la mise en
 * forme et les contrôles. Un bloc illisible rend null : il n'est jamais « réparé » ni effacé ici.
 */
object Enveloppe {
    private const val VERSION = "v1"
    const val TAILLE_IV = 12
    const val TAILLE_ETIQUETTE = 16

    fun encoder(iv: ByteArray, chiffre: ByteArray): String {
        require(iv.size == TAILLE_IV) { "IV de $TAILLE_IV octets attendu" }
        require(chiffre.size > TAILLE_ETIQUETTE) { "texte chiffré trop court" }
        val b64 = Base64.getEncoder()
        return "$VERSION:${b64.encodeToString(iv)}:${b64.encodeToString(chiffre)}"
    }

    /** (iv, chiffré), ou null si le bloc est absent, d'une autre version, tronqué ou mal formé. */
    fun decoder(bloc: String?): Pair<ByteArray, ByteArray>? {
        if (bloc == null || bloc.length > 1024) return null
        val parties = bloc.split(':')
        if (parties.size != 3 || parties[0] != VERSION) return null
        return try {
            val d = Base64.getDecoder()
            val iv = d.decode(parties[1])
            val chiffre = d.decode(parties[2])
            if (iv.size != TAILLE_IV || chiffre.size <= TAILLE_ETIQUETTE) null else iv to chiffre
        } catch (e: IllegalArgumentException) {
            null
        }
    }

    fun contenu(identifiant: String, cle: String): ByteArray {
        require(Saisie.identifiantValide(identifiant) && Saisie.cleValide(cle)) { "identifiant ou clé invalide" }
        return "$identifiant\n$cle".toByteArray(Charsets.UTF_8)
    }

    /** (identifiant, clé), ou null si le contenu déchiffré n'a pas la forme attendue. */
    fun lireContenu(octets: ByteArray): Pair<String, String>? {
        val texte = String(octets, Charsets.UTF_8)
        val i = texte.indexOf('\n')
        if (i <= 0) return null
        val id = texte.substring(0, i)
        val cle = texte.substring(i + 1)
        return if (Saisie.identifiantValide(id) && Saisie.cleValide(cle)) id to cle else null
    }
}
