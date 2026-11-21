package fr.rechargeds3.coque

import fr.rechargeds3.coque.Attente.Issue
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AttenteTest {
    @Test fun heuresValides() {
        for (h in listOf("00:00", "05:59", "09:30", "19:05", "22:00", "23:59")) assertTrue(h, Attente.heureValide(h))
    }

    @Test fun heuresRefusees() {
        for (h in listOf(null, "", "24:00", "7:30", "07:3", "07:60", "07h30", " 07:30", "07:30 ", "07:30\n", "١٢:٠٠", "0a:00", "07:30:00")) {
            assertFalse(h.toString(), Attente.heureValide(h))
        }
    }

    @Test fun heureRecueFacultative() {
        assertNull(Attente.heureRecue(null))
        assertNull(Attente.heureRecue(""))
        assertEquals("05:59", Attente.heureRecue("05:59"))
        assertEquals(Attente.INVALIDE, Attente.heureRecue("25:00"))
        assertEquals(Attente.INVALIDE, Attente.heureRecue("Charge programmée"))
    }

    @Test fun issueSelonLeResultat() {
        assertEquals(Issue.PROGRAMMEE, Attente.issue("ok", false))
        assertEquals(Issue.PROGRAMMEE, Attente.issue("ok", true))
        assertEquals(Issue.NON_FAITE, Attente.issue("ko", false))
        assertEquals(Issue.INCERTAINE, Attente.issue("ko", true))
        assertEquals(Issue.ANNULEE, Attente.issue("annulee", false))
        for (r in listOf(null, "", "OK", "inconnu", "appli_fermee", "ok ")) assertNull(r.toString(), Attente.issue(r, false))
    }

    @Test fun textesAvecHeure() {
        assertEquals(R.string.resultat_ok_titre to R.string.resultat_ok_texte, Attente.textes(Issue.PROGRAMMEE, true))
        assertEquals(R.string.resultat_ko_titre to R.string.resultat_a_la_main, Attente.textes(Issue.NON_FAITE, true))
        assertEquals(R.string.resultat_ko_titre to R.string.resultat_verifier, Attente.textes(Issue.INCERTAINE, true))
        assertEquals(R.string.resultat_annulee_titre to R.string.resultat_a_la_main, Attente.textes(Issue.ANNULEE, true))
        assertEquals(R.string.resultat_inconnu_titre to R.string.resultat_verifier, Attente.textes(Issue.INCONNUE, true))
        assertEquals(R.string.resultat_fermee_titre to R.string.resultat_fermee_texte, Attente.textes(Issue.APPLI_FERMEE, true))
    }

    @Test fun textesSansHeure() {
        assertEquals(R.string.resultat_ok_titre_sans_heure to R.string.resultat_ok_texte, Attente.textes(Issue.PROGRAMMEE, false))
        assertEquals(R.string.resultat_ko_titre to R.string.resultat_a_la_main_sans_heure, Attente.textes(Issue.NON_FAITE, false))
        assertEquals(R.string.resultat_ko_titre to R.string.resultat_verifier_sans_heure, Attente.textes(Issue.INCERTAINE, false))
        assertEquals(R.string.resultat_annulee_titre to R.string.resultat_a_la_main_sans_heure, Attente.textes(Issue.ANNULEE, false))
        assertEquals(R.string.resultat_inconnu_titre to R.string.resultat_verifier_sans_heure, Attente.textes(Issue.INCONNUE, false))
        assertEquals(R.string.resultat_fermee_titre to R.string.resultat_fermee_texte_sans_heure, Attente.textes(Issue.APPLI_FERMEE, false))
    }

    // Chaque issue a un texte qui dit quoi faire : jamais d'échec silencieux (règle 2).
    @Test fun toutesLesIssuesOntDesTextes() {
        for (i in Issue.values()) for (avec in listOf(true, false)) {
            val (t, x) = Attente.textes(i, avec)
            assertTrue(t != 0 && x != 0)
        }
    }
}
