package fr.rechargeds3.coque.cable

import java.time.ZoneId
import java.time.ZonedDateTime

/** Plage de charge du câble (dp 151, x_charge_mode) : m = 2 plage active, 0 charge immédiate ; dt recopié tel quel. */
data class PlageCharge(val m: Int, val dt: Int, val ss: String, val se: String)

/**
 * Décision de programmation (règle du démarrage tardif, 2026-11-22), prise AU MOMENT DE L'ENVOI :
 *  - [Normale] : écrire l'allumage et la fin demandés ;
 *  - [Tardive] : début déjà passé ou dans moins de 10 min : début = maintenant + 10 min, fin = min(début + durée, départ) ;
 *  - [TropTard] : début >= départ, rien n'est écrit ;
 *  - [Invalide] : demande refusée (heures, durée, ou fin hors de la nuit).
 */
sealed class Decision {
    data class Normale(val debut: String, val fin: String) : Decision()
    data class Tardive(val debut: String, val fin: String) : Decision()
    object TropTard : Decision()
    object Invalide : Decision()
}

/**
 * Règles sur la plage de charge, reprises de local/tuya-local.js (lirePlage, moinsUneMinute, autresPointsModifies).
 * La décision d'écriture ([decider], démarrage tardif) est NOUVELLE : local/tuya-local.js (outil PC) garde l'ancienne règle
 * « immédiat » ; la règle est la même que celle du Worker (worker/src/service.js, deciderPlage), cas communs dans
 * tests/plage-tardif-cas.json. Kotlin pur ; fuseau Europe/Paris via java.time.
 */
object Plage {
    const val DP_PLAGE = "151"
    val DP_VOLATILS = setOf("101", "102", "105", "109")
    const val DP_ETAT = "109"

    /** Durée de charge demandée : 1 à 900 minutes. */
    const val DUREE_MIN_MAX = 900

    /** Un début qui tombe dans moins de 10 minutes est reporté à maintenant + 10 minutes. */
    const val MARGE_TARDIF_MIN = 10

    val PARIS: ZoneId = ZoneId.of("Europe/Paris")

    private val HEURE = Regex("([01][0-9]|2[0-3]):[0-5][0-9]")

    // Valeur du dp 151 attendue, caractère pour caractère : {"m":(0|2),"dt":<entier>,"ss":"HH:MM","se":"HH:MM"}.
    // Plus stricte que le JS (qui accepte des espaces ou « 5.0 » pour dt) : le câble écrit toujours cette forme compacte.
    // dt : entier JSON sans zéro de tête, 9 chiffres au plus (jamais d'imprécision de nombre flottant).
    private val FORME = Regex(
        "\\{\"m\":(0|2),\"dt\":(0|-?[1-9][0-9]{0,8}),\"ss\":\"(([01][0-9]|2[0-3]):[0-5][0-9])\",\"se\":\"(([01][0-9]|2[0-3]):[0-5][0-9])\"\\}",
    )

    /** HH:MM strict (00:00 à 23:59, deux chiffres ASCII partout, rien avant ni après). */
    fun heureValide(texte: String): Boolean = HEURE.matchEntire(texte) != null

    /** La plage décrite par la valeur du dp 151, ou null si la forme n'est pas EXACTEMENT celle attendue. */
    fun lirePlage(valeur: String): PlageCharge? {
        val r = FORME.matchEntire(valeur) ?: return null
        val g = r.groupValues
        return PlageCharge(g[1].toInt(), g[2].toInt(), g[3], g[5])
    }

    fun minutes(hhmm: String): Int = hhmm.substring(0, 2).toInt() * 60 + hhmm.substring(3).toInt()

    private fun deuxChiffres(n: Int): String = n.toString().padStart(2, '0')

    private fun formater(totalMinutes: Int): String = mod24(totalMinutes).let { deuxChiffres(it / 60) + ":" + deuxChiffres(it % 60) }

    /** Heure de Paris (HH:MM) de [instant], quel que soit le fuseau du système. */
    fun heureParis(instant: ZonedDateTime): String {
        val p = instant.withZoneSameInstant(PARIS)
        return deuxChiffres(p.hour) + ":" + deuxChiffres(p.minute)
    }

    private fun mod24(x: Int): Int = ((x % 1440) + 1440) % 1440

    /**
     * Demande de programmation valide : trois heures HH:MM strictes, durée entière de 1 à 900 minutes, et fin comprise entre
     * l'allumage (exclu) et le départ (inclus), en heures murales, minuit compris. Allumage = départ est refusé.
     */
    fun demandeValide(allumage: String, fin: String, dureeMin: Int, depart: String): Boolean {
        if (!heureValide(allumage) || !heureValide(fin) || !heureValide(depart)) return false
        if (dureeMin < 1 || dureeMin > DUREE_MIN_MAX) return false
        val a = minutes(allumage)
        val nuit = mod24(minutes(depart) - a) // de l'allumage au départ
        val jusquaFin = mod24(minutes(fin) - a)
        return nuit > 0 && jusquaFin > 0 && jusquaFin <= nuit
    }

    /** Minutes depuis minuit (heure murale de Paris) arrondies à la minute SUPÉRIEURE : 23:50:20 donne 23:51. */
    private fun minutesParisSuperieures(instant: ZonedDateTime): Int {
        val p = instant.withZoneSameInstant(PARIS)
        val reste = if (p.second > 0 || p.nano > 0) 1 else 0
        return mod24(p.hour * 60 + p.minute + reste)
    }

    /**
     * Règle du démarrage tardif (décision du 2026-11-22), appliquée AU MOMENT DE L'ENVOI et en heure murale de Paris : la plage
     * se répète chaque nuit, il n'y a pas de date. « Dans la nuit » = maintenant est entre l'allumage (inclus) et le départ
     * (exclu), minuit compris. Si l'allumage est dans la nuit ou dans moins de 10 min : début = maintenant + 10 min,
     * fin = min(début + durée, départ) ; si le départ est à 10 min ou moins : [Decision.TropTard]. Sinon allumage et fin demandés.
     * Nuits de changement d'heure : minutes murales, sans viser l'exactitude (60 minutes d'écart possibles avec l'heure réelle).
     */
    fun decider(allumage: String, fin: String, dureeMin: Int, depart: String, maintenant: ZonedDateTime): Decision {
        if (!demandeValide(allumage, fin, dureeMin, depart)) return Decision.Invalide
        val a = minutes(allumage)
        val n = minutesParisSuperieures(maintenant)
        val nuit = mod24(minutes(depart) - a)
        val dansLaNuit = mod24(n - a) < nuit
        if (!dansLaNuit && mod24(a - n) >= MARGE_TARDIF_MIN) return Decision.Normale(allumage, fin)
        val avantDepart = mod24(minutes(depart) - n) // minutes jusqu'au prochain départ
        if (avantDepart <= MARGE_TARDIF_MIN) return Decision.TropTard
        return Decision.Tardive(formater(n + MARGE_TARDIF_MIN), formater(n + minOf(MARGE_TARDIF_MIN + dureeMin, avantDepart)))
    }

    /** Début de la plage « courte » : la fin moins une minute (00:00 donne 23:59). */
    fun moinsUneMinute(hhmm: String): String = formater((minutes(hhmm) + 1439) % 1440)

    /**
     * Vrai si un point de données autre que le dp 151 et les points volatils (101, 102, 105, 109) a changé, est apparu
     * ou a disparu entre [avant] et [apres]. Valeurs comparées par leur forme JSON compacte (ordre des clés compris).
     */
    fun autresPointsModifies(avant: Map<String, Any?>, apres: Map<String, Any?>): Boolean {
        for (k in avant.keys + apres.keys) {
            if (k == DP_PLAGE || k in DP_VOLATILS) continue
            if (avant.containsKey(k) != apres.containsKey(k)) return true
            if (JsonStrict.serialiser(avant[k]) != JsonStrict.serialiser(apres[k])) return true
        }
        return false
    }
}
