package fr.rechargeds3.coque.cable

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.ZonedDateTime

/**
 * Cas communs au JS et au Kotlin : tests/tuya-local-cas.json est lu ici contre Plage.kt, et par
 * tests/tuya-local-cas.test.mjs contre local/tuya-local.js. Les deux doivent donner exactement les mêmes résultats.
 */
class CasCommunsTest {
    private val cas = Aides.json("tuya-local-cas.json")

    @Suppress("UNCHECKED_CAST")
    private fun liste(nom: String): List<Map<String, Any?>> = cas[nom] as List<Map<String, Any?>>

    @Suppress("UNCHECKED_CAST")
    private fun objet(v: Any?): Map<String, Any?> = v as Map<String, Any?>

    @Test fun lesSectionsSontPresentes() {
        for (k in listOf("decider", "moinsUneMinute", "plages", "autresPointsModifies")) assertTrue(k, liste(k).isNotEmpty())
        assertTrue(liste("decider").size >= 20)
    }

    @Test fun deciderHeureDeParisPassageDeMinuitEtChangementsDHeure() {
        for (c in liste("decider")) {
            val r = Plage.decider(c["allumage"] as String, c["fin"] as String, ZonedDateTime.parse(c["maintenant"] as String))
            val attendu = objet(c["attendu"])
            assertEquals(c["nom"] as String, attendu["debut"], r.debut)
            assertEquals(c["nom"] as String, attendu["immediat"], r.immediat)
        }
    }

    @Test fun deciderNeDependPasDuFuseauDuSysteme() {
        // Le même instant, exprimé dans d'autres fuseaux, donne la même décision.
        for (c in liste("decider")) {
            val base = ZonedDateTime.parse(c["maintenant"] as String)
            val reference = Plage.decider(c["allumage"] as String, c["fin"] as String, base)
            for (zone in listOf("UTC", "Asia/Tokyo", "America/Los_Angeles", "Pacific/Kiritimati")) {
                val r = Plage.decider(c["allumage"] as String, c["fin"] as String, base.withZoneSameInstant(java.time.ZoneId.of(zone)))
                assertEquals("${c["nom"]} ($zone)", reference, r)
            }
        }
    }

    @Test fun moinsUneMinute() {
        for (c in liste("moinsUneMinute")) assertEquals(c["entree"] as String, c["attendu"], Plage.moinsUneMinute(c["entree"] as String))
    }

    @Test fun lirePlage() {
        for (c in liste("plages")) {
            val valeur = c["valeur"] as String
            val r = Plage.lirePlage(valeur)
            if (c["attendu"] == null) {
                assertNull(valeur, r)
            } else {
                val a = objet(c["attendu"])
                assertEquals(valeur, PlageCharge((a["m"] as Long).toInt(), (a["dt"] as Long).toInt(), a["ss"] as String, a["se"] as String), r)
            }
        }
    }

    @Test fun autresPointsModifies() {
        for (c in liste("autresPointsModifies")) {
            assertEquals(c["nom"] as String, c["attendu"], Plage.autresPointsModifies(objet(c["avant"]), objet(c["apres"])))
        }
    }

    // --- Écarts voulus avec le JS (documentés) : le Kotlin est plus strict sur la forme de la valeur du dp 151 ---

    @Test fun lirePlageRefuseCeQueLeJsAccepteEncore() {
        for (v in listOf(
            "{\"m\": 2, \"dt\": 0, \"ss\": \"03:30\", \"se\": \"06:00\"}", // espaces
            "{\"m\":2,\"dt\":5.0,\"ss\":\"03:30\",\"se\":\"06:00\"}", // 5.0 est un entier pour JS
            "{\"m\":2,\"dt\":1e2,\"ss\":\"03:30\",\"se\":\"06:00\"}",
            "{\"m\":2,\"dt\":-0,\"ss\":\"03:30\",\"se\":\"06:00\"}",
            "{\"m\":2,\"dt\":007,\"ss\":\"03:30\",\"se\":\"06:00\"}",
            "{\"m\":2,\"dt\":1234567890,\"ss\":\"03:30\",\"se\":\"06:00\"}", // 10 chiffres
            "{\"m\":02,\"dt\":0,\"ss\":\"03:30\",\"se\":\"06:00\"}",
            "{\"m\":2,\"dt\":0,\"ss\":\"03:30\",\"se\":\"06:00\"}\n",
        )) assertNull(v, Plage.lirePlage(v))
        assertEquals(PlageCharge(2, 123456789, "03:30", "06:00"), Plage.lirePlage("{\"m\":2,\"dt\":123456789,\"ss\":\"03:30\",\"se\":\"06:00\"}"))
        assertEquals(PlageCharge(0, -123456789, "00:00", "23:59"), Plage.lirePlage("{\"m\":0,\"dt\":-123456789,\"ss\":\"00:00\",\"se\":\"23:59\"}"))
    }

    @Test fun heureValide() {
        for (h in listOf("00:00", "07:30", "23:59", "19:05")) assertTrue(h, Plage.heureValide(h))
        for (h in listOf("24:00", "7:30", "07:60", "07:30\n", " 07:30", "", "0730", "٠٧:٣٠", "07:3", "07:300")) assertTrue(h, !Plage.heureValide(h))
    }
}
