package fr.rechargeds3.coque

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class FiltreReseauTest {
    @Test fun accepteLesTroisPlagesPrivees() {
        for (ip in listOf("10.0.2.2", "10.255.255.254", "172.16.0.1", "172.31.255.254", "192.168.1.48", "192.168.0.9")) {
            assertNotNull(ip, FiltreReseau.adressePrivee(ip))
        }
        assertArrayEquals(byteArrayOf(192.toByte(), 168.toByte(), 1, 48), FiltreReseau.adressePrivee("192.168.1.48"))
    }

    @Test fun refuseLesAdressesPubliquesEtSpeciales() {
        for (ip in listOf(
            "127.0.0.1", "127.1.2.3", "169.254.1.1", "0.0.0.0", "255.255.255.255", "255.1.1.1", "8.8.8.8", "1.1.1.1",
            "172.15.0.1", "172.32.0.1", "192.167.1.1", "192.169.1.1", "11.0.0.1",
        )) {
            assertNull(ip, FiltreReseau.adressePrivee(ip))
        }
    }

    @Test fun refuseLesEcrituresNonDecimalesStrictes() {
        for (ip in listOf(
            "010.0.0.1", "10.00.0.1", "10.0.0.01", "0x7f.1", "0x0a.0.0.1", "0xc0a80101", "3232235777", "2130706433",
            "10.1", "10.0.1", "10.0.0.1.1", "10.0.0.256", "10.0.0.-1", "10. 0.0.1", " 10.0.0.1", "10.0.0.1 ", "10.0.0.1\n",
            "::1", "::ffff:10.0.0.1", "fe80::1", "[::1]", "localhost", "10.0.0.1.nip.io", "x.nip.io", "٣.٣.٣.٣", "10.0.0.1:6668", "",
        )) {
            assertNull("«$ip»", FiltreReseau.adressePrivee(ip))
        }
        assertNull(FiltreReseau.adressePrivee(null))
    }

    @Test fun refuseLesAdressesDeReseauEtDeDiffusion() {
        assertNull(FiltreReseau.adressePrivee("192.168.1.0"))
        assertNull(FiltreReseau.adressePrivee("192.168.1.255"))
        assertNull(FiltreReseau.adressePrivee("10.0.2.0"))
        assertNotNull(FiltreReseau.adressePrivee("10.0.2.1"))
        assertNotNull(FiltreReseau.adressePrivee("10.0.2.254"))
    }

    @Test fun portSeulement6668() {
        assertTrue(FiltreReseau.portAutorise(6668))
        for (p in listOf(0, 1, 80, 443, 6667, 6669, 6666, 7000, 65535, -1, 66680)) assertFalse("$p", FiltreReseau.portAutorise(p))
    }

    @Test fun tailleBornee2Ko() {
        assertTrue(FiltreReseau.tailleAutorisee(0))
        assertTrue(FiltreReseau.tailleAutorisee(2048))
        assertFalse(FiltreReseau.tailleAutorisee(2049))
        assertFalse(FiltreReseau.tailleAutorisee(-1))
        assertFalse(FiltreReseau.tailleAutorisee(Int.MAX_VALUE))
    }

    @Test fun origineSeulementAppassetsEnHttps() {
        assertTrue(FiltreReseau.origineAutorisee("https", "appassets.androidplatform.net", -1))
        assertTrue(FiltreReseau.origineAutorisee("https", "appassets.androidplatform.net", 443))
        assertFalse(FiltreReseau.origineAutorisee("http", "appassets.androidplatform.net", -1))
        assertFalse(FiltreReseau.origineAutorisee("https", "appassets.androidplatform.net", 8443))
        assertFalse(FiltreReseau.origineAutorisee("https", "evil.appassets.androidplatform.net", -1))
        assertFalse(FiltreReseau.origineAutorisee("https", "appassets.androidplatform.net.evil.com", -1))
        assertFalse(FiltreReseau.origineAutorisee("https", "example.org", -1))
        assertFalse(FiltreReseau.origineAutorisee("file", "", -1))
        assertFalse(FiltreReseau.origineAutorisee(null, null, -1))
    }

    @Test fun delaisBornes() {
        assertEquals(400L, FiltreReseau.delaiBorne(null, 50, 1000, 400))
        assertEquals(50L, FiltreReseau.delaiBorne(1, 50, 1000, 400))
        assertEquals(1000L, FiltreReseau.delaiBorne(600_000, 50, 1000, 400))
        assertEquals(700L, FiltreReseau.delaiBorne(700, 50, 1000, 400))
        assertEquals(50L, FiltreReseau.delaiBorne(-5, 50, 1000, 400))
    }

    @Test fun prefixeEstLeReseau24SeulementPourUneAdressePrivee() {
        assertEquals("10.0.2", FiltreReseau.prefixe24(byteArrayOf(10, 0, 2, 15)))
        assertEquals("192.168.1", FiltreReseau.prefixe24(byteArrayOf(192.toByte(), 168.toByte(), 1, 77)))
        assertNull(FiltreReseau.prefixe24(byteArrayOf(8, 8, 8, 8)))
        assertNull(FiltreReseau.prefixe24(byteArrayOf(127, 0, 0, 1)))
        assertNull(FiltreReseau.prefixe24(byteArrayOf(10, 0, 2)))
    }
}
