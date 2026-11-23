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
 * Hôte de l'attente en arrière-plan (lot E3, décisions des 2026-11-21 et 2026-11-22). Service de premier plan
 * `connectedDevice`, lancé SEULEMENT par « Programmer » (opération attenteDebut de la page visible, après que le [PiloteAttente]
 * a démarré). Il prête au pilote un fil, un verrou de réveil et le suivi du Wi-Fi ; c'est le pilote qui attend, lit,
 * cherche et envoie. La page n'est plus qu'une vue : balayer l'appli, recharger la page ou éteindre l'écran n'annule rien.
 *
 * Notifications (textes fixes de strings.xml, seules les heures HH:MM validées viennent de la page) :
 *  - continue pendant l'attente, avec « Annuler » (PendingIntent explicite et immuable vers ce service) ; elle perd « Annuler »
 *    quand l'envoi commence ;
 *  - de résultat, non continue, touchée = l'appli se rouvre : publiée à la fin de l'attente, sauf si l'appli est visible (la
 *    page montre alors le résultat elle-même) ; retirée quand la page a vu le résultat. Notifications refusées : même service,
 *    le résultat est montré à la réouverture de l'appli. Le filet de 15 min clôt toute attente restée sans résultat.
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
 * Bornes : 15 min au plus, verrou de réveil partiel de 16 min au plus, START_NOT_STICKY (jamais relancé par le système),
 * non exporté, jamais démarré au boot ni par une alarme.
 */
class AttenteWifi : Service(), EcouteurAttente {

    private val principal = Handler(Looper.getMainLooper())
    private val demarrages = SuiviDemarrages()
    private var verrou: PowerManager.WakeLock? = null
    private var fil: Thread? = null
    private var suiviWifi = false
    private lateinit var pilote: PiloteAttente
    private val filet = Runnable { Thread { pilote.finaliserInconnu() }.start() }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        demarrages.enregistrer(startId)
        val proprietaire = ProprietaireCable.obtenir(this)
        pilote = proprietaire.pilote
        if (intent?.action == ACTION_ANNULER) {
            // Venu de la notification : seulement avant l'envoi (le pilote refuse ensuite) ; hors du fil principal (connexions).
            // Le test de `fil` (propre au fil principal) est reposté sur `principal`.
            Thread { pilote.annuler(); if (!pilote.enCours()) principal.post { if (fil == null) stopSelf(startId) } }.start()
            return START_NOT_STICKY
        }
        // ACTION_DEBUT (startForegroundService) : startForeground() obligatoire, tout de suite.
        startForeground(ID_ATTENTE, notificationAttente(annulable = true), ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE)
        if (pilote.phaseActuelle() != Phase.ATTENTE) { stopSelf(startId); return START_NOT_STICKY } // lancé pour rien
        if (fil != null) return START_NOT_STICKY // second démarrage : la boucle tourne déjà
        lancerBoucle()
        return START_NOT_STICKY
    }

    /** Fil principal seulement. Prépare le suivi Wi-Fi, le verrou, l'écouteur et le filet, puis lance la boucle du pilote. */
    private fun lancerBoucle() {
        if (!suiviWifi) {
            val proprietaire = ProprietaireCable.obtenir(this)
            proprietaire.wifi.demarrer() // le service suit le Wi-Fi lui-même (l'activité peut être arrêtée)
            suiviWifi = true
        }
        verrou?.takeIf { it.isHeld }?.release()
        verrou = getSystemService(PowerManager::class.java)
            .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, ETIQUETTE_VERROU)
            .apply { setReferenceCounted(false); acquire(VERROU_MAX_MS) }
        pilote.ecouteur = this
        principal.removeCallbacks(filet)
        principal.postDelayed(filet, DUREE_MAX_MS)
        fil = Thread({
            pilote.lancer()
            // Seule décision d'arrêt du service, sur le fil principal, quand la boucle rend la main (avec ou sans termine() : phase
            // déjà quittée avant le départ du fil). Course : une nouvelle « Programmer » peut passer (pilote.demarrer) et son
            // onStartCommand voir `fil != null` sans lancer la boucle ; si le pilote est de nouveau en attente, on relance donc ici ;
            // sinon `fil` repasse à null et stopSelf(id) n'arrête le service que si aucun démarrage plus récent n'est arrivé.
            // Seul le fil encore enregistré décide (un seul fil de boucle à la fois).
            val moi = Thread.currentThread()
            principal.post { if (fil === moi) apresFinBoucle() }
        }, "attente-cable").apply { isDaemon = true; start() }
    }

    /** Fil principal seulement : relance la boucle si une nouvelle attente a démarré, sinon arrête le service. */
    private fun apresFinBoucle() {
        when (SuiviDemarrages.suiteApresFin(pilote.phaseActuelle())) {
            SuiviDemarrages.Suite.RELANCER -> lancerBoucle()
            SuiviDemarrages.Suite.ARRETER -> { fil = null; stopSelf(demarrages.pourArret()) }
        }
    }

    // --- EcouteurAttente (appelé depuis les fils du pilote) ---

    override fun envoiCommence() {
        principal.post { notifier(ID_ATTENTE, notificationAttente(annulable = false)) }
    }

    override fun termine(issue: Attente.Issue, debut: String?, fin: String?) {
        pilote.ecouteur = null
        if (!activiteVisible) publierResultat(applicationContext, issue, debut, fin)
        // L'arrêt ou la relance du service ne se décide pas ici mais quand le fil de la boucle rend la main (voir lancerBoucle) :
        // une seule décision par fil, même si termine() vient d'un autre fil (Annuler, filet, nouvelle clé).
    }

    // Filet : connectedDevice n'a pas d'échéance système connue ; si elle venait à exister, on le dit et on s'arrête.
    override fun onTimeout(startId: Int, fgsType: Int) {
        Thread { pilote.finaliserInconnu() }.start()
    }

    override fun onDestroy() {
        principal.removeCallbacks(filet)
        try { verrou?.takeIf { it.isHeld }?.release() } catch (e: RuntimeException) { /* déjà relâché par le délai */ }
        verrou = null
        stopForeground(STOP_FOREGROUND_REMOVE)
        if (suiviWifi) { suiviWifi = false; ProprietaireCable.obtenir(this).wifi.arreter() }
        // Service détruit alors que l'attente n'est pas finie (arrêt du système) : jamais de silence, résultat « inconnu ».
        if (::pilote.isInitialized && pilote.enCours()) Thread { pilote.finaliserInconnu() }.start()
        super.onDestroy()
    }

    private fun notifier(id: Int, n: Notification) {
        try { getSystemService(NotificationManager::class.java).notify(id, n) } catch (e: RuntimeException) { /* refusé */ }
    }

    private fun notificationAttente(annulable: Boolean): Notification {
        creerCanaux(this)
        val debut = if (::pilote.isInitialized) pilote.debutManuel() else null
        val b = Notification.Builder(this, CANAL_ATTENTE)
            .setSmallIcon(R.drawable.ic_lanceur_mono)
            .setContentTitle(getString(if (annulable) R.string.attente_titre else R.string.attente_envoi_titre))
            .setContentText(getString(if (annulable) R.string.attente_texte else R.string.attente_envoi_texte, debut ?: HEURE_INCONNUE))
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
        private const val CANAL_ATTENTE = "attente"
        private const val CANAL_RESULTAT = "resultat"
        private const val ID_ATTENTE = 1
        private const val ID_RESULTAT = 2
        private const val ETIQUETTE_VERROU = "RechargeDS3:attente"
        private const val HEURE_INCONNUE = "--:--"
        const val DUREE_MAX_MS = 15L * 60 * 1000
        private const val VERROU_MAX_MS = 16L * 60 * 1000

        /** Posé par MainActivity : l'appli est visible, la page montre elle-même le résultat (pas de notification de résultat). */
        @Volatile
        var activiteVisible = false

        /** Lance le service de premier plan (la page est visible : démarrage permis). Vrai si la demande est partie. */
        fun lancer(ctx: Context): Boolean = try {
            ctx.startForegroundService(Intent(ctx, AttenteWifi::class.java).setAction(ACTION_DEBUT))
            true
        } catch (e: Exception) { // ForegroundServiceStartNotAllowedException, SecurityException…
            false
        }

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

        /** Notification de résultat, non continue ; texte fixe, heures (début %1$s, fin %2$s) validées par le pilote. */
        fun publierResultat(ctx: Context, issue: Attente.Issue, debut: String?, fin: String?) {
            creerCanaux(ctx)
            val (titre, texte) = Attente.textes(issue)
            val d = debut ?: HEURE_INCONNUE
            val f = fin ?: HEURE_INCONNUE
            val corps = ctx.getString(texte, d, f)
            val n = Notification.Builder(ctx, CANAL_RESULTAT)
                .setSmallIcon(R.drawable.ic_lanceur_mono)
                .setContentTitle(ctx.getString(titre, d, f))
                .setContentText(corps)
                .setStyle(Notification.BigTextStyle().bigText(corps))
                .setAutoCancel(true)
                .setContentIntent(ouvrirAppli(ctx))
                .build()
            try { ctx.getSystemService(NotificationManager::class.java).notify(ID_RESULTAT, n) } catch (e: RuntimeException) { /* refusé */ }
        }

        /** La page a vu le résultat : la notification de résultat est retirée. */
        fun retirerResultat(ctx: Context) {
            try { ctx.getSystemService(NotificationManager::class.java).cancel(ID_RESULTAT) } catch (e: RuntimeException) { /* sans effet */ }
        }
    }
}
