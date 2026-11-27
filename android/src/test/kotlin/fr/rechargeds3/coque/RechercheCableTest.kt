package fr.rechargeds3.coque

import fr.rechargeds3.coque.cable.Resultat
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.atomic.AtomicInteger

class RechercheCableTest {
    private val bon = Resultat(true, debut = "03:30", fin = "06:00", plageActive = true)
    private val mauvaise = Resultat(false, "cle")

    @Test fun candidatsSontLes254HotesDuReseauPrive() {
        val c = RechercheCable.candidats("192.168.1")
        assertEquals(254, c.size)
        assertEquals("192.168.1.1", c.first())
        assertEquals("192.168.1.254", c.last())
        assertTrue(RechercheCable.candidats("8.8.8").isEmpty())
        assertTrue(RechercheCable.candidats("127.0.0").isEmpty())
        assertTrue(RechercheCable.candidats("exemple").isEmpty())
    }

    @Test fun adresseDeDepartQuiRepondEstRendueSansFouille() {
        val sondes = AtomicInteger()
        val r = RechercheCable.chercher(
            listOf("10.0.2.2"), "10.0.2", sonder = { _, _ -> sondes.incrementAndGet(); false },
            lire = { ip, _ -> if (ip == "10.0.2.2") bon else mauvaise },
        )
        assertTrue(r.ok); assertEquals("10.0.2.2", r.ip); assertFalse(r.trouve)
        assertEquals(0, sondes.get())
    }

    @Test fun departMuetPuisFouilleTrouveLeCable() {
        val lues = CopyOnWriteArrayList<String>()
        val r = RechercheCable.chercher(
            listOf("10.0.2.250"), "10.0.2",
            sonder = { ip, _ -> ip == "10.0.2.2" || ip == "10.0.2.77" },
            lire = { ip, _ -> lues.add(ip); if (ip == "10.0.2.2") bon else mauvaise },
        )
        assertTrue(r.ok); assertEquals("10.0.2.2", r.ip); assertTrue(r.trouve)
        assertFalse("l'adresse de départ n'est pas relue pendant la fouille", lues.filter { it == "10.0.2.250" }.size > 1)
        assertTrue("un autre appareil Tuya est lu aussi, mais seule la bonne clé compte", "10.0.2.77" in lues)
    }

    @Test fun departsNonPrivesOuEnDoubleSontIgnores() {
        val lues = CopyOnWriteArrayList<String>()
        RechercheCable.chercher(
            listOf("8.8.8.8", "10.0.2.5", "10.0.2.5", "127.0.0.1"), "10.0.2", sonder = { _, _ -> false },
            lire = { ip, _ -> lues.add(ip); mauvaise },
        )
        assertEquals(listOf("10.0.2.5"), lues.toList())
    }

    @Test fun deuxCablesRepondentEchecJamaisDeChoixAuHasard() {
        val r = RechercheCable.chercher(
            emptyList(), "10.0.2", sonder = { ip, _ -> ip == "10.0.2.2" || ip == "10.0.2.3" }, lire = { _, _ -> bon },
        )
        assertFalse(r.ok); assertNull(r.ip)
    }

    @Test fun aucunCableEchec() {
        val r = RechercheCable.chercher(emptyList(), "10.0.2", sonder = { _, _ -> false }, lire = { _, _ -> bon })
        assertFalse(r.ok)
    }

    @Test fun uneSondeQuiLeveUneExceptionEstUnPortFerme() {
        val r = RechercheCable.chercher(
            emptyList(), "10.0.2", sonder = { ip, _ -> if (ip == "10.0.2.9") throw IllegalStateException("boum") else ip == "10.0.2.4" },
            lire = { _, _ -> bon },
        )
        assertTrue(r.ok); assertEquals("10.0.2.4", r.ip)
    }

    @Test fun lesLecturesSontUneParUne() {
        val enCours = AtomicInteger(); val maxi = AtomicInteger()
        RechercheCable.chercher(
            emptyList(), "10.0.2", sonder = { _, _ -> true },
            lire = { _, _ ->
                val n = enCours.incrementAndGet(); maxi.accumulateAndGet(n) { a, b -> maxOf(a, b) }
                Thread.sleep(2); enCours.decrementAndGet(); mauvaise
            },
            delaiTotalMs = 3000,
        )
        assertEquals(1, maxi.get())
    }

    @Test fun leDelaiDeLectureEstBorneParLeTempsRestant() {
        var t = 0L
        val delais = CopyOnWriteArrayList<Long>()
        RechercheCable.chercher(
            listOf("10.0.2.5"), "10.0.2", sonder = { _, _ -> false },
            lire = { _, d -> delais.add(d); t += 29_500; mauvaise },
            delaiTotalMs = 30_000, maintenant = { t },
        )
        assertEquals(listOf(8_000L), delais.toList())
        // Il ne reste plus que 500 ms : la fouille n'a pas lieu (échéance atteinte pendant la lecture).
        t = 0
        delais.clear()
        RechercheCable.chercher(
            listOf("10.0.2.5", "10.0.2.6"), "10.0.2", sonder = { _, _ -> false },
            lire = { _, d -> delais.add(d); t += 25_000; mauvaise },
            delaiTotalMs = 30_000, maintenant = { t },
        )
        assertEquals(listOf(8_000L, 5_000L), delais.toList())
    }

    @Test fun annulationExterieureArreteTout() {
        val sondes = AtomicInteger()
        val r = RechercheCable.chercher(
            emptyList(), "10.0.2", sonder = { _, _ -> sondes.incrementAndGet(); false }, lire = { _, _ -> bon },
            annule = { true },
        )
        assertFalse(r.ok)
        assertEquals(0, sondes.get())
    }

    @Test fun progresSansAdresseEtPlusRienApresLeRetour() {
        val vus = CopyOnWriteArrayList<Progres>()
        val r = RechercheCable.chercher(
            emptyList(), "10.0.2", sonder = { ip, _ -> ip == "10.0.2.2" }, lire = { _, _ -> bon },
            progres = { vus.add(it) }, maintenant = { 1_000L },
        )
        assertTrue(r.ok)
        val avant = vus.size
        assertTrue(avant >= 2)
        assertEquals("sondes", vus.first().etape)
        assertTrue(vus.any { it.etape == "lectures" && it.lectures == 1 && it.appareils == 1 })
        assertTrue(vus.all { it.echeanceMs == 31_000L })
        Thread.sleep(100)
        assertEquals("aucun rappel après le retour", avant, vus.size)
    }

    @Test fun uneExceptionDuRappelDeProgresEstSansEffet() {
        val r = RechercheCable.chercher(
            emptyList(), "10.0.2", sonder = { ip, _ -> ip == "10.0.2.2" }, lire = { _, _ -> bon },
            progres = { throw IllegalStateException("page détruite") },
        )
        assertTrue(r.ok)
    }

    @Test fun sondesImpossiblesRendentReseauPasPretMaisPasUneSondeAbouties() {
        val r = RechercheCable.chercher(emptyList(), "10.0.2", sonder = { _, _ -> throw SondeImpossible() }, lire = { _, _ -> bon })
        assertFalse(r.ok); assertTrue(r.reseauPasPret)
        // Une seule sonde aboutie (même fermée) : le réseau était prêt, c'est « introuvable ».
        val r2 = RechercheCable.chercher(
            emptyList(), "10.0.2", sonder = { ip, _ -> if (ip == "10.0.2.1") false else throw SondeImpossible() }, lire = { _, _ -> bon },
        )
        assertFalse(r2.ok); assertFalse(r2.reseauPasPret)
        assertFalse(RechercheCable.chercher(emptyList(), "10.0.2", sonder = { _, _ -> false }, lire = { _, _ -> bon }).reseauPasPret)
    }
}
