package fr.rechargeds3.coque.cable

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class JsonStrictTest {
    private fun refuse(texte: String) {
        try {
            JsonStrict.parser(texte)
        } catch (e: ErreurJson) {
            assertEquals("json", e.message) // message fixe : jamais un extrait du texte
            return
        }
        fail("accepté à tort : «$texte»")
    }

    @Test fun lOrdreDesClesEstGarde() {
        val o = JsonStrict.objet(JsonStrict.parser("{\"b\":1,\"a\":2,\"150\":3,\"2\":4}"))!!
        assertEquals(listOf("b", "a", "150", "2"), o.keys.toList()) // JS range « 150 » et « 2 » en premier : pas ici
    }

    @Test fun cleEnDoubleGardeSaPremierePlaceEtLaDerniereValeur() {
        val o = JsonStrict.objet(JsonStrict.parser("{\"a\":1,\"b\":2,\"a\":3}"))!!
        assertEquals(listOf("a", "b"), o.keys.toList())
        assertEquals(3L, o["a"])
    }

    @Test fun utf8InvalideRefuse() {
        val invalides = listOf(
            byteArrayOf(0xC3.toByte(), 0x28), // suite invalide
            byteArrayOf(0xFF.toByte()),
            byteArrayOf(0xC0.toByte(), 0x80.toByte()), // forme trop longue
            byteArrayOf(0xED.toByte(), 0xA0.toByte(), 0x80.toByte()), // moitié de paire de substitution
            byteArrayOf(0xE2.toByte(), 0x82.toByte()), // coupé
            byteArrayOf(0xF4.toByte(), 0x90.toByte(), 0x80.toByte(), 0x80.toByte()), // au-delà de U+10FFFF
        )
        for (b in invalides) {
            assertNull(b.joinToString(), JsonStrict.decoderUtf8(b))
            try {
                JsonStrict.parserOctets("\"".toByteArray() + b + "\"".toByteArray())
                fail("accepté à tort")
            } catch (e: ErreurJson) {
                // attendu
            }
        }
    }

    @Test fun utf8ValideEtBomAcceptes() {
        assertEquals("é€😀", JsonStrict.parserOctets("\"é€😀\"".toByteArray(Charsets.UTF_8)))
        val avecBom = byteArrayOf(0xEF.toByte(), 0xBB.toByte(), 0xBF.toByte()) + "{}".toByteArray()
        assertEquals(emptyMap<String, Any?>(), JsonStrict.parserOctets(avecBom))
    }

    @Test fun refuseCeQueJsonParseRefuse() {
        for (t in listOf(
            "", "  ", "[1,]", "{\"a\":1,}", "01", "+1", ".5", "1.", "1e", "-", "--1", "\"a\nb\"", "'a'", "{\"a\"}", "{a:1}", "nul", "tru",
            "[1 2]", "[", "{", "\"abc", "{} x", "[] []", "\"\\x\"", "\"\\u12\"", "\"\\u12G4\"", "{\"a\":}", "NaN", "Infinity", "0x10", "[1,,2]",
            "{\"a\":1 \"b\":2}", "\u00A0{}", "\"\u0001\"",
        )) refuse(t)
    }

    @Test fun profondeurLimitee() {
        val ok = "[".repeat(30) + "]".repeat(30)
        JsonStrict.parser(ok)
        refuse("[".repeat(40) + "]".repeat(40))
        refuse("[".repeat(100_000)) // pas de débordement de pile
    }

    @Test fun nombres() {
        assertEquals(16L, JsonStrict.parser("16"))
        assertEquals(0L, JsonStrict.parser("-0"))
        assertEquals(-5L, JsonStrict.parser("-5"))
        assertEquals(100L, JsonStrict.parser("1e2"))
        assertEquals(1.5, JsonStrict.parser("1.5"))
        assertEquals(12345678901234567890.0, JsonStrict.parser("12345678901234567890"))
        assertEquals(1794868200L, JsonStrict.parser("1794868200"))
    }

    @Test fun litteraux() {
        assertEquals(true, JsonStrict.parser(" true "))
        assertEquals(false, JsonStrict.parser("false"))
        assertNull(JsonStrict.parser("null"))
        assertEquals(listOf<Any?>(1L, "a", null, true), JsonStrict.parser("[1, \"a\", null, true]"))
        assertEquals("a\"b\\c/d\n\t\u00e9\u0001", JsonStrict.parser("\"a\\\"b\\\\c\\/d\\n\\t\\u00e9\\u0001\""))
    }

    @Test fun serialiserEstCompactEtIdentiqueAJsonStringify() {
        val texte = "{\"L1\":[2200,0,0],\"t\":230,\"p\":0,\"d\":0,\"e\":0,\"x\":\"a\\\"b\",\"n\":null,\"v\":true,\"o\":{}}"
        assertEquals(texte, JsonStrict.serialiser(JsonStrict.parser(texte)))
        assertEquals("[1,2,3]", JsonStrict.serialiser(JsonStrict.parser(" [ 1 , 2 , 3 ] ")))
        assertEquals("\"a\\\"b\\\\c\\n\\u0001é\"", JsonStrict.chaine("a\"b\\c\n\u0001é"))
        assertEquals("\"\\b\\f\\r\\t\\u001f\"", JsonStrict.chaine("\b\u000C\r\t\u001f"))
    }

    @Test fun objetNeRendQueDesObjets() {
        assertNull(JsonStrict.objet(listOf(1L)))
        assertNull(JsonStrict.objet("x"))
        assertNull(JsonStrict.objet(null))
        assertTrue(JsonStrict.objet(JsonStrict.parser("{}")) != null)
    }
}
