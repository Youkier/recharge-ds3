package fr.rechargeds3.coque

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.drawable.Icon
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager

/**
 * Attente en arrière-plan (décisions du 2026-11-21 ; faisabilité vérifiée par l'essai E0 en CI, 10/10 sur API 35 et 36,
 * écran éteint et verrouillé, Doze forcé compris). Service de premier plan `connectedDevice` lancé SEULEMENT par
 * « Programmer » (page visible) : il garde le processus, donc la WebView et le pont, pendant que la page attend le Wi-Fi
 * et le câble. Il ne fait AUCUNE opération réseau ni lecture du coffre : l'envoi reste fait par le JavaScript existant.
 *
 * Notifications (textes fixes de strings.xml, seule l'heure HH:MM validée vient de la page) :
 *  - continue pendant l'attente, avec « Annuler » (PendingIntent explicite et immuable vers ce service) ;
 *  - de résultat, non continue, touchée = l'appli se rouvre : envoyée par terminer() (attenteFin de la page) ou par les
 *    filets de la règle 2 : 15 min sans résultat (« Résultat inconnu »), appli fermée pendant l'attente (« Programmation
 *    non envoyée »), 60 s après « Annuler » sans réponse de la page (« Résultat inconnu »). Jamais d'échec silencieux.
 *
 * Sources (developer.android.com, relevées le 2026-11-21) :
 *   develop/background-work/services/fgs/service-types, « Connected device » : type `connectedDevice`, permission
 *   FOREGROUND_SERVICE_CONNECTED_DEVICE (en plus de FOREGROUND_SERVICE), constante FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE
 *   pour startForeground() ; prérequis : au moins une permission parmi CHANGE_NETWORK_STATE, CHANGE_WIFI_STATE,
 *   CHANGE_WIFI_MULTICAST_STATE, NFC, TRANSMIT_IR (ici CHANGE_NETWORK_STATE, permission normale). Pas de durée maximale
 *   imposée à ce type (seuls dataSync et mediaProcessing en ont) : la borne de 15 min est la nôtre.
 *   Service.startForeground(int, Notification, int) (API 29) ; Service.onTimeout(int, int) (API 35) ;
 *   Service.onTaskRemoved(Intent) ; PowerManager.WakeLock.acquire(long) : verrou relâché de lui-même après le délai.
 *
 * Bornes : 15 min au plus, verrou de réveil partiel de 16 min au plus, START_NOT_STICKY (jamais relancé par le système),
 * non exporté. Toutes les méthodes s'exécutent sur le fil principal.
 */
class AttenteWifi : Service() {

    private val principal = Handler(Looper.getMainLooper())
    private var verrou: PowerManager.WakeLock? = null
    private var heure: String? = null // HH:MM validée, null si inconnue
    private var enAttente = false
    private val filet = Runnable { terminer(Attente.Issue.INCONNUE) }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_ANNULER) {
            // Venu de la notification : seulement si une attente tourne (sinon, service lancé pour rien : on s'arrête).
            if (!enAttente) { stopSelf(startId); return START_NOT_STICKY }
            annulee = true
            notifier(ID_ATTENTE, notificationAttente(annulable = false))
            // La page lit « annulee » et appelle attenteFin ; si elle ne répond pas, résultat inconnu au bout de 60 s.
            principal.removeCallbacks(filet)
            principal.postDelayed(filet, DELAI_APRES_ANNULER_MS)
            return START_NOT_STICKY
        }
        // ACTION_DEBUT (startForegroundService) : startForeground() obligatoire, tout de suite.
        intent?.getStringExtra(EXTRA_HEURE)?.takeIf { Attente.heureValide(it) }?.let { heure = it }
        startForeground(ID_ATTENTE, notificationAttente(annulable = true), ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE)
        instance = this
        actif = true
        enAttente = true
        if (verrou == null) {
            verrou = getSystemService(PowerManager::class.java)
                .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, ETIQUETTE_VERROU)
                .apply { setReferenceCounted(false); acquire(VERROU_MAX_MS) }
        }
        principal.removeCallbacks(filet)
        principal.postDelayed(filet, DUREE_MAX_MS)
        // Résultat arrivé avant le démarrage effectif du service (course rare) : on le publie et on s'arrête.
        finDemandee?.let { (issue, h) -> finDemandee = null; terminer(issue, h) }
        return START_NOT_STICKY
    }

    /**
     * Fin de l'attente : notification de résultat (si issue non nulle), puis arrêt. h : heure à annoncer (par défaut celle
     * de l'attente ; null : texte sans heure, la page n'a pas pu la calculer).
     */
    /** Vrai tant que l'attente n'est pas terminée (aucun résultat publié). */
    val attendEncore: Boolean get() = enAttente

    fun terminer(issue: Attente.Issue?, h: String? = heure) {
        if (issue != null) publierResultat(this, issue, h?.takeIf { Attente.heureValide(it) })
        enAttente = false
        stopSelf()
    }

    // Appli balayée des applications récentes pendant l'attente : la page n'existe plus, rien ne sera envoyé.
    override fun onTaskRemoved(rootIntent: Intent?) {
        if (enAttente) terminer(Attente.Issue.APPLI_FERMEE)
        super.onTaskRemoved(rootIntent)
    }

    // Filet : connectedDevice n'a pas d'échéance système connue ; si elle venait à exister, on le dit et on s'arrête.
    override fun onTimeout(startId: Int, fgsType: Int) {
        terminer(Attente.Issue.INCONNUE)
    }

    override fun onDestroy() {
        principal.removeCallbacks(filet)
        try { verrou?.takeIf { it.isHeld }?.release() } catch (e: RuntimeException) { /* déjà relâché par le délai */ }
        verrou = null
        stopForeground(STOP_FOREGROUND_REMOVE)
        enAttente = false
        if (instance === this) instance = null
        actif = false
        // Fin de l'attente : la configuration gardée en mémoire est effacée, quelle que soit l'activité.
        try { ProprietaireCable.obtenir(this).operations.oublierMemoire() } catch (e: RuntimeException) { /* sans effet */ }
        // L'activité ferme ce que son onStop a laissé ouvert si elle n'est plus visible.
        try { surFin?.invoke() } catch (e: RuntimeException) { /* activité déjà détruite */ }
        super.onDestroy()
    }

    private fun notifier(id: Int, n: Notification) {
        try { getSystemService(NotificationManager::class.java).notify(id, n) } catch (e: RuntimeException) { /* refusé */ }
    }

    private fun notificationAttente(annulable: Boolean): Notification {
        creerCanaux(this)
        val b = Notification.Builder(this, CANAL_ATTENTE)
            .setSmallIcon(R.drawable.ic_lanceur_mono)
            .setContentTitle(getString(R.string.attente_titre))
            .setContentText(getString(R.string.attente_texte, heure ?: HEURE_INCONNUE))
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setContentIntent(ouvrirAppli(this))
            .setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE)
        if (annulable) {
            val annuler = PendingIntent.getService(
                this, 1, Intent(this, AttenteWifi::class.java).setAction(ACTION_ANNULER),
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            )
            b.addAction(Notification.Action.Builder(Icon.createWithResource(this, R.drawable.ic_lanceur_mono), getString(R.string.annuler), annuler).build())
        }
        return b.build()
    }

    companion object {
        const val ACTION_DEBUT = "fr.rechargeds3.coque.attente.DEBUT"
        private const val ACTION_ANNULER = "fr.rechargeds3.coque.attente.ANNULER"
        const val EXTRA_HEURE = "heure"
        private const val CANAL_ATTENTE = "attente"
        private const val CANAL_RESULTAT = "resultat"
        private const val ID_ATTENTE = 1
        private const val ID_RESULTAT = 2
        private const val ETIQUETTE_VERROU = "RechargeDS3:attente"
        private const val HEURE_INCONNUE = "--:--"
        const val DUREE_MAX_MS = 15L * 60 * 1000
        private const val VERROU_MAX_MS = 16L * 60 * 1000
        private const val DELAI_APRES_ANNULER_MS = 60L * 1000

        /** Vrai de la demande de démarrage (posé par MainActivity) jusqu'à la destruction du service. */
        @Volatile
        var actif = false

        /** « Annuler » touché dans la notification ; remis à faux au prochain démarrage (lu par attenteEtat). */
        @Volatile
        var annulee = false

        /** Une attente attend encore un résultat (fil principal) : service en cours non terminé, ou démarrage demandé sans
         *  fin déjà demandée. */
        fun attenteEnCours(): Boolean = instance?.attendEncore ?: (actif && finDemandee == null)

        /** Service en cours (fil principal seulement). */
        var instance: AttenteWifi? = null

        /** Résultat donné par la page avant que le service ait démarré (fil principal seulement). */
        var finDemandee: Pair<Attente.Issue, String?>? = null

        /** Posé par MainActivity (fil principal) : fermeture du pont et du suivi du Wi-Fi si l'activité est cachée. */
        @Volatile
        var surFin: (() -> Unit)? = null

        private fun creerCanaux(ctx: Context) {
            val nm = ctx.getSystemService(NotificationManager::class.java)
            // Créer un canal existant ne fait rien : appels idempotents.
            nm.createNotificationChannel(NotificationChannel(CANAL_ATTENTE, ctx.getString(R.string.canal_attente), NotificationManager.IMPORTANCE_LOW))
            nm.createNotificationChannel(NotificationChannel(CANAL_RESULTAT, ctx.getString(R.string.canal_resultat), NotificationManager.IMPORTANCE_DEFAULT))
        }

        // Toucher une notification rouvre l'appli (tâche existante ramenée au premier plan, sinon nouvelle).
        private fun ouvrirAppli(ctx: Context): PendingIntent {
            val i = ctx.packageManager.getLaunchIntentForPackage(ctx.packageName)
                ?: Intent(ctx, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            return PendingIntent.getActivity(ctx, 0, i, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        }

        /** Notification de résultat, non continue ; utilisable aussi quand le service est déjà arrêté. */
        fun publierResultat(ctx: Context, issue: Attente.Issue, heure: String?) {
            creerCanaux(ctx)
            val (titre, texte) = Attente.textes(issue, avecHeure = heure != null)
            val corps = ctx.getString(texte, heure)
            val n = Notification.Builder(ctx, CANAL_RESULTAT)
                .setSmallIcon(R.drawable.ic_lanceur_mono)
                .setContentTitle(ctx.getString(titre, heure))
                .setContentText(corps)
                .setStyle(Notification.BigTextStyle().bigText(corps))
                .setAutoCancel(true)
                .setContentIntent(ouvrirAppli(ctx))
                .build()
            try { ctx.getSystemService(NotificationManager::class.java).notify(ID_RESULTAT, n) } catch (e: RuntimeException) { /* refusé */ }
        }
    }
}
