package fr.rechargeds3.coque

import org.junit.Assert.assertEquals
import org.junit.Test

class SuiviDemarragesTest {
    @Test fun l_arret_vise_le_dernier_demarrage() {
        val s = SuiviDemarrages()
        s.enregistrer(1); s.enregistrer(2); s.enregistrer(3)
        assertEquals(3, s.pourArret())
    }

    @Test fun un_demarrage_ancien_arrive_tard_ne_fait_pas_reculer_l_identifiant() {
        val s = SuiviDemarrages()
        s.enregistrer(5); s.enregistrer(2)
        assertEquals(5, s.pourArret())
    }
}
