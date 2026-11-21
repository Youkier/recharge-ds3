package fr.rechargeds3.coque.cable

import java.time.ZoneId
import java.time.ZonedDateTime

/** Plage de charge du câble (dp 151, x_charge_mode) : m = 2 plage active, 0 charge immédiate ; dt recopié tel quel. */
data class PlageCharge(val m: Int, val dt: Int, val ss: String, val se: String)

/** Démarrage retenu : [debut] (HH:MM) et [immediat] vrai si l'heure demandée est déjà passée dans la plage. */
data class Decision(val debut: String, val immediat: Boolean)

/**
 * Règles sur la plage de charge, reprises de local/tuya-local.js (lirePlage, decider, moinsUneMinute,
 * autresPointsModifies). Kotlin pur ; fuseau Europe/Paris via java.time.
 */
object Plage {
    const val DP_PLAGE = "151"
    val DP_VOLATILS = setOf("101", "102", "105", "109")
    const val DP_ETAT = "109"

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

    private fun formater(totalMinutes: Int): String = deuxChiffres(totalMinutes / 60) + ":" + deuxChiffres(totalMinutes % 60)

    /** Heure de Paris (HH:MM) de [instant], quel que soit le fuseau du système. */
    fun heureParis(instant: ZonedDateTime): String {
        val p = instant.withZoneSameInstant(PARIS)
        return deuxChiffres(p.hour) + ":" + deuxChiffres(p.minute)
    }

    /**
     * Règle de l'heure déjà passée (décision du 2026-11-14) : si Paris est maintenant dans la plage [allumage, fin[,
     * le démarrage est immédiat (heure de Paris actuelle) ; sinon l'heure demandée. Plage qui passe minuit comprise ;
     * allumage = fin : jamais dedans.
     */
    fun decider(allumage: String, fin: String, maintenant: ZonedDateTime): Decision {
        val nowHHMM = heureParis(maintenant)
        val a = minutes(allumage)
        val f = minutes(fin)
        val n = minutes(nowHHMM)
        val dedans = if (a < f) n >= a && n < f else if (a > f) n >= a || n < f else false
        return if (dedans) Decision(nowHHMM, true) else Decision(allumage, false)
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
