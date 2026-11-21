package fr.rechargeds3.coque.cable

import fr.rechargeds3.coque.cable.Aides.deHex
import fr.rechargeds3.coque.cable.Aides.hex
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.ZonedDateTime

/**
 * Vecteurs produits par tinytuya 1.21.1 (tests/tuya-local-vecteurs.json, clé factice) : les trames envoyées par le
 * client Kotlin (négociation, lecture, écriture, relecture) doivent être identiques OCTET PAR OCTET, et les réponses
 * enregistrées doivent être relues sans erreur. Jumeau de la partie « Vecteurs » de tests/tuya-local.test.mjs.
 */
class VecteursTest {
    private val v = Aides.json("tuya-local-vecteurs.json")
    private val cle = (v["cle"] as String).toByteArray(Charsets.ISO_8859_1)
    private val maintenant = { ZonedDateTime.parse(v["maintenant"] as String) }
    private val sansPause: (Long) -> Unit = {}

    @Suppress("UNCHECKED_CAST")
    private fun section(nom: String): Map<String, Any?> = v[nom] as Map<String, Any?>

    @Suppress("UNCHECKED_CAST")
    private fun echanges(nom: String): List<Map<String, Any?>> = section(nom)["echanges"] as List<Map<String, Any?>>

    @Suppress("UNCHECKED_CAST")
    private fun aleas() = Aides.AleasFixes(v["aleas"] as List<String>)

    private fun cfg() = ConfigCable(v["deviceId"] as String, cle.copyOf(), v["ip"] as String)

    /** Transport qui répond aux envois par les trames enregistrées du câble (rang d'envoi = rang de l'échange). */
    private class TransportVecteur(private val echanges: List<Map<String, Any?>>) : Transport {
        val envoyes = ArrayList<String>()
        val recus = ArrayList<String>()
        private val file = java.util.ArrayDeque<ByteArray>()

        override fun ouvrir(ip: String, port: Int, delaiMs: Int) {}

        override fun envoyer(octets: ByteArray) {
            val e = echanges.getOrNull(envoyes.size)
            envoyes.add(hex(octets))
            if (e != null) for (c in e["cable"] as List<*>) file.add(deHex(c as String))
        }

        override fun recevoir(delaiMs: Int): ByteArray {
            val c = file.pollFirst() ?: throw TransportException("delai")
            recus.add(hex(c))
            return c
        }

        override fun fermer() {}
    }

    private fun clients(nom: String) = echanges(nom).map { it["client"] as String }
    private fun cables(nom: String) = echanges(nom).flatMap { (it["cable"] as List<*>).map { c -> c as String } }

    @Test fun identifiantsFactices() {
        assertEquals("CLE-FACTICE-0000", v["cle"])
        assertTrue((v["deviceId"] as String).startsWith("factice_"))
        assertTrue((v["ip"] as String).startsWith("192.0.2.")) // plage de documentation RFC 5737
        assertTrue((v["_avertissement"] as String).contains("FACTICES"))
        assertEquals("1.21.1", v["tinytuya"])
    }

    @Test fun lectureMemesOctetsEnvoyesEtReponsesRelues() {
        val t = TransportVecteur(echanges("lecture"))
        val r = ClientCable.lireEtat(cfg(), t, aleas().fn)
        assertEquals(Resultat(true, debut = "03:30", fin = "06:00", plageActive = true), r)
        assertEquals(clients("lecture"), t.envoyes)
        assertEquals(cables("lecture"), t.recus)
    }

    @Test fun ecritureMemesOctetsEnvoyesEtReponsesRelues() {
        val t = TransportVecteur(echanges("ecriture"))
        @Suppress("UNCHECKED_CAST")
        val demande = section("ecriture")["demande"] as Map<String, Any?>
        val r = ClientCable.programmer(cfg(), t, Action.Allumage(demande["allumage"] as String), maintenant, sansPause, aleas().fn)
        assertEquals(Resultat(true, debut = "00:15", fin = "06:00", plageActive = true), r)
        assertEquals(clients("ecriture"), t.envoyes)
        assertEquals(cables("ecriture"), t.recus)
    }

    @Test fun ecritureLeCorpsEnClairEstCeluiDeTinytuya() {
        // Corps de la commande d'écriture (4e trame du client) déchiffré avec la clé de session de tinytuya, par
        // javax.crypto directement (indépendant de Tuya35). Le clair d'une trame envoyée n'a pas de code de retour.
        val trame = deHex(clients("ecriture")[3])
        val session = deHex(v["cle_session"] as String)
        val longueur = java.nio.ByteBuffer.wrap(trame).getInt(14)
        val c = javax.crypto.Cipher.getInstance("AES/GCM/NoPadding")
        c.init(javax.crypto.Cipher.DECRYPT_MODE, javax.crypto.spec.SecretKeySpec(session, "AES"), javax.crypto.spec.GCMParameterSpec(128, trame.copyOfRange(18, 30)))
        c.updateAAD(trame.copyOfRange(4, 18))
        val clair = c.doFinal(trame.copyOfRange(30, 18 + longueur))
        val corps = "{\"protocol\":5,\"t\":" + v["t"] + ",\"data\":{\"dps\":{\"151\":\"{\\\"m\\\":2,\\\"dt\\\":0,\\\"ss\\\":\\\"00:15\\\",\\\"se\\\":\\\"06:00\\\"}\"}}}"
        val attendu = "3.5".toByteArray() + ByteArray(12) + corps.toByteArray()
        assertEquals(hex(attendu), hex(clair))
    }

    @Test fun leFauxCableReproduitLesTramesDeTinytuya() {
        val ivs = List(10) { k -> ByteArray(12) { (0xc0 + k).toByte() } }
        var k = 0
        @Suppress("UNCHECKED_CAST")
        val dpsAvant = section("ecriture")["dps_avant"] as Map<String, Any?>
        @Suppress("UNCHECKED_CAST")
        val dpsApres = section("ecriture")["dps_apres"] as Map<String, Any?>
        val faux = FauxCable(
            OptionsFaux(
                cle = v["cle"] as String, dps = dpsAvant, nonceCable = deHex(v["nonce_cable"] as String), iv = { ivs[k++] },
                tAnnonce = v["t"] as Long, effetsEcriture = mapOf("102" to dpsApres["102"]),
            ),
        )
        val recus = ArrayList<String>()
        val transport = object : Transport by faux {
            override fun recevoir(delaiMs: Int): ByteArray {
                val c = faux.recevoir(delaiMs)
                recus.add(hex(c))
                return c
            }
        }
        val r = ClientCable.programmer(cfg(), transport, Action.Allumage("00:15"), maintenant, sansPause, aleas().fn)
        assertTrue(r.ok)
        assertEquals(clients("ecriture"), faux.envoyes.map { hex(it) })
        assertEquals(cables("ecriture"), recus) // négociation, lecture, accusé, annonce, relecture
    }

    @Test fun cleDeSessionEstCelleDeTinytuya() {
        @Suppress("UNCHECKED_CAST")
        val al = v["aleas"] as List<String>
        val session = Tuya35.cleDeSession(cle, deHex(al[0]), deHex(v["nonce_cable"] as String))
        assertEquals(v["cle_session"], hex(session))
    }

    @Test fun dpsRelusSontCeuxDesVecteurs() {
        // Les points de données des vecteurs gardent leur ordre et leurs valeurs à travers l'analyseur JSON.
        @Suppress("UNCHECKED_CAST")
        val dps = section("lecture")["dps"] as Map<String, Any?>
        assertEquals(listOf("101", "102", "107", "109", "150", "151", "152"), dps.keys.toList())
        assertEquals(202L, dps["101"])
        assertEquals("{\"m\":2,\"dt\":0,\"ss\":\"03:30\",\"se\":\"06:00\"}", dps["151"])
    }
}
