package fr.rechargeds3.coque

import fr.rechargeds3.coque.cable.Action
import fr.rechargeds3.coque.cable.FauxCable
import fr.rechargeds3.coque.cable.OptionsFaux
import fr.rechargeds3.coque.cable.Transport
import fr.rechargeds3.coque.cable.TransportException
import fr.rechargeds3.coque.cable.alle
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.ZonedDateTime
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference

/** Routage des opérations du pont vers le protocole local, contre le faux câble en mémoire (clé et adresses factices). */
class OperationsCableTest {
    private val cle = "CLE-FACTICE-0000"

    private fun plage(m: Int, ss: String, se: String) = "{\"m\":$m,\"dt\":0,\"ss\":\"$ss\",\"se\":\"$se\"}"
    private fun dps(p151: String = plage(2, "03:30", "06:00")): Map<String, Any?> = linkedMapOf(
        "101" to 202L, "102" to "{\"p\":0}", "109" to "WAIT", "150" to 16L, "151" to p151, "152" to 16L,
    )

    private class Env(
        var cleCoffre: Pair<String, String>? = "ID_FACTICE" to "CLE-FACTICE-0000",
        var estConfigure: Boolean = true,
        var adresseRetenue: String? = "192.168.1.48",
        var prefixe: String? = "192.168.1",
        var fabrique: () -> Transport? = { null },
        var cablesOuverts: Set<String> = emptySet(),
        var surSonder: ((String) -> Boolean)? = null,
    ) : EnvironnementCable {
        val retenues = ArrayList<String>()
        var lecturesCoffre = 0
        var surLireCle: () -> Unit = {}
        override fun configure() = estConfigure
        override fun lireCle(): Pair<String, String>? { lecturesCoffre++; surLireCle(); return cleCoffre }
        override fun adresse() = adresseRetenue
        override fun retenirAdresse(ip: String) { retenues.add(ip); adresseRetenue = ip }
        override fun prefixeWifi() = prefixe
        override fun creerTransport(): Transport? = fabrique()
        override fun sonder(ip: String, delaiMs: Int) = surSonder?.invoke(ip) ?: (ip in cablesOuverts)
    }

    private val maintenant = { ZonedDateTime.parse("2026-11-16T22:30:00Z") }
    private fun ops(env: Env, duree: Long = 15 * 60_000L, horloge: () -> Long = { System.currentTimeMillis() }) =
        OperationsCable(env, duree, horloge, maintenant, pause = {})

    private fun faux(cleCable: String = cle, d: Map<String, Any?> = dps(), bloquer: Boolean = false) =
        FauxCable(OptionsFaux(cle = cleCable, dps = d, bloquer = bloquer))

    // --- lire ---

    @Test fun lireRendLaPlageEtRetientLAdresse() {
        val env = Env(fabrique = { faux() })
        val r = ops(env).lire(null, null)
        assertEquals(true, r["ok"]); assertEquals("03:30", r["debut"]); assertEquals("06:00", r["fin"]); assertEquals(true, r["plage_active"])
        assertEquals(listOf("192.168.1.48"), env.retenues)
    }

    @Test fun lireAvecUneAdresseDeLaPageLaFiltreEtLUtilise() {
        val env = Env(fabrique = { faux() })
        val o = ops(env)
        for (ip in listOf("8.8.8.8", "127.0.0.1", "010.0.0.1", "exemple.test", "")) {
            assertEquals(ip, "refuse", o.lire(ip, null)["erreur"])
        }
        assertEquals(true, o.lire("10.0.2.2", null)["ok"])
        assertEquals(listOf("10.0.2.2"), env.retenues)
    }

    @Test fun cleFausseDonneCleEtNeRetientRien() {
        val env = Env(fabrique = { faux(cleCable = "AUTRE-CLE-000000") })
        val r = ops(env).lire(null, null)
        assertEquals(false, r["ok"]); assertEquals("cle", r["erreur"])
        assertTrue(env.retenues.isEmpty())
    }

    @Test fun sansAdresseSansCleSansWifi() {
        assertEquals("sans_adresse", ops(Env(adresseRetenue = null, fabrique = { faux() })).lire(null, null)["erreur"])
        assertEquals("pas_de_cle", ops(Env(cleCoffre = null, fabrique = { faux() })).lire(null, null)["erreur"])
        assertEquals("pas_wifi", ops(Env(fabrique = { null })).lire(null, null)["erreur"])
    }

    @Test fun cableMuetDonneHorsLigne() {
        val env = Env(fabrique = { FauxCable(OptionsFaux(cle = cle, dps = dps(), ouvrirEchoue = true)) })
        assertEquals("hors_ligne", ops(env).lire(null, null)["erreur"])
    }

    @Test fun laCleNApparaitDansAucunResultat() {
        for (env in listOf(Env(fabrique = { faux() }), Env(fabrique = { faux(cleCable = "AUTRE-CLE-000000") }))) {
            val o = ops(env)
            for (r in listOf(o.lire(null, null), o.cable(), o.memoriser(), o.programmer(null, alle("05:00"), null))) {
                assertFalse(r.toString(), r.toString().contains(cle))
                assertFalse(r.keys.any { it.contains("cle") || it.contains("device") })
            }
        }
    }

    // --- programmer ---

    @Test fun programmerAllumageEcritPuisRelit() {
        val f = faux()
        val env = Env(fabrique = { f })
        val r = ops(env).programmer(null, alle("05:00"), null)
        assertEquals(true, r["ok"]); assertEquals("05:00", r["debut"]); assertEquals("06:00", r["fin"]); assertEquals(true, r["plage_active"])
        assertEquals(false, r["tardif"]); assertEquals(false, r["courte"]); assertEquals(false, r.containsKey("immediat"))
        assertEquals(1, f.ecritures.size)
        assertEquals(listOf("192.168.1.48"), env.retenues)
    }

    @Test fun desactiverRendLaPlageCourte() {
        val r = ops(Env(fabrique = { faux() })).programmer(null, Action.Desactiver("06:00"), null)
        assertEquals(true, r["ok"]); assertEquals("05:59", r["debut"]); assertEquals("06:00", r["fin"]); assertEquals(true, r["courte"])
    }

    @Test fun heureInvalideNEnvoieRien() {
        val f = faux()
        val o = ops(Env(fabrique = { f }))
        for (h in listOf("25:00", "5:00", "05:60", "", "05:00 ")) {
            assertEquals(h, "requete_invalide", o.programmer(null, alle(h), null)["erreur"])
        }
        assertEquals(0, f.ouvertures.get())
    }

    @Test fun demandeAvecFinOuDureeInvalideNEnvoieRien() {
        val f = faux()
        val o = ops(Env(fabrique = { f }))
        for (a in listOf(alle("05:00", fin = "08:00"), alle("05:00", dureeMin = 0), alle("05:00", dureeMin = 1440), alle("05:00", depart = "05:00"), alle("05:00", fin = "05:00"))) {
            assertEquals(a.toString(), "requete_invalide", o.programmer(null, a, null)["erreur"])
        }
        assertEquals(0, f.ouvertures.get())
    }

    @Test fun demarrageTardifRepondTardifAvecDebutEtFinEcrits() {
        val f = faux()
        // Maintenant (23:30 à Paris) : le début 23:00 est passé, début = 23:40, fin = min(23:40 + 7 h, départ) = 06:40.
        val r = ops(Env(fabrique = { f })).programmer(null, alle("23:00"), null)
        assertEquals(true, r["ok"]); assertEquals("23:40", r["debut"]); assertEquals("06:40", r["fin"]); assertEquals(true, r["tardif"])
        assertEquals(1, f.ecritures.size)
    }

    @Test fun tropTardRienNEstEcritEtAucuneNouvelleTentative() {
        val f = faux()
        val s = Suite(listOf({ f }), { faux() })
        val horsNuit = OperationsCable(Env(fabrique = s.fabrique), 900_000L, { 0L }, { ZonedDateTime.parse("2026-11-17T06:20:00Z") }, pause = {})
        val r = horsNuit.programmer(null, alle("23:00"), null, reessayer = true) // 07:20, départ 07:30
        assertEquals(false, r["ok"]); assertEquals("trop_tard", r["erreur"]); assertEquals(false, r.containsKey("ecrit"))
        assertEquals(1, s.crees.get()); assertTrue(f.ecritures.isEmpty())
    }

    @Test fun ecritureSansEffetRendEcritEtJamaisUnOk() {
        val f = FauxCable(OptionsFaux(cle = cle, dps = dps(), ignorerEcriture = true))
        val r = ops(Env(fabrique = { f })).programmer(null, alle("05:00"), null)
        assertEquals(false, r["ok"]); assertEquals("relecture_differente", r["erreur"]); assertEquals(true, r["ecrit"])
    }

    // --- une seule opération à la fois ---

    @Test fun secondeOperationRecoitOccupe() {
        val bloque = faux(bloquer = true)
        val o = ops(Env(fabrique = { bloque }))
        val premier = AtomicReference<Map<String, Any?>>()
        val fil = Thread { premier.set(o.lire(null, 5000)) }.apply { isDaemon = true; start() }
        var essais = 0
        while (!o.enCours() && essais++ < 200) Thread.sleep(10)
        assertTrue(o.enCours())
        assertEquals("occupe", o.lire(null, null)["erreur"])
        assertEquals("occupe", o.programmer(null, Action.Desactiver("06:00"), null)["erreur"])
        val enRecherche = o.chercher(null) { }
        assertEquals("occupe", enRecherche["erreur"])
        o.annulerTout() // coupe la connexion : la première opération rend la main
        fil.join(5000)
        assertFalse(fil.isAlive)
        assertEquals(false, premier.get()["ok"])
        assertFalse(o.enCours())
    }

    // --- chercher ---

    @Test fun chercherRetrouveLeCableSurLeReseauDuWifi() {
        val adresses = java.util.Collections.synchronizedList(ArrayList<String>())
        val env = Env(adresseRetenue = "192.168.1.250", prefixe = "192.168.1", cablesOuverts = setOf("192.168.1.48", "192.168.1.60"))
        // Seule 192.168.1.48 est le câble : l'adresse retenue est muette, et 192.168.1.60 ouvre le port mais n'est pas lui.
        env.fabrique = {
            val f = faux()
            object : Transport by f {
                override fun ouvrir(ip: String, port: Int, delaiMs: Int) {
                    adresses.add(ip)
                    if (ip != "192.168.1.48") throw TransportException("hors_ligne")
                    f.ouvrir(ip, port, delaiMs)
                }
            }
        }
        val progres = java.util.Collections.synchronizedList(ArrayList<Progres>())
        val r = ops(env).chercher(null) { progres.add(it) }
        assertEquals(true, r["ok"]); assertEquals("192.168.1.48", r["ip"]); assertEquals(true, r["trouve"]); assertEquals("03:30", r["debut"])
        assertEquals(listOf("192.168.1.48"), env.retenues)
        assertEquals("l'adresse de départ est essayée avant la fouille", "192.168.1.250", adresses.first())
        assertTrue(progres.isNotEmpty() && progres.all { it.echeanceMs > 0 })
    }

    @Test fun chercherSansWifiOuSansCleOuAdresseRefusee() {
        val sansWifi = ops(Env(prefixe = null)).chercher(null) { }
        assertEquals("pas_wifi", sansWifi["erreur"])
        val sansCle = ops(Env(cleCoffre = null)).chercher(null) { }
        assertEquals("pas_de_cle", sansCle["erreur"])
        val refusee = ops(Env()).chercher("8.8.8.8") { }
        assertEquals("refuse", refusee["erreur"])
    }

    @Test fun chercherSansCableDonneIntrouvable() {
        val r = ops(Env(cablesOuverts = emptySet(), adresseRetenue = null, fabrique = { faux() })).chercher(null) { }
        assertEquals("introuvable", r["erreur"])
    }

    // --- cable et mémoire de configuration ---

    @Test fun cableDitSeulementSiUneConfigurationExisteSansLaDechiffrer() {
        val env = Env()
        assertEquals(mapOf("ok" to true, "configure" to true, "adresse" to "192.168.1.48"), ops(env).cable())
        assertEquals(mapOf("ok" to true, "configure" to false, "adresse" to "192.168.1.48"), ops(Env(estConfigure = false)).cable())
        assertEquals("cable() ne déchiffre jamais la clé (contrôle toutes les 5 s)", 0, env.lecturesCoffre)
    }

    @Test fun cleIllisibleRemonteALaLectureEnPasDeCle() {
        val env = Env(cleCoffre = null, fabrique = { faux() }) // configuré mais illisible (téléphone verrouillé)
        val o = ops(env)
        assertEquals(true, o.cable()["configure"])
        assertEquals("pas_de_cle", o.lire(null, null)["erreur"])
    }

    @Test fun memoireGardeLaCleQuandLeCoffreDevientIllisible() {
        val env = Env(fabrique = { faux() })
        val o = ops(env)
        assertEquals(true, o.memoriser()["ok"])
        env.cleCoffre = null // téléphone verrouillé
        val avant = env.lecturesCoffre
        assertEquals(true, o.lire(null, null)["ok"])
        assertEquals(true, o.cable()["configure"])
        assertEquals("le coffre n'est pas relu tant que la mémoire est valable", avant, env.lecturesCoffre)
    }

    @Test fun memoireEffaceeApresOublierOuApresLaDuree() {
        val env = Env(fabrique = { faux() })
        var t = 1_000L
        val o = ops(env, duree = 15 * 60_000L, horloge = { t })
        o.memoriser(); env.cleCoffre = null
        assertEquals(true, o.lire(null, null)["ok"])
        o.oublierMemoire()
        assertEquals("pas_de_cle", o.lire(null, null)["erreur"])
        env.cleCoffre = "ID_FACTICE" to cle
        o.memoriser(); env.cleCoffre = null
        t += 15 * 60_000L + 1
        assertEquals("pas_de_cle", o.lire(null, null)["erreur"])
        o.oublierMemoire()
    }

    @Test fun memoriserSansCleLisibleEchoue() {
        assertEquals("pas_de_cle", ops(Env(cleCoffre = null)).memoriser()["erreur"])
    }

    // --- annulation et changement de clé ---

    @Test fun annulationPendantLeDechiffrementNOuvreRienEtNEcritRien() {
        for (ecriture in listOf(false, true)) {
            val f = faux()
            val env = Env(fabrique = { f })
            val entre = CountDownLatch(1)
            val libere = CountDownLatch(1)
            env.surLireCle = { entre.countDown(); libere.await(5, TimeUnit.SECONDS) }
            val o = ops(env)
            val res = AtomicReference<Map<String, Any?>>()
            val fil = Thread { res.set(if (ecriture) o.programmer(null, alle("05:00"), null) else o.lire(null, null)) }
                .apply { isDaemon = true; start() }
            assertTrue(entre.await(5, TimeUnit.SECONDS))
            o.annulerTout() // appli cachée pendant le déchiffrement de la clé
            libere.countDown()
            fil.join(5000)
            assertFalse(fil.isAlive)
            assertEquals(false, res.get()["ok"])
            assertEquals("hors_ligne", res.get()["erreur"])
            assertEquals("aucune connexion ouverte", 0, f.ouvertures.get())
            assertEquals("aucune écriture", 0, f.ecritures.size)
            assertFalse(o.enCours())
        }
    }

    @Test fun nouvelleCleNEstPasMasqueeParLAncienneMemoire() {
        val env = Env(fabrique = { faux(cleCable = "NOUVELLE-CLE-000") })
        val o = ops(env)
        o.memoriser() // ancienne clé gardée (« CLE-FACTICE-0000 »)
        env.cleCoffre = "ID_FACTICE" to "NOUVELLE-CLE-000"
        assertEquals("tant que la mémoire n'est pas effacée, l'ancienne clé est utilisée", "cle", o.lire(null, null)["erreur"])
        o.oublierMemoire() // ce que font l'enregistrement d'une clé, « Oublier le câble » et saisirCle
        assertEquals(true, o.lire(null, null)["ok"])
    }

    // --- nouvelles tentatives (déplacées de site/local.js) ---

    private fun muet() = FauxCable(OptionsFaux(cle = cle, dps = dps(), ouvrirEchoue = true))

    /** Fabrique qui rend d'abord les câbles de [premiers], puis [suite] ; compte les transports créés. */
    private class Suite(val premiers: List<() -> Transport>, val suite: () -> Transport) {
        val crees = AtomicInteger()
        val fabrique: () -> Transport? = { val n = crees.getAndIncrement(); if (n < premiers.size) premiers[n]() else suite() }
    }

    @Test fun lireNeReessaiePasSansLaDemande() {
        val s = Suite(listOf({ muet() }), { faux() })
        val r = ops(Env(fabrique = s.fabrique)).lire(null, null)
        assertEquals("hors_ligne", r["erreur"]); assertEquals(1, s.crees.get())
    }

    @Test fun lireReessaieApresUnEchecDeContact() {
        for (echec in listOf<() -> Transport>({ muet() }, { faux(cleCable = "AUTRE-CLE-000000") })) { // hors_ligne, puis « cle »
            val s = Suite(listOf(echec), { faux() })
            val r = ops(Env(fabrique = s.fabrique)).lire(null, null, reessayer = true)
            assertEquals(true, r["ok"]); assertEquals(2, s.crees.get())
        }
    }

    @Test fun lireReessaieAuPlusUneFoisEtRendLEchecDeLaSeconde() {
        val s = Suite(listOf({ muet() }, { muet() }), { faux() })
        val r = ops(Env(fabrique = s.fabrique)).lire(null, null, reessayer = true)
        assertEquals("hors_ligne", r["erreur"]); assertEquals(2, s.crees.get())
    }

    @Test fun programmerReessaieSeulementSansEcriture() {
        // Échec de contact avant toute écriture : seconde tentative, une seule écriture au total.
        val f = faux()
        val s = Suite(listOf({ muet() }), { f })
        val r = ops(Env(fabrique = s.fabrique)).programmer(null, alle("05:00"), null, reessayer = true)
        assertEquals(true, r["ok"]); assertEquals(2, s.crees.get()); assertEquals(1, f.ecritures.size)
        // Sans la demande : une seule tentative.
        val s2 = Suite(listOf({ muet() }), { faux() })
        assertEquals("hors_ligne", ops(Env(fabrique = s2.fabrique)).programmer(null, alle("05:00"), null)["erreur"])
        assertEquals(1, s2.crees.get())
    }

    @Test fun programmerJamaisDeNouvelEnvoiApresUneEcriture() {
        // Écriture partie puis relecture muette : delai + ecrit, jamais relancée.
        val f = faux()
        val coupe = object : Transport by f {
            override fun recevoir(delaiMs: Int): ByteArray {
                if (f.commandes.count { it == 0x10L } >= 2) throw TransportException("delai")
                return f.recevoir(delaiMs)
            }
        }
        val s = Suite(listOf({ coupe }), { faux() })
        val r = ops(Env(fabrique = s.fabrique)).programmer(null, alle("00:15"), null, reessayer = true)
        assertEquals(false, r["ok"]); assertEquals("delai", r["erreur"]); assertEquals(true, r["ecrit"])
        assertEquals(1, s.crees.get()); assertEquals(1, f.ecritures.size)
        // Relecture différente : jamais relancée non plus.
        val g = FauxCable(OptionsFaux(cle = cle, dps = dps(), ignorerEcriture = true))
        val s2 = Suite(listOf({ g }), { faux() })
        val r2 = ops(Env(fabrique = s2.fabrique)).programmer(null, alle("05:00"), null, reessayer = true)
        assertEquals("relecture_differente", r2["erreur"]); assertEquals(1, s2.crees.get()); assertEquals(1, g.ecritures.size)
    }

    @Test fun programmerSecondeTentativeSeulementSiLeBudgetLePermet() {
        for ((consomme, attendu) in listOf(10_000L to 2, 23_000L to 1)) { // reste 17 s, puis 4 s (< 5 s)
            var t = 0L
            val lent = muet()
            val premier = object : Transport by lent {
                override fun ouvrir(ip: String, port: Int, delaiMs: Int) { t += consomme; throw TransportException("delai") }
            }
            val s = Suite(listOf({ premier }), { faux() })
            val r = ops(Env(fabrique = s.fabrique), horloge = { t }).programmer(null, alle("05:00"), null, reessayer = true)
            assertEquals("consommé $consomme ms", attendu, s.crees.get())
            assertEquals(attendu == 2, r["ok"])
        }
    }

    @Test fun chercherSecondBalayageSeulementSiDemande() {
        for ((reessayer, trouve) in listOf(false to false, true to true)) {
            val sondes = AtomicInteger()
            val env = Env(adresseRetenue = null, fabrique = { faux() })
            env.surSonder = { ip -> ip == "192.168.1.48" && sondes.incrementAndGet() >= 2 } // muette au premier balayage
            val r = ops(env).chercher(null, reessayer) { }
            assertEquals("reessayer=$reessayer", trouve, r["ok"])
            if (!trouve) assertEquals("introuvable", r["erreur"])
        }
    }

    @Test fun chercherAnnonceUneEcheanceQuiCouvreLesDeuxBalayages() {
        for (reessayer in listOf(false, true)) {
            val progres = java.util.Collections.synchronizedList(ArrayList<Progres>())
            val debut = System.currentTimeMillis()
            ops(Env(adresseRetenue = null, fabrique = { faux() })).chercher(null, reessayer) { progres.add(it) }
            val premiere = progres.first().echeanceMs - debut
            if (reessayer) assertTrue("échéance du premier balayage : $premiere ms", premiere > 45_000L)
            else assertTrue("un seul balayage : $premiere ms", premiere <= 31_000L)
        }
    }

    // --- origines : annuler la page ne touche pas ce que le service a lancé ---

    private fun lancerBloquee(o: OperationsCable, origine: Origine): Thread {
        // 30 s : seule une annulation peut terminer l'opération dans les 2 s laissées par les tests.
        val fil = Thread { o.lire(null, 30_000, origine = origine) }.apply { isDaemon = true; start() }
        var essais = 0
        while (!o.enCours() && essais++ < 200) Thread.sleep(10)
        assertTrue(o.enCours())
        return fil
    }

    @Test fun annulerLaPageNeCoupePasUneOperationDuService() {
        val bloque = faux(bloquer = true)
        val o = ops(Env(fabrique = { bloque }))
        val fil = lancerBloquee(o, Origine.SERVICE)
        o.annulerPage()
        fil.join(300)
        assertTrue("l'opération du service continue", fil.isAlive)
        assertEquals(0, bloque.fermetures.get())
        o.annuler(Origine.SERVICE)
        fil.join(2000) // bien avant l'échéance de 30 s : c'est l'annulation qui coupe
        assertFalse("annuler(SERVICE) coupe l'opération du service", fil.isAlive); assertTrue(bloque.fermetures.get() >= 1)
    }

    @Test fun annulerLeServiceNeCoupePasUneOperationDeLaPage() {
        val bloque = faux(bloquer = true)
        val o = ops(Env(fabrique = { bloque }))
        val fil = lancerBloquee(o, Origine.PAGE)
        o.annuler(Origine.SERVICE)
        fil.join(300)
        assertTrue(fil.isAlive)
        o.annulerPage()
        fil.join(2000)
        assertFalse("annulerPage() coupe l'opération de la page", fil.isAlive); assertTrue(bloque.fermetures.get() >= 1)
    }

    @Test fun uneOperationDuServiceEtUneDeLaPageRestentExclusives() {
        val bloque = faux(bloquer = true)
        val o = ops(Env(fabrique = { bloque }))
        val fil = lancerBloquee(o, Origine.SERVICE)
        assertEquals("occupe", o.lire(null, null)["erreur"])
        o.annuler(Origine.SERVICE)
        fil.join(5000)
        assertFalse(o.enCours())
    }
}
