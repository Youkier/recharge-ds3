package fr.rechargeds3.coque

import android.content.Context
import android.content.pm.ApplicationInfo
import android.util.Log
import java.io.File

/**
 * Propriétaire unique (sans framework) de ce qui touche au câble, pour tout le processus : le suivi du Wi-Fi, le coffre,
 * l'unique OperationsCable et le pilote de l'attente. L'activité et le service d'attente les récupèrent ici au lieu d'en créer
 * chacun : une page rechargée ou une activité détruite ne coupe plus ce que le service a lancé, et la mémoire de la clé a
 * un seul maître (revue d'architecture du 2026-11-22, constat n°1).
 *
 * Seul le contexte d'application est gardé (aucune activité n'est retenue). Le suivi du Wi-Fi (demarrer/arreter) est compté :
 * l'activité visible et le service d'attente l'utilisent chacun à leur tour ; sans suivi, creerTransport() rend null (« pas_wifi »).
 * Le pilote relit son fichier à sa création : une attente restée « en cours » d'un processus tué devient « non suivie ».
 */
class ProprietaireCable private constructor(contexte: Context) {
    val wifi = ReseauWifi(contexte)
    val coffre = CoffreCable(contexte)
    private val env = EnvironnementAndroid(wifi, coffre)
    val operations = OperationsCable(env)
    // Version de mise au point seulement : le pilote journalise ses phases et ses vérifications du Wi-Fi (« ESSAI … », sans secret ni adresse).
    private val debug = (contexte.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0
    val pilote = PiloteAttente(
        operations, env, StockageAttenteFichier(File(contexte.filesDir, "attente.json")),
        trace = if (debug) fun(m: String) { Log.i("RechargeEssai", "ESSAI {\"action\":\"pilote\",\"msg\":\"" + m + "\"}") } else fun(_: String) { },
    )

    companion object {
        @Volatile
        private var instance: ProprietaireCable? = null

        fun obtenir(contexte: Context): ProprietaireCable =
            instance ?: synchronized(this) {
                instance ?: ProprietaireCable(contexte.applicationContext).also { instance = it }
            }
    }
}
