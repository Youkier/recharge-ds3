package fr.rechargeds3.coque.cable

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.ZoneId
import java.time.ZonedDateTime

/**
 * Règle du démarrage tardif (décision du 2026-11-22) : tests/plage-tardif-cas.json est lu ici contre Plage.decider, et par
 * tests/plage-tardif-cas.test.mjs contre le Worker (deciderPlage). Les deux doivent donner exactement les mêmes résultats.
 */
class PlageTardifTest {
    private val cas = Aides.json("plage-tardif-cas.json")

    @Suppress("UNCHECKED_CAST")
    private fun liste(nom: String): List<Map<String, Any?>> = cas[nom] as List<Map<String, Any?>>

    @Suppress("UNCHECKED_CAST")
    private fun objet(v: Any?): Map<String, Any?> = v as Map<String, Any?>

    private fun decider(c: Map<String, Any?>, maintenant: ZonedDateTime): Decision =
        Plage.decider(c["allumage"] as String, c["fin"] as String, (c["duree_min"] as Long).toInt(), c["depart"] as String, maintenant)

    private fun attendu(c: Map<String, Any?>): Decision {
        val a = objet(c["attendu"])
        return when (a["statut"] as String) {
            "normal" -> Decision.Normale(a["debut"] as String, a["fin"] as String)
            "tardif" -> Decision.Tardive(a["debut"] as String, a["fin"] as String)
            "trop_tard" -> Decision.TropTard
            "invalide" -> Decision.Invalide
            else -> throw AssertionError("statut inconnu : ${a["statut"]}")
        }
    }

    @Test fun lesSectionsSontPresentes() {
        assertTrue(liste("decider").size >= 30)
        assertTrue(liste("desactiver").size >= 3)
        val statuts = liste("decider").map { objet(it["attendu"])["statut"] }.toSet()
        assertEquals(setOf<Any?>("normal", "tardif", "trop_tard", "invalide"), statuts)
    }

    @Test fun deciderSurLeFichierDeCas() {
        for (c in liste("decider")) {
            assertEquals(c["nom"] as String, attendu(c), decider(c, ZonedDateTime.parse(c["maintenant"] as String)))
        }
    }

    @Test fun deciderNeDependPasDuFuseauDuSysteme() {
        // Le même instant, exprimé dans d'autres fuseaux, donne la même décision (heure de Paris toujours).
        for (c in liste("decider")) {
            val base = ZonedDateTime.parse(c["maintenant"] as String)
            for (zone in listOf("UTC", "Asia/Tokyo", "America/Los_Angeles", "Pacific/Kiritimati")) {
                assertEquals("${c["nom"]} ($zone)", attendu(c), decider(c, base.withZoneSameInstant(ZoneId.of(zone))))
            }
        }
    }

    @Test fun desactiverDebutEgalFinDemandeeMoinsUneMinute() {
        for (c in liste("desactiver")) {
            val a = objet(c["attendu"])
            assertEquals(c["nom"] as String, a["debut"], Plage.moinsUneMinute(c["fin"] as String))
            assertEquals(c["nom"] as String, a["fin"], c["fin"])
        }
    }

    @Test fun demandeValide() {
        assertTrue(Plage.demandeValide("23:00", "06:00", 420, "07:30"))
        assertTrue(Plage.demandeValide("23:00", "07:30", 1, "07:30")) // fin = départ
        assertTrue(Plage.demandeValide("23:00", "06:00", 900, "07:30"))
        for ((fin, duree, depart) in listOf(
            Triple("08:00", 420, "07:30"), Triple("23:00", 420, "07:30"), Triple("22:00", 420, "07:30"),
            Triple("06:00", 0, "07:30"), Triple("06:00", 901, "07:30"), Triple("06:00", -1, "07:30"),
            Triple("06:00", 420, "23:00"), Triple("06:00", 420, "05:00"), Triple("06:00", 420, "7:30"), Triple("6:00", 420, "07:30"),
        )) assertTrue("$fin $duree $depart", !Plage.demandeValide("23:00", fin, duree, depart))
        assertTrue(!Plage.demandeValide("24:00", "06:00", 420, "07:30"))
    }
}
