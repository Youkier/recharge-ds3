package fr.rechargeds3.coque.cable

import fr.rechargeds3.coque.cable.Aides.hex
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.ByteArrayOutputStream
import java.io.PrintStream
import java.time.ZonedDateTime
import java.util.Base64

/**
 * Jumeau de tests/tuya-local.test.mjs et de tests/local-ecriture-coupee.test.mjs : un test pour chaque cas du JS,
 * contre le faux câble en mémoire (clé factice). Ne sont pas repris : les cas de l'API JS elle-même (liste des
 * exports, `version`, `simuler`, champs de `cfg`, formes de `action` impossibles en Kotlin typé), le filtre d'adresses
 * du transport Node et la ligne de commande ; ils n'ont pas d'équivalent dans ce module.
 */
class ClientCableTest {
    private val cleTexte = "CLE-FACTICE-0000"
    private val cle = cleTexte.toByteArray(Charsets.ISO_8859_1)
    private val maintenantV = { ZonedDateTime.parse("2026-11-16T22:30:00Z") }
    private val sansPause: (Long) -> Unit = {}

    private fun plage(m: Int, ss: String, se: String, dt: Int = 0): String = "{\"m\":$m,\"dt\":$dt,\"ss\":\"$ss\",\"se\":\"$se\"}"

    private fun dpsBase(p151: Any? = plage(2, "03:30", "06:00")): Map<String, Any?> = linkedMapOf(
        "101" to 202L, "102" to "{\"p\":0}", "107" to "[6,8,10,13,16]", "109" to "WAIT", "150" to 16L, "151" to p151, "152" to 16L,
    )

    private fun cfg(cleLocale: ByteArray = cle.copyOf(), delai: Long = 20_000) = ConfigCable("factice_000000000000", cleLocale, "192.0.2.10", delai)

    private fun fauxAvec(
        dps: Map<String, Any?> = dpsBase(),
        cleCable: String = cleTexte,
        cleFausse: String = "repondre",
        silenceLecture: Boolean = false,
        ignorerEcriture: Boolean = false,
        veille: Boolean = false,
        transformerEcriture: ((String) -> String)? = null,
        effetsEcriture: Map<String, Any?> = emptyMap(),
        formatLecture: String = "dps",
        decouper: Boolean = false,
        grouper: Boolean = false,
        sansAccuse: Boolean = false,
        bloquer: Boolean = false,
        ouvrirEchoue: Boolean = false,
    ) = FauxCable(
        OptionsFaux(
            cle = cleCable, dps = dps, cleFausse = cleFausse, silenceLecture = silenceLecture, ignorerEcriture = ignorerEcriture,
            veille = veille, transformerEcriture = transformerEcriture, effetsEcriture = effetsEcriture, formatLecture = formatLecture,
            decouper = decouper, grouper = grouper, sansAccuse = sansAccuse, bloquer = bloquer, ouvrirEchoue = ouvrirEchoue,
        ),
    )

    private fun prog(t: Transport, action: Action, maintenant: () -> ZonedDateTime = maintenantV, config: ConfigCable = cfg()) =
        ClientCable.programmer(config, t, action, maintenant, sansPause)

    private fun lire(t: Transport, config: ConfigCable = cfg()) = ClientCable.lireEtat(config, t)

    private fun instant(s: String): () -> ZonedDateTime = { ZonedDateTime.parse(s) }

    private fun valeur151(f: FauxCable, rang: Int = 0): String {
        @Suppress("UNCHECKED_CAST")
        val data = f.ecritures[rang].corps["data"] as Map<String, Any?>
        @Suppress("UNCHECKED_CAST")
        val dps = data["dps"] as Map<String, Any?>
        return dps["151"] as String
    }

    private fun clesDe(v: Any?): List<String> = (v as Map<*, *>).keys.map { it as String }

    // --- Lecture ---

    @Test fun lectureEtatLuConnexionFermeePort6668() {
        val f = fauxAvec()
        assertEquals(Resultat(true, debut = "03:30", fin = "06:00", plageActive = true), lire(f))
        assertEquals(1, f.fermetures.get())
        assertEquals(1, f.ouvertures.get())
        assertEquals(6668, f.port)
        assertTrue(f.ecritures.isEmpty())
    }

    @Test fun lecturePlageInactive() {
        val f = fauxAvec(dps = dpsBase(plage(0, "03:30", "06:00")))
        assertEquals(false, lire(f).plageActive)
    }

    @Test fun lectureFormatsDeReponseDataEtEntete() {
        for (format in listOf("data", "entete")) {
            val f = fauxAvec(formatLecture = format)
            assertTrue(format, lire(f).ok)
        }
    }

    @Test fun lectureTrameCoupeeEnDeux() {
        assertEquals("03:30", lire(fauxAvec(decouper = true)).debut)
    }

    @Test fun lectureCableHorsLigne() {
        val f = fauxAvec(ouvrirEchoue = true)
        assertEquals(Resultat(false, "hors_ligne"), lire(f))
        assertEquals(1, f.fermetures.get())
    }

    @Test fun lectureSansReponseDelai() {
        val f = fauxAvec(silenceLecture = true)
        assertEquals(Resultat(false, "delai"), lire(f))
        assertEquals(1, f.fermetures.get())
    }

    @Test fun lectureEcheanceGlobaleTransportQuiNeRendJamaisLaMain() {
        val f = fauxAvec(bloquer = true)
        val debut = System.nanoTime()
        val r = lire(f, cfg(delai = 60))
        assertEquals(Resultat(false, "delai"), r)
        assertEquals(1, f.fermetures.get()) // fermé une seule fois, par l'échéance
        assertTrue("l'échéance doit débloquer vite", (System.nanoTime() - debut) / 1_000_000 < 5_000)
    }

    @Test fun lectureValeurDeFormatInattendu() {
        val f = fauxAvec(dps = dpsBase("pas du json"))
        assertEquals(Resultat(false, "format"), lire(f))
    }

    // --- Clé fausse ---

    @Test fun cleLeCableRepondAvecSaPropreCle() {
        val f = fauxAvec(cleCable = "AUTRE-CLE-FAUSSE")
        assertEquals(Resultat(false, "cle"), lire(f))
        assertEquals(1, f.fermetures.get())
    }

    @Test fun cleLeCableFermeLaConnexionPendantLaNegociation() {
        val f = fauxAvec(cleCable = "AUTRE-CLE-FAUSSE", cleFausse = "fermer")
        assertEquals(Resultat(false, "cle"), lire(f))
    }

    @Test fun cleLeCableNeRepondPasDuTout() {
        val f = fauxAvec(cleCable = "AUTRE-CLE-FAUSSE", cleFausse = "silence")
        assertEquals(Resultat(false, "delai"), lire(f)) // pas de conclusion sur la clé
    }

    @Test fun cleDeMauvaiseLongueurSansOuvrirDeConnexion() {
        for (taille in listOf(0, 5, 15, 17, 32)) {
            val f = fauxAvec()
            assertEquals("taille $taille", Resultat(false, "cle"), lire(f, cfg(cleLocale = ByteArray(taille) { 65 })))
            assertEquals(0, f.ouvertures.get())
        }
    }

    @Test fun laCleDeLAppelantNEstJamaisModifiee() {
        val maCle = cle.copyOf()
        lire(fauxAvec(), cfg(cleLocale = maCle))
        assertArrayEquals(cle, maCle) // l'opération travaille sur une copie, mise à zéro à la fin
    }

    // --- Programmer ---

    @Test fun programmerEcritureNormaleSeulsSsEtMChangent() {
        val f = fauxAvec()
        val r = prog(f, alle("00:15"))
        assertEquals(Resultat(true, debut = "00:15", fin = "06:00", plageActive = true), r)
        assertEquals(1, f.ecritures.size)
        val e = f.ecritures[0]
        assertEquals("3.5", e.entete)
        assertEquals(listOf("protocol", "t", "data"), clesDe(e.corps))
        assertEquals(5L, e.corps["protocol"])
        assertEquals(maintenantV().toEpochSecond(), e.corps["t"])
        @Suppress("UNCHECKED_CAST")
        val data = e.corps["data"] as Map<String, Any?>
        assertEquals(listOf("151"), clesDe(data["dps"]))
        assertEquals(plage(2, "00:15", "06:00"), valeur151(f))
        assertEquals(1, f.fermetures.get())
    }

    @Test fun programmerLeCorpsEstIdentiqueALOctetAJsonStringify() {
        val f = fauxAvec(dps = dpsBase(plage(0, "03:30", "06:15", 3)))
        prog(f, alle("01:00", fin = "06:15"))
        // Texte exact attendu, tel que JSON.stringify le produit (clés dans l'ordre, sans espace, guillemets échappés).
        val t = maintenantV().toEpochSecond()
        val attendu = "{\"protocol\":5,\"t\":$t,\"data\":{\"dps\":{\"151\":\"{\\\"m\\\":2,\\\"dt\\\":3,\\\"ss\\\":\\\"01:00\\\",\\\"se\\\":\\\"06:15\\\"}\"}}}"
        assertEquals(attendu, JsonStrict.serialiser(f.ecritures[0].corps))
        // Octets exacts du clair envoyé : en-tête « 3.5 » + 12 octets nuls, puis le corps compact.
        assertEquals(hex("3.5".toByteArray() + ByteArray(12) + attendu.toByteArray()), hex(f.clairsEcriture[0]))
    }

    @Test fun programmerPlageInactiveMRepasseA2DtRecopieSsEtSeEcrits() {
        val f = fauxAvec(dps = dpsBase(plage(0, "03:30", "06:15", 3)))
        val r = prog(f, alle("01:00"))
        assertTrue(r.ok)
        assertEquals(plage(2, "01:00", "06:00", 3), valeur151(f)) // la fin du câble (06:15) est remplacée par la fin demandée
    }

    @Test fun lAncienneFinRepousseeNeResteJamaisLeLendemain() {
        val f = fauxAvec(dps = dpsBase(plage(2, "03:30", "07:30"))) // fin repoussée par un démarrage tardif la veille
        val r = prog(f, alle("03:30"))
        assertEquals(Resultat(true, debut = "03:30", fin = "06:00", plageActive = true), r)
        assertEquals(plage(2, "03:30", "06:00"), valeur151(f))
    }

    @Test fun finDemandeeEcriteEtRelue() {
        val f = fauxAvec()
        val r = prog(f, alle("22:00", fin = "03:30", dureeMin = 330), instant("2026-11-16T20:00:00Z")) // 21:00 à Paris : avant le début
        assertEquals(Resultat(true, debut = "22:00", fin = "03:30", plageActive = true), r)
        assertEquals(plage(2, "22:00", "03:30"), valeur151(f))
    }

    @Test fun programmerDejaRegleRienNEstEnvoye() {
        val f = fauxAvec()
        val r = prog(f, alle("03:30"))
        assertEquals(Resultat(true, debut = "03:30", fin = "06:00", plageActive = true), r)
        assertTrue(f.ecritures.isEmpty())
    }

    @Test fun programmerTrameCoupeeEtReponsesGroupees() {
        for ((d, g) in listOf(true to false, false to true, true to true)) {
            val f = fauxAvec(decouper = d, grouper = g)
            val r = prog(f, alle("00:15"))
            assertTrue("decouper=$d grouper=$g : $r", r.ok)
            assertEquals(1, f.ecritures.size)
        }
    }

    @Test fun programmerSansAccuseLaRelectureDecide() {
        assertTrue(prog(fauxAvec(sansAccuse = true), alle("00:15")).ok)
    }

    @Test fun demarrageTardifHiver() {
        val f = fauxAvec() // plage 03:30-06:00 ; 03:10 UTC = 04:10 à Paris en hiver ; début demandé 03:30 : passé
        val r = prog(f, alle("03:30", dureeMin = 120), instant("2026-11-17T03:10:00Z"))
        // début = 04:20 ; fin = min(04:20 + 2 h, départ 07:30) = 06:20
        assertEquals(Resultat(true, debut = "04:20", fin = "06:20", plageActive = true, tardif = true), r)
        assertEquals(plage(2, "04:20", "06:20"), valeur151(f))
    }

    @Test fun demarrageTardifEteQuelQueSoitLeFuseauDuSysteme() {
        val f = fauxAvec() // 02:10 UTC = 04:10 à Paris en été (UTC+2)
        val r = prog(f, alle("03:30", dureeMin = 120), instant("2026-07-01T02:10:00Z"))
        assertEquals("04:20", r.debut)
        assertTrue(r.tardif)
        // Même instant exprimé dans un autre fuseau : même résultat.
        val f2 = fauxAvec()
        val tokyo = { ZonedDateTime.parse("2026-07-01T02:10:00Z").withZoneSameInstant(java.time.ZoneId.of("Asia/Tokyo")) }
        val r2 = prog(f2, alle("03:30", dureeMin = 120), tokyo)
        assertEquals("04:20", r2.debut)
        assertEquals("06:20", r2.fin)
    }

    @Test fun demarrageTardifPlageQuiPasseMinuit() {
        val f = fauxAvec(dps = dpsBase(plage(2, "22:00", "06:00")))
        val r = prog(f, alle("23:00"), instant("2026-11-16T22:30:00Z")) // 23:30 à Paris
        assertTrue(r.tardif)
        assertEquals("23:40", r.debut)
        assertEquals("06:40", r.fin) // 23:40 + 7 h
        assertEquals(plage(2, "23:40", "06:40"), valeur151(f))
    }

    @Test fun demarrageTardifFinBorneeParLeDepart() {
        val f = fauxAvec()
        val r = prog(f, alle("23:00"), instant("2026-11-17T04:50:00Z")) // 05:50 à Paris : début 06:00, 7 h plus tard dépasserait 07:30
        assertEquals(Resultat(true, debut = "06:00", fin = "07:30", plageActive = true, tardif = true), r)
        assertEquals(plage(2, "06:00", "07:30"), valeur151(f))
    }

    @Test fun debutDansMoinsDeDixMinutesEstTardif() {
        val f = fauxAvec()
        val r = prog(f, alle("23:00"), instant("2026-11-16T21:51:00Z")) // 22:51 : début dans 9 min
        assertTrue(r.tardif)
        assertEquals("23:01", r.debut)
        val g = fauxAvec()
        val r2 = prog(g, alle("23:00"), instant("2026-11-16T21:50:00Z")) // 22:50 : pile 10 min, normal
        assertFalse(r2.tardif)
        assertEquals("23:00", r2.debut)
    }

    @Test fun tropTardRienNEstEcrit() {
        val f = fauxAvec()
        val r = prog(f, alle("23:00"), instant("2026-11-17T06:20:00Z")) // 07:20 : début 07:30 = départ
        assertEquals(Resultat(false, "trop_tard"), r)
        assertTrue(f.ecritures.isEmpty())
        assertEquals(1, f.fermetures.get())
        assertEquals(dpsBase()["151"], f.dps["151"])
    }

    @Test fun demandeAvecFinApresLeDepartRienNEstOuvert() {
        val f = fauxAvec()
        assertEquals(Resultat(false, "requete_invalide"), prog(f, alle("23:00", fin = "08:00")))
        assertEquals(Resultat(false, "requete_invalide"), prog(f, alle("23:00", dureeMin = 0)))
        assertEquals(Resultat(false, "requete_invalide"), prog(f, alle("23:00", dureeMin = 901)))
        assertEquals(0, f.ouvertures.get())
    }

    @Test fun heureNonAtteintePasDeDemarrageTardif() {
        val f = fauxAvec()
        val r = prog(f, alle("03:30"), instant("2026-11-17T02:00:00Z")) // 03:00 à Paris : 30 min avant le début
        assertFalse(r.tardif)
        assertEquals("03:30", r.debut)
    }

    @Test fun plageCourteRemetLaFinDemandeeApresUneFinRepoussee() {
        val f = fauxAvec(dps = dpsBase(plage(2, "03:30", "07:30"))) // fin repoussée par un démarrage tardif la veille
        val r = prog(f, Action.Desactiver("06:00"))
        assertEquals(Resultat(true, debut = "05:59", fin = "06:00", plageActive = true, courte = true), r)
        assertEquals(plage(2, "05:59", "06:00"), valeur151(f))
    }

    @Test fun plageCourteFinInvalideRienNEstOuvert() {
        for (h in listOf("24:00", "6:00", "", "06:00 ")) {
            val f = fauxAvec()
            assertEquals(h, Resultat(false, "requete_invalide"), prog(f, Action.Desactiver(h)))
            assertEquals(0, f.ouvertures.get())
        }
    }

    @Test fun plageCourteDebutEgalFinMoinsUneMinute() {
        val f = fauxAvec()
        val r = prog(f, Action.Desactiver("06:00"))
        assertEquals(Resultat(true, debut = "05:59", fin = "06:00", plageActive = true, courte = true), r)
        assertEquals(plage(2, "05:59", "06:00"), valeur151(f))
    }

    @Test fun plageCourteFinAMinuit() {
        val f = fauxAvec(dps = dpsBase(plage(2, "03:30", "00:00")))
        val r = prog(f, Action.Desactiver("00:00"))
        assertEquals("23:59", r.debut)
        assertTrue(r.courte)
    }

    @Test fun plageCourtePlageInactiveMRepasseA2() {
        val f = fauxAvec(dps = dpsBase(plage(0, "03:30", "06:00")))
        assertEquals(true, prog(f, Action.Desactiver("06:00")).plageActive)
    }

    // --- Rien n'est écrit quand la valeur du câble est inattendue ---

    @Test fun valeurInattendueRienNEstEcrit() {
        val mauvaises = linkedMapOf(
            "clé manquante" to "{\"m\":2,\"ss\":\"03:30\",\"se\":\"06:00\"}",
            "clé en plus" to "{\"m\":2,\"dt\":0,\"ss\":\"03:30\",\"se\":\"06:00\",\"x\":1}",
            "ordre des clés" to "{\"dt\":0,\"m\":2,\"ss\":\"03:30\",\"se\":\"06:00\"}",
            "heure invalide" to plage(2, "25:00", "06:00"),
            "heure sans zéro" to plage(2, "3:30", "06:00"),
            "fin invalide" to plage(2, "03:30", "06:60"),
            "mode inconnu" to plage(1, "03:30", "06:00"),
            "mode booléen" to "{\"m\":true,\"dt\":0,\"ss\":\"03:30\",\"se\":\"06:00\"}",
            "dt non entier" to "{\"m\":2,\"dt\":\"0\",\"ss\":\"03:30\",\"se\":\"06:00\"}",
            "tableau" to "[2,0,\"03:30\",\"06:00\"]",
            "nul" to "null",
            "texte" to "pas du json",
            "vide" to "",
            "espaces" to "{\"m\": 2, \"dt\": 0, \"ss\": \"03:30\", \"se\": \"06:00\"}",
            "saut de ligne final" to plage(2, "03:30", "06:00") + "\n",
        )
        for ((nom, valeur) in mauvaises) {
            val f = fauxAvec(dps = dpsBase(valeur))
            assertEquals(nom, Resultat(false, "format"), prog(f, alle("00:15")))
            assertTrue(nom, f.ecritures.isEmpty())
            assertEquals(nom, 1, f.fermetures.get())
        }
    }

    @Test fun dp151AbsentOuNonTexte() {
        for (v in listOf<Any?>(null, 5L, mapOf("m" to 2L))) {
            val dps = LinkedHashMap(dpsBase())
            if (v == null) dps.remove("151") else dps["151"] = v
            val f = fauxAvec(dps = dps)
            assertEquals(Resultat(false, "format"), prog(f, alle("00:15")))
            assertTrue(f.ecritures.isEmpty())
        }
    }

    // --- Vérification après écriture ---

    @Test fun ecritureSansEffetRelectureDifferente() {
        val f = fauxAvec(ignorerEcriture = true)
        assertEquals(Resultat(false, "relecture_differente", ecrit = true), prog(f, alle("00:15")))
        assertEquals(1, f.ecritures.size)
        assertEquals(1, f.fermetures.get())
    }

    @Test fun leCableAppliqueUneAutreValeur() {
        val f = fauxAvec(transformerEcriture = { plage(2, "00:20", "06:00") })
        assertEquals(Resultat(false, "relecture_differente", ecrit = true), prog(f, alle("00:15")))
    }

    @Test fun unAutrePointDeReglageChange() {
        val f = fauxAvec(effetsEcriture = mapOf("150" to 6L))
        assertEquals(Resultat(false, "relecture_differente", ecrit = true), prog(f, alle("00:15")))
    }

    @Test fun unPointApparait() {
        val f = fauxAvec(effetsEcriture = mapOf("999" to true))
        assertEquals(Resultat(false, "relecture_differente", ecrit = true), prog(f, alle("00:15")))
    }

    @Test fun pointsVolatilsIgnores() {
        val f = fauxAvec(effetsEcriture = mapOf("101" to 300L, "102" to "{\"p\":33}", "105" to "x", "109" to "WORKING"))
        assertTrue(prog(f, alle("00:15")).ok)
    }

    @Test fun relectureMuetteApresLEcritureDelai() {
        val f = fauxAvec()
        var muets = 0
        val transport = object : Transport by f {
            override fun recevoir(delaiMs: Int): ByteArray {
                if (f.commandes.count { it == 0x10L } >= 2) {
                    muets++
                    throw TransportException("delai")
                }
                return f.recevoir(delaiMs)
            }
        }
        val r = prog(transport, alle("00:15"))
        assertEquals(Resultat(false, "delai", ecrit = true), r)
        assertTrue(muets >= 1)
    }

    // --- Demandes invalides ---

    @Test fun demandesInvalidesRienNEstOuvert() {
        for (h in listOf("24:00", "7:30", "07:30\n", " 07:30", "07:60", "", "0730", "07:3", "07:30:00", "٠٧:٣٠", "07:30 ")) {
            val f = fauxAvec()
            assertEquals("«$h»", Resultat(false, "requete_invalide"), prog(f, alle(h)))
            assertEquals(0, f.ouvertures.get())
        }
    }

    @Test fun uneDemandeInvalideNeSeFaitPasPasserPourUneCleFausse() {
        // Même ordre que le JS : la demande est validée avant la clé.
        val f = fauxAvec()
        assertEquals(Resultat(false, "requete_invalide"), prog(f, alle("24:00"), config = cfg(cleLocale = ByteArray(3))))
    }

    // --- Garde-fou : seul le dp 151, et seuls m, ss et se ---

    @Test fun quelleQueSoitLaPlageLueChaqueEcritureNeChangeQueMSsEtSe() {
        val plages = listOf(
            plage(2, "03:30", "06:00"), plage(0, "03:30", "06:00", 5), plage(2, "22:00", "06:00", 1), plage(0, "00:00", "23:59", 9),
            plage(2, "05:59", "06:00"), plage(0, "12:00", "00:00"),
        )
        val actions = listOf(alle("00:15"), alle("23:59"), alle("04:00"), Action.Desactiver("06:00"))
        val instants = listOf("2026-11-16T22:30:00Z", "2026-11-17T03:10:00Z", "2026-07-01T10:00:00Z")
        val heure = Regex("([01][0-9]|2[0-3]):[0-5][0-9]")
        var ecritures = 0
        for (p in plages) for (a in actions) for (i in instants) {
            val f = fauxAvec(dps = dpsBase(p))
            prog(f, a, instant(i))
            val avant = Plage.lirePlage(p)!!
            for (rang in f.ecritures.indices) {
                ecritures++
                @Suppress("UNCHECKED_CAST")
                val dps = (f.ecritures[rang].corps["data"] as Map<String, Any?>)["dps"]
                assertEquals(listOf("151"), clesDe(dps))
                val v = JsonStrict.objet(JsonStrict.parser(valeur151(f, rang)))!!
                assertEquals(listOf("m", "dt", "ss", "se"), v.keys.toList())
                assertEquals(2L, v["m"])
                assertEquals(avant.dt.toLong(), v["dt"])
                if (a is Action.Desactiver) assertEquals(a.fin, v["se"]) // la fin demandée est écrite
                assertTrue(heure.matches(v["se"] as String))
                assertTrue(heure.matches(v["ss"] as String))
            }
            assertTrue(f.ecritures.size <= 1)
            assertTrue(f.commandes.all { it == 0x10L || it == 0x0dL }) // aucune autre commande
        }
        assertTrue("écritures vérifiées : $ecritures", ecritures > 20)
    }

    // --- La clé n'apparaît nulle part ---

    @Test fun laCleNApparaitNullePart() {
        val sortieOut = ByteArrayOutputStream()
        val sortieErr = ByteArrayOutputStream()
        val ancienOut = System.out
        val ancienErr = System.err
        val resultats = ArrayList<Resultat>()
        val config = cfg()
        try {
            System.setOut(PrintStream(sortieOut, true, "UTF-8"))
            System.setErr(PrintStream(sortieErr, true, "UTF-8"))
            resultats.add(lire(fauxAvec(cleCable = "AUTRE-CLE-FAUSSE")))
            resultats.add(prog(fauxAvec(ignorerEcriture = true), alle("00:15")))
            resultats.add(prog(fauxAvec(dps = dpsBase("pas du json")), alle("00:15")))
            resultats.add(lire(fauxAvec(), cfg(cleLocale = "courte".toByteArray())))
            val piege = RuntimeException("échec avec la clé $cleTexte")
            val piegeur = object : Transport {
                override fun ouvrir(ip: String, port: Int, delaiMs: Int) {}
                override fun envoyer(octets: ByteArray) { throw piege }
                override fun recevoir(delaiMs: Int): ByteArray { throw piege }
                override fun fermer() { throw piege }
            }
            resultats.add(lire(piegeur))
            val piegeurOuvrir = object : Transport {
                override fun ouvrir(ip: String, port: Int, delaiMs: Int) { throw piege }
                override fun envoyer(octets: ByteArray) { throw piege }
                override fun recevoir(delaiMs: Int): ByteArray { throw piege }
                override fun fermer() { throw piege }
            }
            resultats.add(prog(piegeurOuvrir, Action.Desactiver("06:00")))
        } finally {
            System.setOut(ancienOut)
            System.setErr(ancienErr)
        }
        val tout = resultats.joinToString("\n") { it.toString() } + config.toString() + sortieOut.toString("UTF-8") + sortieErr.toString("UTF-8")
        assertFalse(tout.contains(cleTexte))
        assertFalse(tout.contains(hex(cle)))
        assertFalse(tout.contains(Base64.getEncoder().encodeToString(cle)))
        assertEquals("", sortieOut.toString("UTF-8") + sortieErr.toString("UTF-8")) // rien n'est journalisé
        // Un échec ne porte ni plage ni drapeau de succès ; « ecrit » seulement si l'écriture est partie.
        for (r in resultats) {
            assertFalse(r.ok)
            assertTrue(r.debut == null && r.fin == null && r.plageActive == null && !r.tardif && !r.courte)
            assertTrue(!r.ecrit || r.erreur == "relecture_differente" || r.erreur == "delai")
        }
        assertEquals(
            listOf("cle", "relecture_differente", "format", "cle", "hors_ligne", "hors_ligne"),
            resultats.map { it.erreur },
        )
    }

    @Test fun lesMessagesDExceptionDuModuleNeContiennentQueDesCodes() {
        for (code in listOf("cle", "hors_ligne", "delai", "format", "relecture_differente", "ferme")) {
            assertEquals(code, ErreurCable(code).message)
        }
        assertFalse(ConfigCable("d", cle, "192.0.2.10").toString().contains(cleTexte))
        assertNotNull(ConfigCable("d", cle, "192.0.2.10").deviceId)
    }

    // --- Trames malformées : échec rapide, connexion fermée ---

    private class TransportBrut(private val octets: ByteArray) : Transport {
        @Volatile var ferme = false
        private var servi = false
        override fun ouvrir(ip: String, port: Int, delaiMs: Int) {}
        override fun envoyer(octets: ByteArray) {}
        override fun recevoir(delaiMs: Int): ByteArray {
            if (servi) return ByteArray(0)
            servi = true
            return octets
        }
        override fun fermer() { ferme = true }
    }

    private fun entete(longueur: Long): ByteArray {
        val b = ByteArray(18)
        b[2] = 0x66
        b[3] = 0x99.toByte()
        b[14] = (longueur shr 24).toByte()
        b[15] = (longueur shr 16).toByte()
        b[16] = (longueur shr 8).toByte()
        b[17] = longueur.toByte()
        return b
    }

    @Test fun tramesMalformeesEchecRapideConnexionFermee() {
        val cas = linkedMapOf(
            "longueur énorme" to entete(0xffffffffL),
            "longueur « négative »" to entete(0x80000000L),
            "longueur nulle" to entete(0),
            "longueur 1441" to entete(1441),
            "100 000 octets nuls" to ByteArray(100_000),
            "octets parasites" to ByteArray(2000) { ((it * 37) and 0xff).toByte() },
        )
        for ((nom, octets) in cas) {
            val t = TransportBrut(octets)
            val debut = System.nanoTime()
            val r = lire(t)
            assertFalse(nom, r.ok)
            assertTrue("$nom : ${r.erreur}", r.erreur in listOf("format", "delai", "ferme", "cle", "hors_ligne"))
            assertTrue(nom, (System.nanoTime() - debut) / 1_000_000 < 5_000)
            assertTrue(nom, t.ferme)
        }
    }

    // --- Câble en veille (dp 109 = SLEEP) : la première écriture le réveille et est jetée ---

    private fun dpsVeille(): Map<String, Any?> = LinkedHashMap(dpsBase()).also { it["109"] = "SLEEP" }

    @Test fun veillePremiereEcritureJeteeSecondEnvoiPuisRelueConforme() {
        val f = fauxAvec(dps = dpsVeille(), veille = true)
        val r = prog(f, alle("00:15"))
        assertTrue(r.toString(), r.ok)
        assertEquals("00:15", r.debut)
        assertEquals(2, f.ecritures.size)
        assertEquals(f.ecritures[0].corps["data"], f.ecritures[1].corps["data"]) // même valeur renvoyée
    }

    @Test fun cableEveilleQuiIgnoreLEcritureJamaisDeSecondEnvoi() {
        val f = fauxAvec(ignorerEcriture = true)
        assertEquals(Resultat(false, "relecture_differente", ecrit = true), prog(f, alle("00:15")))
        assertEquals(1, f.ecritures.size)
    }

    @Test fun enVeilleEtQuiIgnoreToujoursDeuxEnvoisAuPlus() {
        val f = fauxAvec(dps = dpsVeille(), veille = true, ignorerEcriture = true)
        assertEquals(Resultat(false, "relecture_differente", ecrit = true), prog(f, alle("00:15")))
        assertEquals(2, f.ecritures.size)
    }

    // --- Connexion coupée APRÈS l'envoi de l'écriture (jumeau de tests/local-ecriture-coupee.test.mjs) ---

    @Test fun connexionCoupeeApresLEcritureIncertainJamaisRienNAEteModifie() {
        for (action in listOf(alle("23:45"), Action.Desactiver("06:00"))) {
            val dps = linkedMapOf<String, Any?>("101" to 202L, "109" to "WAIT", "150" to 16L, "151" to plage(2, "03:30", "06:00"), "152" to 16L)
            val f = fauxAvec(dps = dps)
            val coupe = object : Transport by f {
                override fun recevoir(delaiMs: Int): ByteArray {
                    if (f.ecritures.isNotEmpty()) throw TransportException("ferme") // pont fermé (onStop), plafond de 30 s, câble qui coupe
                    return f.recevoir(delaiMs)
                }
            }
            val r = prog(coupe, action)
            // Précondition : l'écriture a bien été appliquée par le faux câble.
            assertNotEquals("03:30", Plage.lirePlage(f.dps["151"] as String)!!.ss)
            assertEquals(action.toString(), Resultat(false, "delai", ecrit = true), r)
            assertEquals(1, f.fermetures.get())
        }
    }

    // --- Une seule construction de commande d'écriture dans le source ---

    @Test fun uneSeuleConstructionDeCommandeDEcriture() {
        val sources = Aides.sourcesCable()
        assertTrue(sources.size >= 5)
        val client = sources.first { it.name == "ClientCable.kt" }.readText()
        fun compter(motif: String, texte: String) = Regex(motif).findAll(texte).count()
        assertEquals(1, compter("envoyerTrame\\(ctx, Tuya35\\.CMD_ECRITURE", client))
        assertEquals(2, compter("Tuya35\\.CMD_ECRITURE", client)) // envoi et filtre de l'accusé
        // définition, validation avant tout envoi, construction dans l'unique fonction d'envoi (envoyerEcriture)
        assertEquals(3, compter("corpsEcriture\\(", client))
        assertEquals(2, compter("(?<!fun )envoyerEcriture\\(", client)) // premier envoi, second envoi (veille)
        // La commande n'existe nulle part ailleurs : ni son numéro, ni sa constante.
        for (f in sources) {
            val texte = f.readText()
            if (f.name != "Tuya35.kt") assertFalse(f.name, texte.contains("0x0d") || texte.contains("0x0D"))
            if (f.name != "Tuya35.kt" && f.name != "ClientCable.kt") assertFalse(f.name, texte.contains("CMD_ECRITURE"))
        }
        // Seul le dp 151 est écrit : la clé « 151 » n'est écrite que par la fonction de construction.
        assertEquals(1, compter("DP_PLAGE \\+ ", client))
        // Aucune autre commande ne peut être construite : un seul empaquetage hors définition dans tout cable/,
        // et un nombre fixe d'envois de trames dans ClientCable.kt (début et fin de négociation, lecture, écriture).
        assertEquals(1, sources.sumOf { compter("(?<!fun )empaqueter\\(", it.readText()) })
        assertEquals(4, compter("(?<!fun )envoyerTrame\\(", client))
    }

    @Test fun aucuneDependanceAndroidNiJournalDansLeCoeurDuProtocole() {
        for (f in Aides.sourcesCable()) {
            val texte = f.readText()
            assertFalse(f.name, Regex("(?m)^\\s*import\\s+android\\.").containsMatchIn(texte))
            assertFalse(f.name, Regex("(?m)^\\s*import\\s+org\\.json").containsMatchIn(texte))
            assertFalse(f.name, Regex("\\b(Log\\.|println\\(|printStackTrace|System\\.out|System\\.err)").containsMatchIn(texte))
        }
    }
}
