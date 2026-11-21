package fr.rechargeds3.coque.cable

import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.Mac
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * Échec du protocole. Le message est toujours le code, jamais autre chose : la clé n'apparaît dans aucune exception.
 * Codes : "cle", "hors_ligne", "delai", "format", "relecture_differente", "ferme" (interne, converti avant renvoi).
 */
class ErreurCable(val code: String) : Exception(code)

/** Source d'aléas : SecureRandom par défaut ; les tests injectent des octets fixes pour comparer aux vecteurs. */
object Aleas {
    private val hasard = SecureRandom()
    val parDefaut: (Int) -> ByteArray = { n -> ByteArray(n).also { hasard.nextBytes(it) } }
}

/** Message déchiffré. Le clair d'une trame reçue commence par un code de retour de 4 octets ([retcode]). */
class Message(val seq: Long, val cmd: Long, val longueur: Long, val retcode: Long, val payload: ByteArray)

/**
 * Protocole Tuya 3.5 (trames 6699), reprise de local/tuya-local.js ligne à ligne ; référence : tinytuya 1.21.1
 * (docs/tuya-findings.md). Kotlin pur : javax.crypto et java.security seulement, aucun appel à android.*.
 *
 * Trame : en-tête de 18 octets (préfixe 0x00006699, 2 octets nuls, séquence, commande, longueur), IV (12), chiffré,
 * étiquette GCM (16), pied 0x00009966. Longueur = 12 + taille du clair + 16. AAD = en-tête sans le préfixe (14 octets).
 */
object Tuya35 {
    const val PORT = 6668
    const val LONGUEUR_MAX = 1440
    const val TAILLE_ENTETE = 18

    const val CMD_NEG_DEBUT = 3L
    const val CMD_NEG_REPONSE = 4L
    const val CMD_NEG_FIN = 5L
    const val CMD_ECRITURE = 0x0dL // CONTROL_NEW : la seule commande d'écriture du module
    const val CMD_LECTURE = 0x10L // DP_QUERY_NEW

    private val PREFIXE = byteArrayOf(0x00, 0x00, 0x66, 0x99.toByte())
    private val PIED = byteArrayOf(0x00, 0x00, 0x99.toByte(), 0x66)

    fun concat(vararg tableaux: ByteArray): ByteArray {
        val sortie = ByteArray(tableaux.sumOf { it.size })
        var i = 0
        for (t in tableaux) {
            t.copyInto(sortie, i)
            i += t.size
        }
        return sortie
    }

    fun lireU32(b: ByteArray, i: Int): Long =
        ((b[i].toLong() and 0xFF) shl 24) or ((b[i + 1].toLong() and 0xFF) shl 16) or
            ((b[i + 2].toLong() and 0xFF) shl 8) or (b[i + 3].toLong() and 0xFF)

    private fun ecrireU32(b: ByteArray, i: Int, n: Long) {
        b[i] = (n shr 24).toByte()
        b[i + 1] = (n shr 16).toByte()
        b[i + 2] = (n shr 8).toByte()
        b[i + 3] = n.toByte()
    }

    /** Comparaison en temps constant (les longueurs sont publiques). */
    fun egaux(a: ByteArray, b: ByteArray): Boolean {
        if (a.size != b.size) return false
        var d = 0
        for (i in a.indices) d = d or (a[i].toInt() xor b[i].toInt())
        return d == 0
    }

    /** AES-GCM, étiquette de 128 bits ; NOUVELLE instance de Cipher à chaque appel (pas de réutilisation de clé/IV). */
    private fun gcm(mode: Int, cle: ByteArray, iv: ByteArray, aad: ByteArray?, donnees: ByteArray): ByteArray {
        val chiffreur = Cipher.getInstance("AES/GCM/NoPadding")
        chiffreur.init(mode, SecretKeySpec(cle, "AES"), GCMParameterSpec(128, iv))
        if (aad != null) chiffreur.updateAAD(aad)
        return chiffreur.doFinal(donnees)
    }

    fun hmacSha256(cle: ByteArray, donnees: ByteArray): ByteArray {
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(cle, "HmacSHA256"))
        return mac.doFinal(donnees)
    }

    /** Trame complète (en-tête, IV, chiffré + étiquette, pied) pour [clair], avec le numéro [seq] et la commande [cmd]. */
    fun empaqueter(cle: ByteArray, seq: Long, cmd: Long, clair: ByteArray, iv: ByteArray): ByteArray {
        if (iv.size != 12) throw ErreurCable("format")
        val entete = ByteArray(TAILLE_ENTETE)
        PREFIXE.copyInto(entete, 0)
        ecrireU32(entete, 6, seq)
        ecrireU32(entete, 10, cmd)
        ecrireU32(entete, 14, clair.size.toLong() + 16 + 12)
        val chiffre = gcm(Cipher.ENCRYPT_MODE, cle, iv, entete.copyOfRange(4, TAILLE_ENTETE), clair) // chiffré + étiquette
        return concat(entete, iv, chiffre, PIED)
    }

    /** Déchiffre une trame complète. Étiquette refusée = "cle" (clé fausse, câble réappairé ou trame altérée). */
    fun depaqueter(cle: ByteArray, trame: ByteArray): Message {
        if (trame.size < TAILLE_ENTETE) throw ErreurCable("format")
        val longueur = lireU32(trame, 14)
        if (longueur < 12 + 16 || longueur > LONGUEUR_MAX || trame.size < TAILLE_ENTETE + longueur) throw ErreurCable("format")
        val fin = TAILLE_ENTETE + longueur.toInt()
        val iv = trame.copyOfRange(TAILLE_ENTETE, TAILLE_ENTETE + 12)
        val chiffre = trame.copyOfRange(TAILLE_ENTETE + 12, fin)
        val clair = try {
            gcm(Cipher.DECRYPT_MODE, cle, iv, trame.copyOfRange(4, TAILLE_ENTETE), chiffre)
        } catch (e: Exception) {
            throw ErreurCable("cle")
        }
        if (clair.size < 4) throw ErreurCable("format")
        return Message(lireU32(trame, 6), lireU32(trame, 10), longueur, lireU32(clair, 0), clair.copyOfRange(4, clair.size))
    }

    /**
     * Clé de session (négociation 3.5) : AES-GCM(clé locale, IV = 12 premiers octets du nonce local, sans AAD) appliqué
     * à (nonce local XOR nonce du câble) ; on garde les 16 premiers octets du chiffré (l'étiquette est jetée).
     */
    fun cleDeSession(cleLocale: ByteArray, nonceLocal: ByteArray, nonceCable: ByteArray): ByteArray {
        if (nonceLocal.size != 16 || nonceCable.size != 16) throw ErreurCable("format")
        val xor = ByteArray(16) { (nonceLocal[it].toInt() xor nonceCable[it].toInt()).toByte() }
        val chiffre = gcm(Cipher.ENCRYPT_MODE, cleLocale, nonceLocal.copyOfRange(0, 12), null, xor)
        return chiffre.copyOfRange(0, 16)
    }

    /**
     * Tampon de réception : accumule les morceaux reçus et en extrait les trames complètes, en se recalant sur le
     * préfixe (comme XenonDevice._receive). Longueur hors de 28..1440 ou pied faux = "format".
     */
    class Tampon {
        private var octets = ByteArray(0)

        fun ajouter(morceau: ByteArray) {
            octets = concat(octets, morceau)
        }

        /** Une trame complète, ou null s'il en manque. */
        fun extraire(): ByteArray? {
            var b = octets
            var i = -1
            var j = 0
            while (j + 4 <= b.size) {
                if (b[j] == PREFIXE[0] && b[j + 1] == PREFIXE[1] && b[j + 2] == PREFIXE[2] && b[j + 3] == PREFIXE[3]) {
                    i = j
                    break
                }
                j++
            }
            if (i < 0) {
                octets = b.copyOfRange(maxOf(0, b.size - 3), b.size)
                return null
            }
            if (i > 0) b = b.copyOfRange(i, b.size)
            octets = b
            if (b.size < TAILLE_ENTETE) return null
            val longueur = lireU32(b, 14)
            if (longueur < 12 + 16 || longueur > LONGUEUR_MAX) throw ErreurCable("format")
            val total = TAILLE_ENTETE + longueur.toInt() + 4
            if (b.size < total) return null
            val trame = b.copyOfRange(0, total)
            octets = b.copyOfRange(total, b.size)
            if (!egaux(trame.copyOfRange(total - 4, total), PIED)) throw ErreurCable("format")
            return trame
        }
    }
}
