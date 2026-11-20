package fr.rechargeds3.coque

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.spec.GCMParameterSpec

/**
 * Format de stockage chiffré de l'identifiant et de la clé du câble. Le magasin de clés d'Android n'existe pas en JUnit
 * local : on chiffre ici avec une clé AES logicielle du JVM, même transformation ; le magasin est vérifié sur émulateur.
 */
class EnveloppeTest {
    private val id = "bf1234567890abcdef"
    private val cle = "Ab3!x#9:z;Q~\\pé0" // 16 caractères, dont ':' (séparateur du bloc) et un caractère Latin-1

    private fun aes() = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()

    @Test fun allerRetourChiffre() {
        val k = aes()
        val c = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, k) }
        val bloc = Enveloppe.encoder(c.iv, c.doFinal(Enveloppe.contenu(id, cle)))
        assertTrue(bloc.startsWith("v1:"))
        assertFalse("ni l'identifiant ni la clé en clair dans le bloc", bloc.contains(id) || bloc.contains(cle))
        val (iv, chiffre) = Enveloppe.decoder(bloc)!!
        val d = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.DECRYPT_MODE, k, GCMParameterSpec(128, iv)) }
        assertEquals(id to cle, Enveloppe.lireContenu(d.doFinal(chiffre)))
    }

    @Test fun blocsIllisibles() {
        val iv = ByteArray(12) { it.toByte() }
        val ok = Enveloppe.encoder(iv, ByteArray(40))
        assertArrayEquals(iv, Enveloppe.decoder(ok)!!.first)
        for (b in listOf(null, "", "v1", "v2:" + ok.substring(3), ok.substring(0, ok.lastIndexOf(':')), "v1:!!:??",
                "v1:${java.util.Base64.getEncoder().encodeToString(ByteArray(8))}:${java.util.Base64.getEncoder().encodeToString(ByteArray(40))}",
                "v1:${java.util.Base64.getEncoder().encodeToString(iv)}:${java.util.Base64.getEncoder().encodeToString(ByteArray(16))}",
                "x".repeat(2000))) {
            assertNull("«$b»", Enveloppe.decoder(b))
        }
    }

    @Test fun contenuControle() {
        assertNull(Enveloppe.lireContenu("sans-saut".toByteArray()))
        assertNull(Enveloppe.lireContenu("\n$cle".toByteArray()))
        assertNull(Enveloppe.lireContenu("$id\ncourte".toByteArray()))
        assertNull(Enveloppe.lireContenu("id avec espace\n$cle".toByteArray()))
        assertEquals(id to cle, Enveloppe.lireContenu(Enveloppe.contenu(id, cle)))
    }

    @Test(expected = IllegalArgumentException::class) fun contenuRefuseUneCleInvalide() {
        Enveloppe.contenu(id, "trop courte")
    }

    @Test fun deuxChiffrementsDonnentDeuxBlocsDifferents() {
        val k = aes()
        fun bloc() = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, k) }.let { Enveloppe.encoder(it.iv, it.doFinal(Enveloppe.contenu(id, cle))) }
        assertFalse(bloc() == bloc())
    }
}
