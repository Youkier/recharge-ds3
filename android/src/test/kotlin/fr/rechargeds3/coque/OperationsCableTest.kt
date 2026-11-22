package fr.rechargeds3.coque

import fr.rechargeds3.coque.cable.Action
import fr.rechargeds3.coque.cable.FauxCable
import fr.rechargeds3.coque.cable.OptionsFaux
import fr.rechargeds3.coque.cable.Transport
import fr.rechargeds3.coque.cable.TransportException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.ZonedDateTime
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
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
        override fun sonder(ip: String, delaiMs: Int) = ip in cablesOuverts
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
            for (r in listOf(o.lire(null, null), o.cable(), o.memoriser(), o.programmer(null, Action.Allumage("05:00"), null))) {
                assertFalse(r.toString(), r.toString().contains(cle))
                assertFalse(r.keys.any { it.contains("cle") || it.contains("device") })
            }
        }
    }

    // --- programmer ---

    @Test fun programmerAllumageEcritPuisRelit() {
        val f = faux()
        val env = Env(fabrique = { f })
        val r = ops(env).programmer(null, Action.Allumage("05:00"), null)
        assertEquals(true, r["ok"]); assertEquals("05:00", r["debut"]); assertEquals("06:00", r["fin"]); assertEquals(true, r["plage_active"])
        assertEquals(false, r["immediat"]); assertEquals(false, r["courte"])
        assertEquals(1, f.ecritures.size)
        assertEquals(listOf("192.168.1.48"), env.retenues)
    }

    @Test fun desactiverRendLaPlageCourte() {
        val r = ops(Env(fabrique = { faux() })).programmer(null, Action.Desactiver, null)
        assertEquals(true, r["ok"]); assertEquals("05:59", r["debut"]); assertEquals("06:00", r["fin"]); assertEquals(true, r["courte"])
    }

    @Test fun heureInvalideNEnvoieRien() {
        val f = faux()
        val o = ops(Env(fabrique = { f }))
        for (h in listOf("25:00", "5:00", "05:60", "", "05:00 ")) {
            assertEquals(h, "requete_invalide", o.programmer(null, Action.Allumage(h), null)["erreur"])
        }
        assertEquals(0, f.ouvertures.get())
    }

    @Test fun ecritureSansEffetRendEcritEtJamaisUnOk() {
        val f = FauxCable(OptionsFaux(cle = cle, dps = dps(), ignorerEcriture = true))
        val r = ops(Env(fabrique = { f })).programmer(null, Action.Allumage("05:00"), null)
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
        assertEquals("occupe", o.programmer(null, Action.Desactiver, null)["erreur"])
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

    @Test fun cableDitSeulementSiUneConfigurationExisteEtSiElleEstLisible() {
        assertEquals(mapOf("ok" to true, "configure" to true, "adresse" to "192.168.1.48"), ops(Env()).cable())
        assertEquals(mapOf("ok" to true, "configure" to false, "adresse" to "192.168.1.48"), ops(Env(estConfigure = false)).cable())
        val illisible = ops(Env(cleCoffre = null)).cable()
        assertEquals(false, illisible["configure"]); assertEquals(true, illisible["illisible"])
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
            val fil = Thread { res.set(if (ecriture) o.programmer(null, Action.Allumage("05:00"), null) else o.lire(null, null)) }
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
}
