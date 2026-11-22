package fr.rechargeds3.coque

import fr.rechargeds3.coque.Attente.Issue
import fr.rechargeds3.coque.cable.Action
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.ZonedDateTime

class AttenteTest {
    private val allumage = Action.Allumage("00:35", "06:00", 300, "07:30")
    private val pasDeCharge = Action.Desactiver("06:00")
    private fun ok(debut: String, fin: String, vararg plus: Pair<String, Any?>): Map<String, Any?> =
        mapOf<String, Any?>("ok" to true, "debut" to debut, "fin" to fin, "plage_active" to true, "tardif" to false, "courte" to false) + plus
    private fun ko(erreur: String, vararg plus: Pair<String, Any?>): Map<String, Any?> = mapOf<String, Any?>("ok" to false, "erreur" to erreur) + plus

    @Test fun heuresValides() {
        for (h in listOf("00:00", "05:59", "09:30", "19:05", "22:00", "23:59")) assertTrue(h, Attente.heureValide(h))
    }

    @Test fun heuresRefusees() {
        for (h in listOf(null, "", "24:00", "7:30", "07:3", "07:60", "07h30", " 07:30", "07:30 ", "07:30\n", "١٢:٠٠", "0a:00", "07:30:00")) {
            assertFalse(h.toString(), Attente.heureValide(h))
        }
    }

    // --- jamais de faux OK : seule une relecture conforme donne « programmée » ---

    @Test fun relectureConformeDonneProgrammee() {
        assertEquals(Issue.PROGRAMMEE, Attente.issue(allumage, ok("00:35", "06:00")))
        assertEquals(Issue.AUCUNE, Attente.issue(pasDeCharge, ok("05:59", "06:00", "courte" to true)))
    }

    @Test fun relectureDifferenteNeDonneJamaisProgrammee() {
        for (r in listOf(
            ok("00:40", "06:00"), ok("00:35", "05:00"), ok("00:35", "06:00", "plage_active" to false),
            ok("00:35", "06:00", "plage_active" to null), mapOf("ok" to true), mapOf("ok" to true, "debut" to "00:35"),
            ok("0:35", "06:00"), ok("00:35", "6:00"), mapOf("ok" to "true", "debut" to "00:35", "fin" to "06:00", "plage_active" to true),
        )) assertEquals(r.toString(), Issue.INCERTAINE, Attente.issue(allumage, r))
        // « Pas de charge » : plage non courte, ou fin différente de celle demandée.
        assertEquals(Issue.INCERTAINE, Attente.issue(pasDeCharge, ok("05:59", "06:00")))
        assertEquals(Issue.INCERTAINE, Attente.issue(pasDeCharge, ok("05:59", "06:01", "courte" to true)))
        assertEquals(Issue.INCERTAINE, Attente.issue(pasDeCharge, ok("05:00", "06:00", "courte" to true)))
    }

    @Test fun debutReporteDonneTardifSeulementDansLaNuit() {
        assertEquals(Issue.TARDIVE, Attente.issue(allumage, ok("23:40", "06:40", "tardif" to true)))
        assertEquals(Issue.TARDIVE, Attente.issue(allumage, ok("07:00", "07:30", "tardif" to true)))
        // fin après le départ, fin = début, ou début après le départ : pas une plage de cette nuit.
        assertEquals(Issue.INCERTAINE, Attente.issue(allumage, ok("23:40", "07:40", "tardif" to true)))
        assertEquals(Issue.INCERTAINE, Attente.issue(allumage, ok("23:40", "23:40", "tardif" to true)))
        assertEquals(Issue.INCERTAINE, Attente.issue(allumage, ok("07:30", "08:00", "tardif" to true)))
        // Pas de « tardif » annoncé : le début relu doit être celui de la demande.
        assertEquals(Issue.INCERTAINE, Attente.issue(allumage, ok("23:40", "06:40")))
    }

    @Test fun echecsSelonLEtatReelDuCable() {
        assertEquals(Issue.TROP_TARD, Attente.issue(allumage, ko("trop_tard")))
        for (e in listOf("hors_ligne", "cle", "pas_de_cle", "pas_wifi", "occupe", "sans_adresse", "requete_invalide", "refuse")) {
            assertEquals(e, Issue.NON_FAITE, Attente.issue(allumage, ko(e)))
        }
        for (e in listOf("delai", "relecture_differente", "format")) assertEquals(e, Issue.INCERTAINE, Attente.issue(allumage, ko(e)))
        // Écriture partie : toujours incertain, quelle que soit la cause.
        assertEquals(Issue.INCERTAINE, Attente.issue(allumage, ko("hors_ligne", "ecrit" to true)))
        assertEquals(Issue.INCERTAINE, Attente.issue(pasDeCharge, ko("cle", "ecrit" to true)))
    }

    // --- heures à régler à la main : début ET fin, calculées au moment de l'échec ---

    private val repli = HeuresManuelles("00:35", "06:00")
    private fun paris(utc: String) = ZonedDateTime.parse(utc) // novembre : Paris = UTC + 1

    @Test fun heuresManuellesSuiventLeDemarrageTardif() {
        assertEquals(HeuresManuelles("00:35", "06:00"), Attente.heuresManuelles(allumage, repli, paris("2026-11-16T22:30:00Z"))) // 23:30 : normal
        // 01:00 à Paris : le début 00:35 est passé, début = 01:10, fin = min(01:10 + 300 min, 07:30) = 06:10.
        assertEquals(HeuresManuelles("01:10", "06:10"), Attente.heuresManuelles(allumage, repli, paris("2026-11-17T00:00:00Z")))
        // Départ à 10 min ou moins : rien de calculable, on rend les heures données au toucher.
        assertEquals(repli, Attente.heuresManuelles(allumage, repli, paris("2026-11-17T06:20:00Z")))
        assertEquals(HeuresManuelles("05:59", "06:00"), Attente.heuresManuelles(pasDeCharge, repli, paris("2026-11-17T00:00:00Z")))
    }

    // --- textes fixes ---

    @Test fun textesParIssue() {
        assertEquals(R.string.resultat_ok_titre to R.string.resultat_ok_texte, Attente.textes(Issue.PROGRAMMEE))
        assertEquals(R.string.resultat_tardif_titre to R.string.resultat_tardif_texte, Attente.textes(Issue.TARDIVE))
        assertEquals(R.string.resultat_trop_tard_titre to R.string.resultat_trop_tard_texte, Attente.textes(Issue.TROP_TARD))
        assertEquals(R.string.resultat_aucune_titre to R.string.resultat_aucune_texte, Attente.textes(Issue.AUCUNE))
        assertEquals(R.string.resultat_ko_titre to R.string.resultat_a_la_main, Attente.textes(Issue.NON_FAITE))
        assertEquals(R.string.resultat_ko_titre to R.string.resultat_verifier, Attente.textes(Issue.INCERTAINE))
        assertEquals(R.string.resultat_annulee_titre to R.string.resultat_a_la_main, Attente.textes(Issue.ANNULEE))
        assertEquals(R.string.resultat_inconnu_titre to R.string.resultat_verifier, Attente.textes(Issue.INCONNUE))
    }

    // Chaque issue a un texte qui dit quoi faire : jamais d'échec silencieux (règle 2).
    @Test fun toutesLesIssuesOntDesTextes() {
        for (i in Issue.values()) {
            val (t, x) = Attente.textes(i)
            assertTrue(t != 0 && x != 0)
        }
    }

    @Test fun seulsAucuneEtTropTardSontSansHeure() {
        assertEquals(setOf(Issue.AUCUNE, Issue.TROP_TARD), Issue.values().filter { Attente.sansHeure(it) }.toSet())
    }
}
