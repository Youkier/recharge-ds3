package fr.rechargeds3.coque

import fr.rechargeds3.coque.Attente.Issue
import fr.rechargeds3.coque.cable.Action
import fr.rechargeds3.coque.cable.FauxCable
import fr.rechargeds3.coque.cable.OptionsFaux
import fr.rechargeds3.coque.cable.Transport
import fr.rechargeds3.coque.cable.TransportException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.ZonedDateTime

/**
 * Le pilote de l'attente (lot E3) contre le faux câble en mémoire, en TEMPS VIRTUEL : la pause fait avancer l'horloge, rien ne dort.
 * Clé, identifiant et adresses factices. Contrat : phases, 10 min au plus, lecture toutes les 5 s, une recherche après 60 s,
 * « jamais de faux OK », « Annuler » seulement avant l'envoi, clé effacée à la fin dans tous les cas, état persisté sans secret.
 */
class PiloteAttenteTest {
    private val cle = "CLE-FACTICE-0000"
    private val identifiant = "ID_FACTICE"

    private fun plage(m: Int, ss: String, se: String) = "{\"m\":$m,\"dt\":0,\"ss\":\"$ss\",\"se\":\"$se\"}"
    private fun dps(): Map<String, Any?> = linkedMapOf(
        "101" to 202L, "102" to "{\"p\":0}", "109" to "WAIT", "150" to 16L, "151" to plage(2, "03:30", "06:00"), "152" to 16L,
    )

    private class Env : EnvironnementCable {
        var cleCoffre: Pair<String, String>? = "ID_FACTICE" to "CLE-FACTICE-0000"
        var estConfigure = true
        var adresseRetenue: String? = "192.168.1.48"
        var prefixe: String? = "192.168.1"
        var fabrique: () -> Transport? = { null }
        var surSonder: (String) -> Boolean = { false }
        override fun configure() = estConfigure
        override fun lireCle(): Pair<String, String>? = cleCoffre
        override fun adresse() = adresseRetenue
        override fun retenirAdresse(ip: String) { adresseRetenue = ip }
        override fun prefixeWifi() = prefixe
        override fun creerTransport(): Transport? = fabrique()
        override fun sonder(ip: String, delaiMs: Int) = surSonder(ip)
    }

    private class Stock : StockageAttente {
        var contenu: String? = null
        override fun lire() = contenu
        override fun ecrire(contenu: String?) { this.contenu = contenu }
    }

    private class Ecoute : EcouteurAttente {
        var envois = 0
        val fins = java.util.Collections.synchronizedList(ArrayList<Triple<Issue, String?, String?>>())
        override fun envoiCommence() { envois++ }
        override fun termine(issue: Issue, debut: String?, fin: String?) { fins.add(Triple(issue, debut, fin)) }
    }

    /** Pilote + opérations + horloge virtuelle. [parisUtc] : l'instant (UTC) ; en novembre, Paris = UTC + 1. */
    private class Banc(val env: Env, parisUtc: String = "2026-11-16T22:30:00Z", val stock: Stock = Stock()) {
        var t = 0L
        var surPause: (Long) -> Unit = {}
        val ecoute = Ecoute()
        var instant: ZonedDateTime = ZonedDateTime.parse(parisUtc) // l'heure de Paris peut avancer pendant l'attente
        private val maintenant = { instant }
        val ops = OperationsCable(env, 15 * 60_000L, { t }, maintenant, pause = {})
        val pilote = PiloteAttente(ops, env, stock, { t }, maintenant, pause = { ms -> t += ms; surPause(ms) }).also { it.ecouteur = ecoute }
    }

    private val demande = Action.Allumage("00:35", "06:00", 300, "07:30")
    private val manuelle = HeuresManuelles("00:35", "06:00")
    private val creesFaux = java.util.Collections.synchronizedList(ArrayList<FauxCable>())

    private fun faux(cleCable: String = cle): FauxCable =
        FauxCable(OptionsFaux(cle = cleCable, dps = dps())).also { creesFaux.add(it) }
    private fun muet(): FauxCable = FauxCable(OptionsFaux(cle = cle, dps = dps(), ouvrirEchoue = true))
    private fun ecritures() = synchronized(creesFaux) { creesFaux.sumOf { it.ecritures.size } }

    private fun banc(fabrique: () -> Transport?, parisUtc: String = "2026-11-16T22:30:00Z", reglage: (Env) -> Unit = {}): Banc {
        val env = Env()
        env.fabrique = fabrique
        reglage(env)
        return Banc(env, parisUtc)
    }

    private fun Banc.demarrerEtLancer(a: Action = demande, h: HeuresManuelles = manuelle): Map<String, Any?> {
        assertEquals(true, pilote.demarrer(a, h)["ok"])
        pilote.lancer()
        return pilote.etat()
    }

    @Suppress("UNCHECKED_CAST")
    private fun resultat(etat: Map<String, Any?>): Map<String, Any?> = etat["resultat"] as Map<String, Any?>

    /** La configuration gardée (clé comprise) a été mise à zéro : le coffre est illisible, donc rien ne peut plus lire le câble. */
    private fun memoireEffacee(b: Banc) {
        b.env.cleCoffre = null
        assertEquals("pas_de_cle", b.ops.lire(null, null)["erreur"])
    }

    // --- Nominal ---

    @Test fun nominalCableDejaPretEnvoiEtResultatBrut() {
        val b = banc({ faux() })
        val e = b.demarrerEtLancer()
        assertEquals("terminee", e["phase"])
        val r = resultat(e)
        assertEquals(true, r["ok"]); assertEquals("00:35", r["debut"]); assertEquals("06:00", r["fin"]); assertEquals(true, r["plage_active"])
        assertEquals(listOf(Triple(Issue.PROGRAMMEE, "00:35", "06:00")), b.ecoute.fins)
        assertEquals(1, b.ecoute.envois)
        assertEquals(1, ecritures())
        memoireEffacee(b)
    }

    @Test fun leTelephoneArriveSurLeWifiPuisLeCableRepond() {
        val b = banc({ faux() }) { it.prefixe = null }
        b.surPause = { if (b.t >= 30_000) b.env.prefixe = "192.168.1" }
        val e = b.demarrerEtLancer()
        assertTrue(b.t >= 30_000)
        assertEquals(Issue.PROGRAMMEE, b.ecoute.fins.single().first)
        assertEquals(true, resultat(e)["ok"]); assertEquals(1, ecritures())
    }

    @Test fun leReseauDuWifiDoitEtreCeluiDeLAdresseRetenue() {
        val b = banc({ faux() }) { it.prefixe = "10.0.0" } // autre réseau : jamais d'envoi
        val e = b.demarrerEtLancer()
        assertEquals("attente_expiree", resultat(e)["erreur"]); assertEquals(Issue.NON_FAITE, b.ecoute.fins.single().first)
        assertTrue(b.t >= 600_000); assertEquals(0, ecritures()); assertEquals(0, b.ecoute.envois)
        memoireEffacee(b)
    }

    // --- Durées ---

    @Test fun lectureToutesLes5SecondesEtUneSeuleRechercheApres60Secondes() {
        val lectures = java.util.Collections.synchronizedList(ArrayList<Long>())
        val sondes = java.util.Collections.synchronizedList(ArrayList<Long>())
        lateinit var b: Banc
        b = banc({ lectures.add(b.t); if (b.t < 70_000) muet() else faux() }) { env -> env.surSonder = { sondes.add(b.t); false } }
        val e = b.demarrerEtLancer()
        assertEquals(true, resultat(e)["ok"]); assertEquals(Issue.PROGRAMMEE, b.ecoute.fins.single().first)
        assertTrue("aucune recherche avant 60 s : $sondes", sondes.isNotEmpty() && sondes.all { it in 60_000L..61_000L })
        assertEquals("une seule recherche (deux balayages au plus dans le même instant)", 1, sondes.toSet().size)
        // Lectures espacées d'au moins 5 s (les transports de la seconde tentative d'une même lecture sont au même instant).
        val instants = lectures.distinct().filter { it < 60_000 }
        assertTrue(instants.zipWithNext().all { (a, c) -> c - a >= 5_000 })
    }

    @Test fun apres10MinutesSansCableAucunEnvoiEtLaCleEstEffacee() {
        val b = banc({ muet() })
        val e = b.demarrerEtLancer()
        assertEquals("attente_cable", resultat(e)["erreur"]); assertEquals(false, resultat(e)["ok"])
        assertTrue(b.t >= 600_000 && b.t < 610_000)
        assertEquals(listOf(Triple(Issue.NON_FAITE, "00:35", "06:00")), b.ecoute.fins)
        assertEquals(0, ecritures()); assertEquals(0, b.ecoute.envois)
        memoireEffacee(b)
    }

    @Test fun lEcheanceEstRevereifieeJusteAvantLEnvoi() {
        // Le câble ne répond qu'à 9 min 55 s, et sa lecture dure jusqu'à 10 min (le temps saute) : elle réussit, mais l'attente a
        // expiré : rien n'est envoyé.
        lateinit var b: Banc
        b = banc({ if (b.t >= 595_000) { b.t = 600_000; faux() } else muet() })
        val e = b.demarrerEtLancer()
        assertEquals("attente_cable", resultat(e)["erreur"]); assertEquals(0, ecritures()); assertEquals(0, b.ecoute.envois)
        assertEquals(Issue.NON_FAITE, b.ecoute.fins.single().first)
    }

    // --- Annulation ---

    @Test fun annulerAvantLEnvoiNeRienEnvoyer() {
        val b = banc({ muet() })
        val retours = ArrayList<Boolean>()
        b.surPause = { if (b.t >= 10_000 && retours.isEmpty()) retours.add(b.pilote.annuler()) }
        val e = b.demarrerEtLancer()
        assertEquals(listOf(true), retours)
        assertEquals("attente_annulee", resultat(e)["erreur"])
        assertEquals(listOf(Triple(Issue.ANNULEE, "00:35", "06:00")), b.ecoute.fins)
        assertEquals(0, ecritures()); assertFalse(b.pilote.annuler())
        memoireEffacee(b)
    }

    @Test fun annulerPendantLEnvoiEstRefuseEtLEnvoiAboutit() {
        val refus = ArrayList<Boolean>()
        lateinit var b: Banc
        b = banc({ if (b.pilote.etat()["phase"] == "envoi") refus.add(b.pilote.annuler()); faux() })
        val e = b.demarrerEtLancer()
        assertEquals(listOf(false), refus)
        assertEquals(true, resultat(e)["ok"]); assertEquals(Issue.PROGRAMMEE, b.ecoute.fins.single().first); assertEquals(1, ecritures())
    }

    @Test fun nouvelleCleOuOublierArreteLAttenteEtEffaceLaMemoire() {
        val b = banc({ muet() })
        assertEquals(true, b.pilote.demarrer(demande, manuelle)["ok"])
        b.pilote.arreterPourCle()
        val e = b.pilote.etat()
        assertEquals("terminee", e["phase"]); assertEquals("attente_annulee", resultat(e)["erreur"])
        memoireEffacee(b)
        b.pilote.lancer() // une boucle tardive ne fait plus rien
        assertEquals(1, b.ecoute.fins.size)
    }

    @Test fun nouvelleCleCoupeAussiUnEnvoiEnCours() {
        val n = java.util.concurrent.atomic.AtomicInteger()
        val b = banc({ if (n.getAndIncrement() == 0) faux() else FauxCable(OptionsFaux(cle = cle, dps = dps(), bloquer = true)) })
        assertEquals(true, b.pilote.demarrer(demande, manuelle)["ok"])
        val fil = Thread { b.pilote.lancer() }.apply { isDaemon = true; start() }
        var essais = 0
        while (b.pilote.etat()["phase"] != "envoi" && essais++ < 300) Thread.sleep(10)
        assertEquals("envoi", b.pilote.etat()["phase"])
        Thread.sleep(100)
        b.pilote.arreterPourCle()
        fil.join(5000)
        assertFalse("l'envoi bloqué est coupé", fil.isAlive)
        assertEquals("terminee", b.pilote.etat()["phase"])
        assertEquals(false, resultat(b.pilote.etat())["ok"])
        assertEquals(1, b.ecoute.fins.size)
    }

    // --- Résultats : jamais de faux OK, heure tardive, trop tard ---

    @Test fun demarrageTardifEstDecideAuMomentDeLEnvoi() {
        val b = banc({ faux() })
        // 23:30 à Paris : le début 23:00 est passé, début = 23:40, fin = min(23:40 + 7 h, 07:30) = 06:40.
        val e = b.demarrerEtLancer(Action.Allumage("23:00", "06:00", 420, "07:30"), HeuresManuelles("23:00", "06:00"))
        assertEquals(true, resultat(e)["tardif"]); assertEquals("23:40", resultat(e)["debut"]); assertEquals("06:40", resultat(e)["fin"])
        assertEquals(listOf(Triple(Issue.TARDIVE, "23:40", "06:40")), b.ecoute.fins)
    }

    @Test fun demarrageTardifSeDecideALEnvoiPasAuToucher() {
        // Au toucher (23:30), le début 23:45 est dans le futur ; l'envoi a lieu à 23:50 : début = 00:00, fin = min(00:00 + 7 h, 07:30) = 07:00.
        val b = banc({ faux() }) { it.prefixe = null }
        b.surPause = { if (b.t >= 30_000L) { b.instant = ZonedDateTime.parse("2026-11-16T22:50:00Z"); b.env.prefixe = "192.168.1" } }
        val e = b.demarrerEtLancer(Action.Allumage("23:45", "06:00", 420, "07:30"), HeuresManuelles("23:45", "06:00"))
        assertEquals(true, resultat(e)["tardif"]); assertEquals("00:00", resultat(e)["debut"]); assertEquals("07:00", resultat(e)["fin"])
        assertEquals(listOf(Triple(Issue.TARDIVE, "00:00", "07:00")), b.ecoute.fins)
    }

    @Test fun unResultatDePlusDe12HEstOublieEtLeNotifierAussi() {
        val b = banc({ faux() })
        b.demarrerEtLancer()
        assertTrue(b.pilote.resultatANotifier() != null)
        b.t += 11 * 3600_000L
        assertEquals("terminee", b.pilote.etat()["phase"])
        b.t += 2 * 3600_000L // 13 h
        assertEquals("inactive", b.pilote.etat()["phase"]); assertNull(b.stock.contenu); assertNull(b.pilote.resultatANotifier())
        // Une attente perdue datée de son début est oubliée de la même façon (horloge d'un nouveau processus : bien plus tard).
        val c = banc({ muet() })
        c.pilote.demarrer(demande, manuelle)
        val c2 = Banc(Env(), stock = c.stock).also { it.t = 13 * 3600_000L }
        assertEquals("inactive", c2.pilote.etat()["phase"])
    }

    @Test fun tropTardRienNEstEcritEtLaNotificationLeDit() {
        val b = banc({ faux() }, parisUtc = "2026-11-17T06:20:00Z") // 07:20, départ 07:30
        val e = b.demarrerEtLancer(Action.Allumage("23:00", "06:00", 420, "07:30"), HeuresManuelles("23:00", "06:00"))
        assertEquals("trop_tard", resultat(e)["erreur"])
        assertEquals(listOf(Triple(Issue.TROP_TARD, null, null)), b.ecoute.fins)
        assertEquals(0, ecritures())
    }

    @Test fun pasDeChargeDonneAucune() {
        val b = banc({ faux() })
        val e = b.demarrerEtLancer(Action.Desactiver("06:00"), HeuresManuelles("05:59", "06:00"))
        assertEquals(true, resultat(e)["courte"]); assertEquals(listOf(Issue.AUCUNE), b.ecoute.fins.map { it.first })
    }

    @Test fun ecriturePartieSansRelectureEstIncertaineEtJamaisRelancee() {
        val f = faux()
        val coupe = object : Transport by f {
            override fun recevoir(delaiMs: Int): ByteArray {
                if (f.commandes.count { it == 0x10L } >= 2) throw TransportException("delai")
                return f.recevoir(delaiMs)
            }
        }
        val n = java.util.concurrent.atomic.AtomicInteger()
        val b = banc({ if (n.getAndIncrement() == 0) faux() else coupe })
        val e = b.demarrerEtLancer()
        val r = resultat(e)
        assertEquals(false, r["ok"]); assertEquals("delai", r["erreur"]); assertEquals(true, r["ecrit"])
        assertEquals(listOf(Triple(Issue.INCERTAINE, "00:35", "06:00")), b.ecoute.fins)
        assertEquals("lecture + une seule écriture, jamais de second envoi", 2, n.get())
        assertEquals(1, f.ecritures.size)
    }

    @Test fun ecritureSansEffetNEstJamaisUnOk() {
        val n = java.util.concurrent.atomic.AtomicInteger()
        val b = banc({ if (n.getAndIncrement() == 0) faux() else FauxCable(OptionsFaux(cle = cle, dps = dps(), ignorerEcriture = true)) })
        val e = b.demarrerEtLancer()
        assertEquals("relecture_differente", resultat(e)["erreur"]); assertEquals(Issue.INCERTAINE, b.ecoute.fins.single().first)
    }

    // --- Clé ---

    @Test fun cleRefuseeDeuxFoisDAfilee() {
        val b = banc({ faux(cleCable = "AUTRE-CLE-000000") })
        val e = b.demarrerEtLancer()
        assertEquals("attente_cle", resultat(e)["erreur"]); assertEquals(Issue.NON_FAITE, b.ecoute.fins.single().first)
        assertEquals(0, b.ecoute.envois); memoireEffacee(b)
    }

    @Test fun unRefusIsoleDeLaCleNArretePasLAttenteCableQuiRedemarre() {
        val n = java.util.concurrent.atomic.AtomicInteger()
        val b = banc({ if (n.getAndIncrement() < 2) faux(cleCable = "AUTRE-CLE-000000") else faux() }) // 1re lecture : 2 essais refusés
        val e = b.demarrerEtLancer()
        assertEquals(true, resultat(e)["ok"]); assertEquals(Issue.PROGRAMMEE, b.ecoute.fins.single().first)
    }

    @Test fun cleIllisibleOuSansAdresse() {
        val sansAdresse = banc({ faux() }) { it.adresseRetenue = null }
        assertEquals("sans_adresse", resultat(sansAdresse.demarrerEtLancer())["erreur"])
        val b = banc({ faux() }) { it.cleCoffre = null }
        assertEquals("pas_de_cle", b.pilote.demarrer(demande, manuelle)["erreur"])
        assertEquals("inactive", b.pilote.etat()["phase"]); assertNull(b.stock.contenu)
    }

    // --- Démarrage ---

    @Test fun demarrerRefuseUneDemandeInvalideUneSecondeAttenteOuUnCableNonRelie() {
        val b = banc({ muet() })
        for ((a, h) in listOf(
            Action.Allumage("00:35", "06:00", 0, "07:30") to manuelle, Action.Allumage("00:35", "08:00", 300, "07:30") to manuelle,
            Action.Desactiver("6:00") to manuelle, demande to HeuresManuelles("5:00", "06:00"), demande to HeuresManuelles("05:00", ""),
        )) assertEquals("$a $h", "requete_invalide", b.pilote.demarrer(a, h)["erreur"])
        assertEquals("inactive", b.pilote.etat()["phase"])
        assertEquals(true, b.pilote.demarrer(demande, manuelle)["ok"])
        assertEquals("occupe", b.pilote.demarrer(demande, manuelle)["erreur"])
        val sansCle = banc({ muet() }) { it.estConfigure = false }
        assertEquals("pas_de_cle", sansCle.pilote.demarrer(demande, manuelle)["erreur"])
    }

    @Test fun lEtatRenduALaPageEtSonContrat() {
        val b = banc({ muet() })
        assertEquals(mapOf("ok" to true, "phase" to "inactive"), b.pilote.etat())
        b.pilote.demarrer(demande, manuelle)
        b.t += 90_000
        val e = b.pilote.etat()
        assertEquals("attente", e["phase"]); assertEquals("wifi", e["etape"]); assertEquals(510_000L, e["restant_ms"])
        assertEquals(mapOf("allumage" to "00:35", "fin" to "06:00", "duree_min" to 300L, "depart" to "07:30"), e["demande"])
        assertEquals(mapOf("debut" to "00:35", "fin" to "06:00"), e["heureManuelle"])
        assertFalse(e.containsKey("resultat"))
        assertEquals(mapOf("desactiver" to true, "fin" to "06:00"), banc({ muet() }).also { it.pilote.demarrer(Action.Desactiver("06:00"), manuelle) }.pilote.etat()["demande"])
        for (x in listOf(e.toString(), b.stock.contenu!!)) assertFalse(x, x.contains(cle) || x.contains(identifiant) || x.contains("192.168"))
    }

    // --- Persistance : processus tué, résultat à rendre ---

    @Test fun uneAttenteTrouveeEnCoursAuLancementDuProcessusEstNonSuivie() {
        val b = banc({ muet() })
        b.pilote.demarrer(demande, manuelle)
        // Nouveau processus : même fichier, nouvelle instance.
        val b2 = Banc(Env(), stock = b.stock)
        val e = b2.pilote.etat()
        assertEquals("terminee", e["phase"]); assertEquals("non_suivie", resultat(e)["erreur"]); assertEquals(false, resultat(e)["ok"])
        assertEquals(mapOf("debut" to "00:35", "fin" to "06:00"), e["heureManuelle"]); assertTrue(e.containsKey("demande"))
        assertFalse(b2.pilote.enCours())
        b2.pilote.acquitter()
        assertEquals("inactive", b2.pilote.etat()["phase"]); assertNull(b.stock.contenu)
        assertEquals("inactive", Banc(Env(), stock = b.stock).pilote.etat()["phase"])
    }

    @Test fun uneAttenteTueeRecemmentEstNonSuivieAvecUneHorlogeRealiste() {
        // Horloge d'un vrai téléphone (millisecondes depuis 1970) : l'attente perdue n'est pas prise pour un vieux résultat (bug de la CI du 22/11).
        val t0 = 1_795_000_000_000L
        val b = banc({ muet() })
        b.t = t0
        b.pilote.demarrer(demande, manuelle)
        val b2 = Banc(Env(), stock = b.stock).also { it.t = t0 + 5_000 }
        val e = b2.pilote.etat()
        assertEquals("terminee", e["phase"]); assertEquals("non_suivie", resultat(e)["erreur"])
        // Un résultat terminé garde sa vraie date de fin.
        val c = banc({ faux() })
        c.t = t0
        c.demarrerEtLancer()
        val c2 = Banc(Env(), stock = c.stock).also { it.t = t0 + 3_600_000 }
        assertEquals("terminee", c2.pilote.etat()["phase"])
        c2.t = t0 + 13 * 3_600_000L
        assertEquals("inactive", c2.pilote.etat()["phase"])
    }

    @Test fun unResultatNonVuSurvitAuRedemarrageJusquAuAcquittement() {
        val b = banc({ faux() })
        b.demarrerEtLancer()
        val b2 = Banc(Env(), stock = b.stock)
        val e = b2.pilote.etat()
        assertEquals("terminee", e["phase"]); assertEquals(true, resultat(e)["ok"]); assertEquals("00:35", resultat(e)["debut"])
        assertEquals("terminee", Banc(Env(), stock = b.stock).pilote.etat()["phase"])
        b2.pilote.acquitter(); b2.pilote.acquitter() // sans effet la seconde fois
        assertEquals("inactive", b2.pilote.etat()["phase"])
    }

    @Test fun unFichierIllisibleOuInventeEstOublie() {
        for (contenu in listOf(
            "pas du json", "[]", "{}", "{\"phase\":\"attente\"}",
            "{\"v\":1,\"phase\":\"attente\",\"debut\":1,\"demande\":{\"allumage\":\"25:00\",\"fin\":\"06:00\",\"duree_min\":300,\"depart\":\"07:30\"},\"manuelle\":{\"debut\":\"00:35\",\"fin\":\"06:00\"}}",
            "{\"v\":1,\"phase\":\"inactive\",\"debut\":1,\"demande\":{\"desactiver\":true,\"fin\":\"06:00\"},\"manuelle\":{\"debut\":\"05:59\",\"fin\":\"06:00\"}}",
        )) {
            val s = Stock().also { it.contenu = contenu }
            val b = Banc(Env(), stock = s)
            assertEquals(contenu, "inactive", b.pilote.etat()["phase"]); assertNull(contenu, s.contenu)
        }
    }

    // --- Filet de 15 min ---

    @Test fun leFiletClotEnInconnuUneAttenteSansResultatEtLaBoucleTardiveNeFaitRien() {
        val b = banc({ muet() })
        b.pilote.demarrer(demande, manuelle)
        b.pilote.finaliserInconnu()
        val e = b.pilote.etat()
        assertEquals("terminee", e["phase"]); assertEquals("non_suivie", resultat(e)["erreur"])
        assertEquals(listOf(Triple(Issue.INCONNUE, "00:35", "06:00")), b.ecoute.fins)
        b.pilote.finaliserInconnu(); b.pilote.lancer()
        assertEquals(1, b.ecoute.fins.size)
        memoireEffacee(b)
    }

    @Test fun uneExceptionDansLaBoucleNEstJamaisSilencieuse() {
        val b = banc({ throw IllegalStateException("panne") })
        val e = b.demarrerEtLancer()
        assertEquals("non_suivie", resultat(e)["erreur"]); assertEquals(Issue.INCONNUE, b.ecoute.fins.single().first)
        memoireEffacee(b)
    }

    @Test fun unServiceQuiNeDemarrePasRetireLAttenteSansRien() {
        val b = banc({ muet() })
        assertEquals(true, b.pilote.demarrer(demande, manuelle)["ok"])
        b.pilote.abandonnerDemarrage()
        assertEquals("inactive", b.pilote.etat()["phase"]); assertNull(b.stock.contenu); assertTrue(b.ecoute.fins.isEmpty())
        memoireEffacee(b)
        b.pilote.abandonnerDemarrage() // sans effet
    }

    // --- Une nouvelle attente remplace un résultat non vu ---

    @Test fun uneNouvelleAttenteRemplaceUnResultatNonVu() {
        val b = banc({ faux() })
        b.demarrerEtLancer()
        assertEquals("terminee", b.pilote.etat()["phase"])
        b.env.cleCoffre = identifiant to cle // la mémoire a été effacée à la fin : le coffre la relit
        assertEquals(true, b.pilote.demarrer(demande, manuelle)["ok"])
        assertEquals("attente", b.pilote.etat()["phase"]); assertFalse(b.pilote.etat().containsKey("resultat"))
        assertTrue(b.pilote.enCours())
    }
}
