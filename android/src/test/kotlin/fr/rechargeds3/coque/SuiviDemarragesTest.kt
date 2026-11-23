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

    @Test fun course_nouvelle_attente_avant_le_post_de_fin_relance_la_boucle() {
        // Fin de l'attente 1, puis nouvelle attente (startId 2 enregistré) : à l'exécution du post, le pilote est en ATTENTE.
        val s = SuiviDemarrages()
        s.enregistrer(1); s.enregistrer(2)
        assertEquals(SuiviDemarrages.Suite.RELANCER, SuiviDemarrages.suiteApresFin(Phase.ATTENTE))
    }

    @Test fun hors_attente_la_fin_arrete_le_service() {
        for (p in listOf(Phase.INACTIVE, Phase.ENVOI, Phase.TERMINEE))
            assertEquals(SuiviDemarrages.Suite.ARRETER, SuiviDemarrages.suiteApresFin(p))
    }
}
