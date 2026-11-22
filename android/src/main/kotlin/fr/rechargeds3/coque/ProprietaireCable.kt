package fr.rechargeds3.coque

import android.content.Context

/**
 * Propriétaire unique (sans framework) de ce qui touche au câble, pour tout le processus : le suivi du Wi-Fi, le coffre
 * et l'unique OperationsCable. L'activité et le service d'attente les récupèrent ici au lieu d'en créer chacun : une
 * page rechargée ou une activité détruite ne coupe plus ce que le service a lancé, et la mémoire de la clé a un seul maître
 * (revue d'architecture du 2026-11-22, constat n°1).
 *
 * Seul le contexte d'application est gardé (aucune activité n'est retenue). Le suivi du Wi-Fi (demarrer/arreter) reste
 * piloté par le cycle de vie de l'activité et du service ; sans suivi, creerTransport() rend null (« pas_wifi »).
 */
class ProprietaireCable private constructor(contexte: Context) {
    val wifi = ReseauWifi(contexte)
    val coffre = CoffreCable(contexte)
    val operations = OperationsCable(EnvironnementAndroid(wifi, coffre))

    companion object {
        @Volatile
        private var instance: ProprietaireCable? = null

        fun obtenir(contexte: Context): ProprietaireCable =
            instance ?: synchronized(this) {
                instance ?: ProprietaireCable(contexte.applicationContext).also { instance = it }
            }
    }
}
