package fr.rechargeds3.coque

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.Closeable

class RegistreTest {
    private class Faux : Closeable {
        var fermetures = 0
        override fun close() { fermetures++ }
    }

    @Test fun uneSeuleConnexionALaFois() {
        val r = Registre<Faux>()
        val a = r.reserver()
        assertNotNull(a)
        assertNull("une deuxième réservation est refusée", r.reserver())
        assertTrue(r.installer(a!!, Faux()))
        assertNull(r.reserver())
        assertTrue(r.fermer(a))
        assertNotNull("l'emplacement est libre après fermeture", r.reserver())
    }

    @Test fun fermerEstIdempotent() {
        val r = Registre<Faux>()
        val f = Faux()
        val id = r.reserver()!!
        r.installer(id, f)
        assertTrue(r.fermer(id))
        assertFalse("deuxième fermeture : rien à faire", r.fermer(id))
        assertEquals("la ressource n'est fermée qu'une fois", 1, f.fermetures)
    }

    @Test fun unFermerTardifNeCoupePasLAppelSuivant() {
        val r = Registre<Faux>()
        val ancien = r.reserver()!!
        val f1 = Faux()
        r.installer(ancien, f1)
        r.fermer(ancien)
        val nouveau = r.reserver()!!
        assertNotEquals(ancien, nouveau)
        val f2 = Faux()
        r.installer(nouveau, f2)
        assertFalse("l'ancien identifiant est périmé", r.fermer(ancien))
        assertEquals(0, f2.fermetures)
        assertNotNull(r.obtenir(nouveau))
        assertNull("opération sur un identifiant périmé refusée", r.obtenir(ancien))
    }

    @Test fun identifiantsJamaisReutilises() {
        val r = Registre<Faux>()
        val vus = HashSet<Int>()
        repeat(50) {
            val id = r.reserver()!!
            assertTrue(vus.add(id))
            r.installer(id, Faux())
            r.fermer(id)
        }
    }

    @Test fun fermetureDurantLOuvertureFermeLaConnexionArriveeTropTard() {
        val r = Registre<Faux>()
        val id = r.reserver()!!
        assertTrue(r.fermer(id)) // la page a abandonné pendant la connexion
        val f = Faux()
        assertFalse(r.installer(id, f))
        assertEquals("la connexion arrivée trop tard est fermée", 1, f.fermetures)
        assertNotNull(r.reserver())
    }

    @Test fun echecDOuvertureLibereLEmplacement() {
        val r = Registre<Faux>()
        val id = r.reserver()!!
        r.liberer(id)
        assertNotNull(r.reserver())
    }

    @Test fun fermerToutFermeLaConnexionCourante() {
        val r = Registre<Faux>()
        val f = Faux()
        r.installer(r.reserver()!!, f)
        r.fermerTout()
        assertEquals(1, f.fermetures)
        assertFalse(r.ouverte())
        r.fermerTout() // sans effet
        assertEquals(1, f.fermetures)
    }

    @Test fun obtenirSansConnexionRendNull() {
        assertNull(Registre<Faux>().obtenir(1))
    }
}
