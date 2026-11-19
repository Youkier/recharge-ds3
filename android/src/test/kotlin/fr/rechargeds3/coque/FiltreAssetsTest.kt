package fr.rechargeds3.coque

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class FiltreAssetsTest {
    @Test fun serviLesFichiersWebConnusAvecUnTypeFixe() {
        assertEquals("text/html", FiltreAssets.typeMime("android/essai/index.html"))
        assertEquals("text/javascript", FiltreAssets.typeMime("local/tuya-local.js"))
        assertEquals("text/javascript", FiltreAssets.typeMime("site/calc.js"))
        assertEquals("text/css", FiltreAssets.typeMime("site/style.css"))
        assertEquals("application/json", FiltreAssets.typeMime("site/vehicules.json"))
        assertEquals("image/png", FiltreAssets.typeMime("site/icons/icon-192.png"))
        assertEquals("application/manifest+json", FiltreAssets.typeMime("site/manifest.webmanifest"))
    }

    @Test fun swJsEstTouteJoursIntrouvable() {
        assertNull(FiltreAssets.typeMime("site/sw.js"))
        assertNull(FiltreAssets.typeMime("sw.js"))
        assertNull(FiltreAssets.typeMime("android/essai/sw.js"))
    }

    @Test fun refuseLesCheminsDangereux() {
        for (c in listOf(
            "../site/index.html", "site/../../etc/passwd", "site/./index.html", "/site/index.html", "site//index.html", "site/", "",
            "site/.env", ".env", "site/.cache/x.js", "site\\index.html", "site/index.html?x=1", "site/ index.html", "site/é.js",
            "site/index.html%2e%2e",
        )) {
            assertNull("«$c»", FiltreAssets.typeMime(c))
        }
    }

    @Test fun refuseLesExtensionsInconnuesOuAbsentes() {
        for (c in listOf("site/cles.pem", "site/app.apk", "site/notes.md", "site/sans-extension", "site/fichier.", "site/archive.zip", "site/script.php")) {
            assertNull(c, FiltreAssets.typeMime(c))
        }
    }

    @Test fun texteOuBinaire() {
        assertTrue(FiltreAssets.estTexte("site/app.js"))
        assertFalse(FiltreAssets.estTexte("site/icons/icon-192.png"))
    }

    @Test fun saisieIdentifiantEtCle() {
        assertTrue(Saisie.identifiantValide("bf1234567890abcdef"))
        assertFalse(Saisie.identifiantValide(""))
        assertFalse(Saisie.identifiantValide("a b"))
        assertFalse(Saisie.identifiantValide("x".repeat(65)))
        assertTrue(Saisie.cleValide("CLE-FACTICE-0000"))
        assertFalse(Saisie.cleValide("trop courte"))
        assertFalse(Saisie.cleValide("CLE-FACTICE-00000"))
        assertFalse(Saisie.cleValide("CLE FACTICE 0000"))
        assertFalse(Saisie.cleValide("CLE-FACTICE-00é€"))
    }
}
