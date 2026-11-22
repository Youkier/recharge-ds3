package fr.rechargeds3.coque

import fr.rechargeds3.coque.cable.TransportException
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeNoException
import org.junit.Test
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

/**
 * Le transport natif est la seule porte vers le câble : tout sauf IPv4 privée:6668 est refusé AVANT toute socket
 * (le rappel [lier] n'est jamais appelé). Le chemin des données est essayé sur 127.0.0.1:6668 avec un filtre de test.
 */
class TransportTcpTest {
    private fun code(bloc: () -> Unit): String {
        try { bloc() } catch (e: TransportException) { return e.code }
        return "aucune erreur"
    }

    @Test fun refuseToutSaufIpv4PriveePort6668SansOuvrirDeSocket() {
        val liens = AtomicInteger()
        val cibles = listOf(
            "10.0.2.2" to 6669, "10.0.2.2" to 80, "10.0.2.2" to 0, "10.0.2.2" to -1,
            "127.0.0.1" to 6668, "169.254.1.1" to 6668, "0.0.0.0" to 6668, "8.8.8.8" to 6668, "255.255.255.255" to 6668,
            "010.0.0.1" to 6668, "0x0a.0.0.1" to 6668, "2130706433" to 6668, "::1" to 6668, "[::1]" to 6668,
            "localhost" to 6668, "exemple.test" to 6668, "10.0.2.2.nip.io" to 6668, "" to 6668, " 10.0.2.2" to 6668,
            "10.0.2.0" to 6668, "10.0.2.255" to 6668,
        )
        for ((ip, port) in cibles) {
            val t = TransportTcp { liens.incrementAndGet() }
            assertEquals("$ip:$port", "hors_ligne", code { t.ouvrir(ip, port, 1000) })
        }
        assertEquals("aucune socket n'a été liée au réseau, donc aucune connexion tentée", 0, liens.get())
    }

    @Test fun sondeRefuseLesMemesAdresses() {
        val liens = AtomicInteger()
        for (ip in listOf("127.0.0.1", "169.254.1.1", "8.8.8.8", "010.0.0.1", "localhost", "")) {
            assertFalse(ip, TransportTcp.sonder(ip, 400) { liens.incrementAndGet() })
        }
        assertEquals(0, liens.get())
    }

    @Test fun envoyerEtRecevoirSansConnexionSontRefuses() {
        val t = TransportTcp { }
        assertEquals("ferme", code { t.envoyer(byteArrayOf(1)) })
        assertEquals("ferme", code { t.recevoir(100) })
        t.fermer()
        t.fermer() // idempotent
    }

    private fun serveur(): ServerSocket {
        try {
            return ServerSocket(6668, 1, InetAddress.getByName("127.0.0.1"))
        } catch (e: java.io.IOException) {
            assumeNoException("port 6668 indisponible sur cette machine", e)
            throw e
        }
    }

    private fun transportDeTest() = TransportTcp.pourTest({ }, { ip -> if (ip == "127.0.0.1") byteArrayOf(127, 0, 0, 1) else null })

    @Test fun echangeDeDonneesPuisFermeture() {
        serveur().use { srv ->
            val recu = java.util.concurrent.LinkedBlockingQueue<ByteArray>()
            val fil = Thread {
                srv.accept().use { s ->
                    val tampon = ByteArray(64)
                    val n = s.getInputStream().read(tampon)
                    recu.add(tampon.copyOf(n))
                    s.getOutputStream().write(byteArrayOf(9, 8, 7))
                    s.getOutputStream().flush()
                    s.getInputStream().read() // jusqu'à la fermeture côté client
                }
            }.apply { isDaemon = true; start() }
            val t = transportDeTest()
            t.ouvrir("127.0.0.1", 6668, 1000)
            t.envoyer(byteArrayOf(1, 2, 3))
            assertArrayEquals(byteArrayOf(1, 2, 3), recu.poll(2, TimeUnit.SECONDS))
            assertArrayEquals(byteArrayOf(9, 8, 7), t.recevoir(2000))
            assertEquals("delai", code { t.recevoir(100) })
            // Une seule connexion par instance.
            assertEquals("hors_ligne", code { t.ouvrir("127.0.0.1", 6668, 1000) })
            // Au-delà de 2 Ko : refusé.
            assertEquals("ferme", code { t.envoyer(ByteArray(FiltreReseau.TAILLE_MAX + 1)) })
            t.fermer()
            fil.join(2000)
            assertFalse(fil.isAlive)
            assertEquals("ferme", code { t.envoyer(byteArrayOf(1)) })
        }
    }

    @Test fun fermerDepuisUnAutreFilDebloqueLaLecture() {
        serveur().use { srv ->
            val accepte = CountDownLatch(1)
            val fil = Thread { srv.accept().use { s -> accepte.countDown(); s.getInputStream().read() } }.apply { isDaemon = true; start() }
            val t = transportDeTest()
            t.ouvrir("127.0.0.1", 6668, 1000)
            assertTrue(accepte.await(2, TimeUnit.SECONDS))
            val resultat = java.util.concurrent.atomic.AtomicReference<String>()
            val lecteur = Thread { resultat.set(code { t.recevoir(10_000) }) }.apply { isDaemon = true; start() }
            Thread.sleep(200)
            t.fermer()
            lecteur.join(3000)
            assertFalse("la lecture doit être débloquée par fermer()", lecteur.isAlive)
            assertEquals("ferme", resultat.get())
            fil.join(2000)
        }
    }

    @Test fun ouvrirApresFermerEstRefuse() {
        val t = transportDeTest()
        t.fermer()
        assertEquals("ferme", code { t.ouvrir("127.0.0.1", 6668, 1000) })
    }

    @Test fun connexionImpossibleDonneHorsLigne() {
        // Port 6668 de 127.0.0.1 supposé fermé : on le vérifie, sinon le test n'a pas de sens ici.
        try { Socket("127.0.0.1", 6668).close(); return } catch (e: java.io.IOException) { /* fermé : attendu */ }
        val t = transportDeTest()
        assertEquals("hors_ligne", code { t.ouvrir("127.0.0.1", 6668, 500) })
    }

    @Test fun lierEstAppeleAvantLaConnexion() {
        serveur().use { srv ->
            val liens = AtomicInteger()
            val t = TransportTcp.pourTest({ liens.incrementAndGet() }, { byteArrayOf(127, 0, 0, 1) })
            val fil = Thread { try { srv.accept().close() } catch (e: java.io.IOException) { } }.apply { isDaemon = true; start() }
            t.ouvrir("127.0.0.1", 6668, 1000)
            assertEquals(1, liens.get())
            t.fermer()
            fil.join(2000)
        }
    }

    @Test fun uneErreurDeLiaisonDonneHorsLigne() {
        val t = TransportTcp.pourTest({ throw java.io.IOException("réseau perdu") }, { byteArrayOf(127, 0, 0, 1) })
        assertEquals("hors_ligne", code { t.ouvrir("127.0.0.1", 6668, 1000) })
    }
}
