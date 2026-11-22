package fr.rechargeds3.coque

import fr.rechargeds3.coque.cable.Resultat
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference

/** Avancement de la recherche (jamais d'adresse) ; [echeanceMs] : instant de fin, en millisecondes d'horloge murale. */
data class Progres(val etape: String, val appareils: Int, val lectures: Int, val echeanceMs: Long)

/** [trouve] : vrai si le câble a été découvert par la fouille, faux s'il a répondu à l'une des adresses de départ. */
class ResultatRecherche(val ok: Boolean, val ip: String? = null, val trouve: Boolean = false, val etat: Resultat? = null)

/**
 * Recherche du câble sur le /24 du Wi-Fi (reprise de local/recherche.js). Kotlin pur : la sonde de port et la lecture sont
 * fournies par l'appelant. Principe inchangé : une adresse n'est « le câble » que si une LECTURE y réussit avec la bonne
 * clé (la négociation échoue avec toute autre clé) ; la recherche ne fait que lire. Exactement un câble, sinon échec.
 *
 * Les lectures se font une par une (une seule connexion au câble ou à un autre appareil à la fois) ; les sondes de port
 * sont parallèles. Le délai de lecture donné à [lire] est borné par le temps restant : la recherche ne dépasse pas
 * [delaiTotalMs] de plus que le dernier échange en cours.
 */
object RechercheCable {
    const val PARALLELISME = 32
    const val DELAI_SONDE_MS = 400
    const val DELAI_TOTAL_MS = 30_000L
    const val DELAI_LECTURE_MS = 8_000L

    /** Les 254 adresses d'hôte du /24 « a.b.c » ; liste vide si ce n'est pas un réseau privé. */
    fun candidats(prefixe: String): List<String> {
        if (FiltreReseau.adressePrivee("$prefixe.1") == null) return emptyList()
        return (1..254).map { "$prefixe.$it" }
    }

    /**
     * [departs] : adresses essayées d'abord, dans l'ordre (sans doublon ni adresse non privée) ; [prefixe] : /24 fouillé
     * ensuite (celui du Wi-Fi). [annule] : arrêt demandé de l'extérieur (sortie de l'appli).
     */
    fun chercher(
        departs: List<String>,
        prefixe: String,
        sonder: (String, Int) -> Boolean,
        lire: (String, Long) -> Resultat,
        progres: (Progres) -> Unit = {},
        annule: () -> Boolean = { false },
        parallelisme: Int = PARALLELISME,
        delaiTotalMs: Long = DELAI_TOTAL_MS,
        delaiLectureMs: Long = DELAI_LECTURE_MS,
        maintenant: () -> Long = { System.currentTimeMillis() },
    ): ResultatRecherche {
        val echeance = maintenant() + delaiTotalMs
        val stop = AtomicBoolean(false)
        val termine = AtomicBoolean(false)
        fun arret() = stop.get() || annule() || maintenant() >= echeance
        fun reste(): Long = echeance - maintenant()

        // 1. Adresses de départ.
        val essayees = ArrayList<String>()
        for (ip in departs) {
            if (arret()) break
            if (FiltreReseau.adressePrivee(ip) == null || ip in essayees) continue
            essayees.add(ip)
            val r = lire(ip, minOf(delaiLectureMs, maxOf(reste(), 1L)))
            if (r.ok) return ResultatRecherche(true, ip, trouve = false, etat = r)
        }

        // 2. Fouille du /24 : port ouvert, puis négociation de la clé sur ces seules adresses.
        val liste = candidats(prefixe).filter { it !in essayees }
        val trouves = CopyOnWriteArrayList<Pair<String, Resultat>>()
        val appareils = AtomicInteger(0)
        val lectures = AtomicInteger(0)
        val etape = AtomicReference("sondes")
        fun signaler() {
            if (termine.get()) return
            try { progres(Progres(etape.get(), appareils.get(), lectures.get(), echeance)) } catch (e: Exception) { /* sans effet */ }
        }
        signaler()
        val suivant = AtomicInteger(0)
        val verrouLecture = Any()
        val travailleurs = (1..minOf(parallelisme, maxOf(liste.size, 1))).map {
            Thread {
                while (!arret() && trouves.size <= 1) {
                    val i = suivant.getAndIncrement()
                    if (i >= liste.size) break
                    val ip = liste[i]
                    val ouvert = try { sonder(ip, DELAI_SONDE_MS) } catch (e: Exception) { false }
                    if (!ouvert || arret()) continue
                    appareils.incrementAndGet()
                    signaler()
                    synchronized(verrouLecture) {
                        if (arret() || trouves.size > 1) return@synchronized
                        etape.set("lectures")
                        lectures.incrementAndGet()
                        signaler()
                        val r = try { lire(ip, minOf(delaiLectureMs, maxOf(reste(), 1L))) } catch (e: Exception) { null }
                        if (r != null && r.ok) trouves.add(ip to r)
                        Unit
                    }
                }
            }.apply { isDaemon = true; start() }
        }
        for (t in travailleurs) {
            // Chaque fil rend la main au plus tard après la lecture en cours (bornée par le temps restant).
            val limite = reste() + delaiLectureMs + 1_000
            try { t.join(maxOf(limite, 1L)) } catch (e: InterruptedException) { Thread.currentThread().interrupt(); stop.set(true) }
        }
        stop.set(true)
        termine.set(true)

        // 3. Exactement un câble, sinon échec (jamais de choix au hasard).
        if (!annule() && trouves.size == 1) {
            val (ip, r) = trouves[0]
            return ResultatRecherche(true, ip, trouve = true, etat = r)
        }
        return ResultatRecherche(false)
    }
}
