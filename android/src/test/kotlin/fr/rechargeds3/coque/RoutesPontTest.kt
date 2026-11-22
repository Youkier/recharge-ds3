package fr.rechargeds3.coque

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class RoutesPontTest {
    @Test fun lesOperationsDeMiseAuPointSontRefuseesEnPublication() {
        for (op in RoutesPont.MISE_AU_POINT) {
            assertTrue(op, RoutesPont.autorisee(op, estDebug = true))
            assertFalse(op, RoutesPont.autorisee(op, estDebug = false))
        }
    }

    @Test fun lesOperationsPubliquesSontAutoriseesPartout() {
        for (op in RoutesPont.PUBLIQUES) {
            assertTrue(op, RoutesPont.autorisee(op, true))
            assertTrue(op, RoutesPont.autorisee(op, false))
        }
    }

    // E3 : la clé ne se garde plus à la demande de la page (memoriser, oublierMemoire), l'attente n'a plus de « fin » écrite par la page
    // (attenteFin) et la mise au point ne démarre plus le service (essaiArrierePlan) : le pilote natif tient tout.
    @Test fun lesAnciennesRoutesDeLAttenteDeLaPageSontSupprimees() {
        for (op in listOf("memoriser", "oublierMemoire", "attenteFin", "essaiArrierePlan")) {
            assertFalse(op, RoutesPont.autorisee(op, true))
            assertFalse(op, RoutesPont.autorisee(op, false))
        }
    }

    @Test fun lAttenteSeResumeAQuatreOperations() {
        assertEquals(setOf("attenteDebut", "attenteEtat", "attenteAnnuler", "attenteAcquitter"), RoutesPont.PUBLIQUES.filter { it.startsWith("attente") }.toSet())
    }

    @Test fun aucuneRouteGeneriqueNiInconnue() {
        for (op in listOf("ouvrir", "envoyer", "recevoir", "fermer", "sonder", "retenirAdresse", "", "LIRE", "lire ", "essai", "cle")) {
            assertFalse(op, RoutesPont.autorisee(op, true))
            assertFalse(op, RoutesPont.autorisee(op, false))
        }
    }
}
