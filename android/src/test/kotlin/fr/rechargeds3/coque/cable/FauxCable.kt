package fr.rechargeds3.coque.cable

import java.io.File
import java.nio.ByteBuffer
import java.util.concurrent.CountDownLatch
import java.util.concurrent.atomic.AtomicInteger
import javax.crypto.Cipher
import javax.crypto.Mac
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/** Petits outils des tests du protocole local (aucune donnée réelle : clé, identifiant et adresse factices). */
object Aides {
    private const val CHIFFRES = "0123456789abcdef"

    fun hex(b: ByteArray): String {
        val sb = StringBuilder()
        for (x in b) {
            val v = x.toInt() and 0xff
            sb.append(CHIFFRES[v shr 4]).append(CHIFFRES[v and 15])
        }
        return sb.toString()
    }

    fun deHex(s: String): ByteArray = ByteArray(s.length / 2) { s.substring(2 * it, 2 * it + 2).toInt(16).toByte() }

    /** Fichier du dépôt : « ../tests/x » depuis android/ (répertoire de travail de Gradle), sinon depuis la racine. */
    fun fichier(cheminDepuisRacine: String, cheminDepuisAndroid: String): File {
        val a = File("../$cheminDepuisRacine")
        if (a.exists()) return a
        val b = File(cheminDepuisRacine)
        if (b.exists()) return b
        val c = File(cheminDepuisAndroid)
        if (c.exists()) return c
        throw AssertionError("fichier introuvable : $cheminDepuisRacine (répertoire de travail : ${File(".").absolutePath})")
    }

    fun json(nom: String): Map<String, Any?> {
        val f = fichier("tests/$nom", "tests/$nom")
        return JsonStrict.objet(JsonStrict.parserOctets(f.readBytes())) ?: throw AssertionError("objet JSON attendu : $nom")
    }

    fun sourcesCable(): List<File> {
        val dossier = fichier("android/src/main/kotlin/fr/rechargeds3/coque/cable", "src/main/kotlin/fr/rechargeds3/coque/cable")
        return (dossier.listFiles() ?: emptyArray()).filter { it.name.endsWith(".kt") }.sortedBy { it.name }
    }

    /** Aléas imposés : rend les octets de la liste, dans l'ordre, et refuse une taille inattendue. */
    class AleasFixes(liste: List<String>) {
        private val octets = liste.map { deHex(it) }
        var utilises = 0
            private set
        val fn: (Int) -> ByteArray = { n ->
            val v = octets.getOrNull(utilises) ?: throw AssertionError("aléa inattendu (rang $utilises)")
            if (v.size != n) throw AssertionError("aléa inattendu ($n octets demandés, rang $utilises)")
            utilises++
            v
        }
    }
}

class OptionsFaux(
    val cle: String = "CLE-FACTICE-0000",
    val dps: Map<String, Any?> = emptyMap(),
    val nonceCable: ByteArray? = null,
    val iv: ((Int) -> ByteArray)? = null,
    val cleFausse: String = "repondre", // "repondre", "fermer" ou "silence"
    val silenceLecture: Boolean = false,
    val ignorerEcriture: Boolean = false,
    val veille: Boolean = false,
    val transformerEcriture: ((String) -> String)? = null,
    val effetsEcriture: Map<String, Any?> = emptyMap(),
    val formatLecture: String = "dps", // "dps", "data" ou "entete"
    val decouper: Boolean = false,
    val grouper: Boolean = false,
    val tAnnonce: Long = 1,
    val sansAccuse: Boolean = false,
    val bloquer: Boolean = false,
    val ouvrirEchoue: Boolean = false,
)

class Ecriture(val entete: String, val corps: Map<String, Any?>)

/**
 * Faux câble Tuya 3.5 en mémoire, jumeau de tests/tuya-local-faux-cable.mjs : un transport qui joue le rôle du câble.
 * Écrit indépendamment du module (javax.crypto et ByteBuffer directement, sans passer par Tuya35) ; son exactitude est
 * vérifiée contre les trames de tinytuya (tests/tuya-local-vecteurs.json).
 */
class FauxCable(private val opts: OptionsFaux = OptionsFaux()) : Transport {
    private val cleCable = opts.cle.toByteArray(Charsets.ISO_8859_1)
    val dps = LinkedHashMap<String, Any?>(opts.dps)
    private val nonceCable: ByteArray = opts.nonceCable ?: ByteArray(16).also { java.security.SecureRandom().nextBytes(it) }
    private val ivDe: (Int) -> ByteArray = opts.iv ?: { n: Int -> ByteArray(n).also { java.security.SecureRandom().nextBytes(it) } }

    private var cleSession: ByteArray? = null
    private var nonceLocal: ByteArray? = null
    @Volatile private var ouvert = false
    @Volatile private var ferme = false
    private var seq = 100L
    private var phase = 3 // 3 : attend la trame 3, 5 : attend la trame 5, 0 : session
    private val file = java.util.concurrent.LinkedBlockingDeque<ByteArray>()
    private var tampon = ByteArray(0)
    private val verrou = CountDownLatch(1)

    val ouvertures = AtomicInteger()
    val fermetures = AtomicInteger()
    val commandes = java.util.Collections.synchronizedList(ArrayList<Long>())
    val ecritures = java.util.Collections.synchronizedList(ArrayList<Ecriture>())
    val envoyes = java.util.Collections.synchronizedList(ArrayList<ByteArray>())
    val clairsEcriture = java.util.Collections.synchronizedList(ArrayList<ByteArray>()) // clair exact de chaque commande 0x0d
    @Volatile var port = 0
    @Volatile var ip = ""

    // --- Crypto du câble (réimplémentée ici, volontairement) ---
    private fun gcm(mode: Int, cle: ByteArray, iv: ByteArray, aad: ByteArray?, donnees: ByteArray): ByteArray {
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(mode, SecretKeySpec(cle, "AES"), GCMParameterSpec(128, iv))
        if (aad != null) c.updateAAD(aad)
        return c.doFinal(donnees)
    }

    private fun hmac(cle: ByteArray, d: ByteArray): ByteArray {
        val m = Mac.getInstance("HmacSHA256")
        m.init(SecretKeySpec(cle, "HmacSHA256"))
        return m.doFinal(d)
    }

    private fun concat(vararg t: ByteArray): ByteArray = Tuya35.concat(*t)

    private fun empaqueterCable(cle: ByteArray, s: Long, cmd: Long, clairSansRetcode: ByteArray, iv: ByteArray): ByteArray {
        val clair = concat(ByteBuffer.allocate(4).putInt(0).array(), clairSansRetcode) // code de retour 0
        val entete = ByteBuffer.allocate(18)
            .put(byteArrayOf(0, 0, 0x66, 0x99.toByte())).putShort(0)
            .putInt(s.toInt()).putInt(cmd.toInt()).putInt(clair.size + 28).array()
        val chiffre = gcm(Cipher.ENCRYPT_MODE, cle, iv, entete.copyOfRange(4, 18), clair)
        return concat(entete, iv, chiffre, byteArrayOf(0, 0, 0x99.toByte(), 0x66))
    }

    /** Déchiffre une trame du client ; lève une exception si l'étiquette est refusée. Rend (commande, clair). */
    private fun lireTrameClient(cle: ByteArray, trame: ByteArray): Pair<Long, ByteArray> {
        val lg = ByteBuffer.wrap(trame).getInt(14)
        val clair = gcm(Cipher.DECRYPT_MODE, cle, trame.copyOfRange(18, 30), trame.copyOfRange(4, 18), trame.copyOfRange(30, 18 + lg))
        return Pair(ByteBuffer.wrap(trame).getInt(10).toLong(), clair)
    }

    private fun envoyerCable(cle: ByteArray, cmd: Long, clair: ByteArray): ByteArray = empaqueterCable(cle, ++seq, cmd, clair, ivDe(12))

    private fun emettre(trames: List<ByteArray>) {
        if (opts.grouper) {
            file.add(concat(*trames.toTypedArray()))
        } else {
            for (t in trames) {
                if (opts.decouper) {
                    file.add(t.copyOfRange(0, 20))
                    file.add(t.copyOfRange(20, t.size))
                } else {
                    file.add(t)
                }
            }
        }
    }

    private fun corpsLecture(): ByteArray {
        val json = JsonStrict.serialiser(if (opts.formatLecture == "data") mapOf("data" to mapOf("dps" to dps)) else mapOf("dps" to dps))
            .toByteArray(Charsets.UTF_8)
        return if (opts.formatLecture == "entete") concat("3.5".toByteArray(), ByteArray(12), json) else json
    }

    private fun traiter(trame: ByteArray) {
        envoyes.add(trame)
        if (phase == 3) {
            val m = try {
                lireTrameClient(cleCable, trame)
            } catch (e: Exception) {
                when (opts.cleFausse) {
                    "fermer" -> ferme = true
                    "repondre" -> emettre(listOf(envoyerCable(cleCable, 4, concat(nonceCable, hmac(cleCable, ByteArray(16))))))
                }
                return
            }
            nonceLocal = m.second
            emettre(listOf(envoyerCable(cleCable, 4, concat(nonceCable, hmac(cleCable, m.second)))))
            phase = 5
            return
        }
        if (phase == 5) {
            val m = lireTrameClient(cleCable, trame)
            if (m.first != 5L) throw IllegalStateException("trame 5 attendue")
            if (Aides.hex(m.second) != Aides.hex(hmac(cleCable, nonceCable))) throw IllegalStateException("HMAC de fin de négociation faux")
            val local = nonceLocal!!
            val xor = ByteArray(16) { (local[it].toInt() xor nonceCable[it].toInt()).toByte() }
            cleSession = gcm(Cipher.ENCRYPT_MODE, cleCable, local.copyOfRange(0, 12), null, xor).copyOfRange(0, 16)
            phase = 0
            return
        }
        val m = lireTrameClient(cleSession!!, trame)
        commandes.add(m.first)
        if (m.first == 0x10L) {
            if (opts.silenceLecture) return
            emettre(listOf(envoyerCable(cleSession!!, 0x10, corpsLecture())))
        } else if (m.first == 0x0dL) {
            val clair = m.second
            clairsEcriture.add(clair)
            val corps = JsonStrict.objet(JsonStrict.parserOctets(clair.copyOfRange(15, clair.size)))!!
            ecritures.add(Ecriture(String(clair.copyOfRange(0, 3), Charsets.UTF_8), corps))
            val jetee = opts.veille && dps["109"] == "SLEEP"
            if (jetee) dps["109"] = "IDLE"
            if (!opts.ignorerEcriture && !jetee) {
                val recus = JsonStrict.objet(JsonStrict.objet(corps["data"])!!["dps"])!!
                for ((k, v) in recus) {
                    val tr = opts.transformerEcriture
                    dps[k] = if (k == "151" && tr != null) tr(v as String) else v
                }
                dps.putAll(opts.effetsEcriture)
            }
            if (!opts.sansAccuse) {
                val annonce = JsonStrict.serialiser(
                    mapOf("protocol" to 4L, "t" to opts.tAnnonce, "data" to mapOf("dps" to mapOf("151" to dps["151"]))),
                ).toByteArray(Charsets.UTF_8)
                emettre(listOf(
                    envoyerCable(cleSession!!, 0x0d, ByteArray(0)),
                    envoyerCable(cleSession!!, 8, annonce),
                ))
            }
        } else {
            throw IllegalStateException("commande inattendue du client : ${m.first}")
        }
    }

    // --- Transport ---
    override fun ouvrir(ip: String, port: Int, delaiMs: Int) {
        if (opts.ouvrirEchoue) throw TransportException("hors_ligne")
        ouvertures.incrementAndGet()
        this.port = port
        this.ip = ip
        ouvert = true
    }

    override fun envoyer(octets: ByteArray) {
        if (!ouvert || ferme) throw TransportException("ferme")
        tampon = concat(tampon, octets)
        while (true) { // une trame par appel normalement ; on gère aussi plusieurs trames d'un coup
            if (tampon.size < 18) return
            val total = 18 + ByteBuffer.wrap(tampon).getInt(14) + 4
            if (tampon.size < total) return
            val trame = tampon.copyOfRange(0, total)
            tampon = tampon.copyOfRange(total, tampon.size)
            traiter(trame)
        }
    }

    override fun recevoir(delaiMs: Int): ByteArray {
        if (opts.bloquer) {
            verrou.await() // ne rend jamais la main, sauf si fermer() est appelé (échéance globale)
            throw TransportException("ferme")
        }
        return file.pollFirst() ?: throw TransportException(if (ferme) "ferme" else "delai")
    }

    override fun fermer() {
        fermetures.incrementAndGet()
        ouvert = false
        verrou.countDown()
    }
}
