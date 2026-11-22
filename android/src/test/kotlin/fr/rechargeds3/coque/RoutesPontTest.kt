package fr.rechargeds3.coque

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

    @Test fun aucuneRouteGeneriqueNiInconnue() {
        for (op in listOf("ouvrir", "envoyer", "recevoir", "fermer", "sonder", "retenirAdresse", "", "LIRE", "lire ", "essai", "cle")) {
            assertFalse(op, RoutesPont.autorisee(op, true))
            assertFalse(op, RoutesPont.autorisee(op, false))
        }
    }
}
