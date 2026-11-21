package fr.rechargeds3.coque

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager

/**
 * Service de premier plan minimal de l'essai de faisabilité E0 (décision du 2026-11-21, attente en arrière-plan) : il garde
 * le processus (et donc la WebView et le pont) en vie pendant que l'activité est en arrière-plan, écran éteint, téléphone
 * verrouillé. Il ne fait RIEN d'autre : aucune connexion, aucune lecture du coffre ; l'envoi reste fait par le JavaScript.
 *
 * Déclaré SEULEMENT dans le manifeste de la version de mise au point (android/src/debug/AndroidManifest.xml) tant que E0
 * n'a pas réussi : dans la version publiée, la classe existe mais n'est déclarée nulle part, et rien ne la démarre (le pont
 * refuse l'opération hors mise au point).
 *
 * Sources (developer.android.com, relevées le 2026-11-21) :
 *   develop/background-work/services/fgs/service-types, « Connected device » : type `connectedDevice`, permission
 *   FOREGROUND_SERVICE_CONNECTED_DEVICE (en plus de FOREGROUND_SERVICE), constante FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE
 *   pour startForeground() ; prérequis : au moins une permission parmi CHANGE_NETWORK_STATE, CHANGE_WIFI_STATE,
 *   CHANGE_WIFI_MULTICAST_STATE, NFC, TRANSMIT_IR (ici CHANGE_NETWORK_STATE, permission normale). Pas de durée maximale
 *   imposée à ce type (seuls dataSync et mediaProcessing en ont) : la borne de 15 min est la nôtre.
 *   Service.startForeground(int, Notification, int) (API 29) ; Service.onTimeout(int, int) (API 35) ;
 *   PowerManager.WakeLock.acquire(long) : verrou relâché de lui-même après le délai.
 *
 * Bornes : arrêt de lui-même après DUREE_MAX_MS (15 min), verrou de réveil partiel de 16 min au plus, START_NOT_STICKY
 * (jamais relancé par le système après sa mort), non exporté.
 */
class AttenteWifi : Service() {

    private val principal = Handler(Looper.getMainLooper())
    private var verrou: PowerManager.WakeLock? = null
    private val finAuto = Runnable { stopSelf() }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        actif = true
        startForeground(ID_NOTIFICATION, notification(), ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE)
        if (verrou == null) {
            verrou = getSystemService(PowerManager::class.java)
                .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, ETIQUETTE_VERROU)
                .apply { setReferenceCounted(false); acquire(VERROU_MAX_MS) }
        }
        // Un nouveau démarrage repart pour 15 min au plus (un seul minuteur à la fois).
        principal.removeCallbacks(finAuto)
        principal.postDelayed(finAuto, DUREE_MAX_MS)
        return START_NOT_STICKY
    }

    // Filet de sécurité : connectedDevice n'a pas d'échéance système connue, mais si elle venait à exister, on s'arrête.
    override fun onTimeout(startId: Int, fgsType: Int) {
        stopSelf()
    }

    override fun onDestroy() {
        principal.removeCallbacks(finAuto)
        try { verrou?.takeIf { it.isHeld }?.release() } catch (e: RuntimeException) { /* déjà relâché par le délai */ }
        verrou = null
        stopForeground(STOP_FOREGROUND_REMOVE)
        actif = false
        // Arrêt du service (fin, échéance, système) : l'activité ferme ce que son onStop a laissé ouvert si elle n'est
        // plus visible — plus aucune connexion ouverte hors de l'appli au premier plan.
        try { surFin?.invoke() } catch (e: RuntimeException) { /* activité déjà détruite */ }
        super.onDestroy()
    }

    private fun notification(): Notification {
        val nm = getSystemService(NotificationManager::class.java)
        // Créer un canal existant ne fait rien : appel idempotent.
        nm.createNotificationChannel(
            NotificationChannel(CANAL, getString(R.string.canal_attente), NotificationManager.IMPORTANCE_LOW)
        )
        return Notification.Builder(this, CANAL)
            .setSmallIcon(R.drawable.ic_lanceur_mono)
            .setContentTitle(getString(R.string.notification_essai))
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE)
            .build()
    }

    companion object {
        private const val CANAL = "attente"
        private const val ID_NOTIFICATION = 1
        private const val ETIQUETTE_VERROU = "RechargeDS3:attente"
        const val DUREE_MAX_MS = 15L * 60 * 1000
        private const val VERROU_MAX_MS = 16L * 60 * 1000

        /** Vrai de la demande de démarrage (posé par MainActivity) jusqu'à la destruction du service. */
        @Volatile
        var actif = false

        /** Posé par MainActivity (fil principal) : fermeture du pont et du suivi du Wi-Fi si l'activité est cachée. */
        @Volatile
        var surFin: (() -> Unit)? = null
    }
}
