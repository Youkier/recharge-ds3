package fr.rechargeds3.coque

import android.Manifest
import android.app.Activity
import android.app.AlertDialog
import android.app.KeyguardManager
import android.app.NotificationManager
import android.content.ClipboardManager
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.os.Bundle
import android.os.PowerManager
import android.text.Editable
import android.text.InputType
import android.text.TextWatcher
import android.util.Log
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.view.WindowInsets
import android.view.WindowManager
import android.view.autofill.AutofillManager
import android.view.inputmethod.InputMethodManager
import android.webkit.ConsoleMessage
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.TextView
import androidx.webkit.ServiceWorkerClientCompat
import androidx.webkit.ServiceWorkerControllerCompat
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONObject

/**
 * Une seule activité : l'écran natif de saisie de l'identifiant et de la clé du câble, puis la WebView qui affiche la page
 * embarquée (site/, lot C4). La page d'essai (android/essai/) n'est chargée que par la version de mise au point, quand
 * adb demande une action (scénarios d'émulateur). Thème plateforme DeviceDefault.DayNight (pas d'AppCompat) : prefers-color-scheme
 * de la page suit le thème clair ou sombre du téléphone.
 */
class MainActivity : Activity() {

    private val estDebug: Boolean get() = (applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0

    private lateinit var racine: FrameLayout
    private lateinit var wifi: ReseauWifi
    private lateinit var coffre: CoffreCable
    private lateinit var pont: PontLocal
    private var formulaire: View? = null
    private var webView: WebView? = null
    private var pageChargee = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        nuit = resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK
        // Wi-Fi, coffre et opérations : uniques pour le processus (le service d'attente les partage).
        val proprietaire = ProprietaireCable.obtenir(this)
        wifi = proprietaire.wifi
        coffre = proprietaire.coffre
        pont = PontLocal(
            wifi, proprietaire.operations, estDebug,
            surSaisirCle = { afficherFormulaire() },
            prendreActionAuto = { actionAuto() },
            essaiArrierePlan = { quoi -> essaiArrierePlan(quoi) },
            attente = { op, q, rep -> attente(op, q, rep) },
        )

        racine = FrameLayout(this)
        // Ciblage SDK 36 : l'affichage va sous les barres système ; on réserve leur place (et celle du clavier).
        racine.setOnApplyWindowInsetsListener { v, insets ->
            val b = insets.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.displayCutout() or WindowInsets.Type.ime())
            v.setPadding(b.left, b.top, b.right, b.bottom)
            WindowInsets.CONSUMED
        }
        setContentView(racine)

        // configure() lit seulement le fichier privé (aucun appel au magasin de clés sur le fil principal).
        if (coffre.configure()) afficherPage() else afficherFormulaire()
    }

    // Activité visible (entre onStart et onStop).
    private var visible = false

    override fun onStart() {
        super.onStart()
        visible = true
        AttenteWifi.surFin = {
            pont.oublierMemoire() // fin du service : la configuration gardée pour l'attente est effacée
            if (!visible && !AttenteWifi.actif) { pont.fermerToutAsync(); wifi.arreter() }
        }
        wifi.demarrer()
        // Appli rouverte : plus aucun envoi en cours (une attente en arrière-plan garde sa page : pas de recréation).
        if (themeAChanger && !AttenteWifi.actif) { themeAChanger = false; recreate() }
    }

    // configChanges inclut uiMode (pas de recréation pendant un envoi). Pour que la page suive le thème clair ou sombre,
    // l'activité est recréée tout de suite si aucune connexion au câble n'est ouverte, sinon au prochain retour.
    private var themeAChanger = false
    // Mode clair/sombre connu de l'activité (resources.configuration est déjà la NOUVELLE configuration ici).
    private var nuit = -1
    override fun onConfigurationChanged(nouvelle: Configuration) {
        super.onConfigurationChanged(nouvelle)
        val maintenant = nouvelle.uiMode and Configuration.UI_MODE_NIGHT_MASK
        if (maintenant == nuit) return
        nuit = maintenant
        if (pont.connexionOuverte() || AttenteWifi.actif) themeAChanger = true else recreate()
    }

    // Sortie de l'activité (autre appli, écran éteint, retour) : plus aucune connexion ouverte. Seule exception : un
    // service d'attente tourne (« Programmer » en attente du Wi-Fi et du câble) ; le pont et le suivi du Wi-Fi restent
    // alors en place pour l'envoi différé de la page, et sont fermés à la destruction du service (AttenteWifi.surFin) ou
    // au prochain onStop. Pas de pauseTimers : les minuteurs de la page doivent continuer.
    override fun onStop() {
        visible = false
        if (!AttenteWifi.actif) {
            pont.fermerToutAsync()
            wifi.arreter()
        }
        super.onStop()
    }

    override fun onDestroy() {
        // Activité détruite pendant une attente (appli fermée, hors changement de configuration) : la page disparaît,
        // rien ne sera envoyé ; on le dit par la notification (règle 2) et le service s'arrête.
        // Toujours : la page est détruite avec l'activité, même pour un changement de configuration non couvert par
        // configChanges (police, langue) ; l'attente ne peut plus aboutir.
        if (AttenteWifi.actif) abandonnerAttente()
        demandeNotifications = null
        AttenteWifi.surFin = null
        // La mémoire de la clé n'est effacée que si aucune attente n'est active (le service l'efface à sa fin).
        pont.arreter(garderMemoire = AttenteWifi.attenteEnCours())
        webView?.let { (it.parent as? ViewGroup)?.removeView(it); it.destroy() }
        webView = null
        super.onDestroy()
    }

    // --- Attente en arrière-plan (« Programmer » avant le Wi-Fi ou le câble) : opérations du pont, version publiée ---
    // Contrat (site/pont.js) : notifications, demanderNotifications, attenteDebut {heure},
    // attenteEtat, attenteFin {resultat, heure?, incertain?}. Aucune chaîne libre de la page n'est affichée.

    private var demandeNotifications: ((JSONObject) -> Unit)? = null
    private var heureAttente: String? = null // heure de la dernière attente démarrée (texte « appli fermée »)

    private fun notificationsAutorisees(): Boolean =
        checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED &&
            getSystemService(NotificationManager::class.java).areNotificationsEnabled()

    private fun ok(): JSONObject = JSONObject().put("ok", true)
    private fun erreur(code: String): JSONObject = JSONObject().put("ok", false).put("erreur", code)

    // Appelé sur le fil principal (PontLocal.onPostMessage).
    private fun attente(op: String, q: JSONObject, repondre: (JSONObject) -> Unit) {
        when (op) {
            "notifications" -> repondre(ok().put("autorise", notificationsAutorisees()))
            "demanderNotifications" -> when {
                notificationsAutorisees() -> repondre(ok().put("autorise", true))
                demandeNotifications != null -> repondre(erreur("occupe"))
                // Permission accordée mais notifications coupées dans les réglages : aucune demande système possible.
                checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED ->
                    repondre(ok().put("autorise", false))
                // Refus définitif : le système répond aussitôt par onRequestPermissionsResult, sans rien afficher.
                else -> {
                    demandeNotifications = repondre
                    requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), CODE_NOTIFICATIONS)
                }
            }
            "attenteDebut" -> {
                val h = q.optString("heure", "")
                when {
                    !Attente.heureValide(h) -> repondre(erreur("requete_invalide"))
                    !notificationsAutorisees() -> repondre(erreur("notifications"))
                    AttenteWifi.actif -> repondre(erreur("occupe"))
                    else -> repondre(demarrerAttente(h))
                }
            }
            "attenteEtat" -> repondre(ok().put("active", AttenteWifi.actif).put("annulee", AttenteWifi.annulee))
            "attenteFin" -> {
                // Heure facultative : absente si la page n'a pas pu la calculer (texte sans heure).
                val h = Attente.heureRecue(if (q.has("heure")) q.optString("heure", "") else null)
                val issue = Attente.issue(q.optString("resultat", ""), q.optBoolean("incertain", false))
                if (h == Attente.INVALIDE || issue == null) {
                    repondre(erreur("requete_invalide"))
                    return
                }
                val service = AttenteWifi.instance
                when {
                    service != null -> service.terminer(issue, h)
                    AttenteWifi.actif -> AttenteWifi.finDemandee = issue to h // service pas encore démarré : il s'arrêtera aussitôt
                    else -> AttenteWifi.publierResultat(this, issue, h) // service déjà arrêté (filet passé) : on corrige
                }
                repondre(ok())
            }
            else -> repondre(erreur("operation_inconnue"))
        }
    }

    // La page est visible (geste « Programmer ») : démarrage d'un service de premier plan permis.
    private fun demarrerAttente(heure: String): JSONObject {
        AttenteWifi.actif = true // avant onStop, qui peut arriver avant le démarrage effectif du service
        AttenteWifi.annulee = false
        AttenteWifi.finDemandee = null
        heureAttente = heure
        return try {
            startForegroundService(Intent(this, AttenteWifi::class.java).setAction(AttenteWifi.ACTION_DEBUT).putExtra(AttenteWifi.EXTRA_HEURE, heure))
            ok()
        } catch (e: Exception) { // ForegroundServiceStartNotAllowedException, SecurityException…
            AttenteWifi.actif = false
            erreur("service")
        }
    }

    private fun abandonnerAttente() {
        val service = AttenteWifi.instance
        // Un résultat déjà publié (attenteFin reçu, service en cours d'arrêt) n'est jamais écrasé par « non envoyée ».
        if (service != null) { if (service.attendEncore) service.terminer(Attente.Issue.APPLI_FERMEE) }
        else if (AttenteWifi.finDemandee == null) AttenteWifi.finDemandee = Attente.Issue.APPLI_FERMEE to heureAttente
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode != CODE_NOTIFICATIONS) return
        val r = demandeNotifications ?: return
        demandeNotifications = null
        r(ok().put("autorise", notificationsAutorisees()))
    }

    // --- Essai E0 : attente en arrière-plan (version de mise au point seulement, filtrée aussi par le pont) ---

    // « debut » : démarre le service de premier plan (la page est visible : démarrage permis). « fin » : l'arrête et, si
    // l'activité n'est plus visible, fait la fermeture que onStop a sautée. Toujours : état de l'écran pour la ligne ESSAI.
    private fun essaiArrierePlan(quoi: String): JSONObject {
        val r = JSONObject().put("ok", true)
        if (!estDebug) return JSONObject().put("ok", false).put("erreur", "operation_inconnue")
        val intention = Intent(this, AttenteWifi::class.java)
        when (quoi) {
            "debut" -> {
                // Même service que la version publiée ; heure de l'action adb pour le texte de la notification.
                val h = intent?.getStringExtra("heure")?.takeIf { Attente.heureValide(it) } ?: "00:00"
                if (!demarrerAttente(h).optBoolean("ok")) r.put("ok", false).put("erreur", "service")
            }
            "fin" -> {
                stopService(intention)
                AttenteWifi.actif = false
                if (!visible) { pont.fermerToutAsync(); wifi.arreter() }
            }
            "etat" -> {}
            else -> return JSONObject().put("ok", false).put("erreur", "requete_invalide")
        }
        r.put("interactif", getSystemService(PowerManager::class.java).isInteractive)
        r.put("verrouille", getSystemService(KeyguardManager::class.java).isDeviceLocked)
        r.put("service", AttenteWifi.actif)
        return r
    }

    // --- Écran natif de saisie ---

    private fun afficherFormulaire() {
        val vue = formulaire ?: LayoutInflater.from(this).inflate(R.layout.formulaire, racine, false).also {
            formulaire = it
            brancherFormulaire(it)
        }
        racine.removeAllViews()
        racine.addView(vue)
        // Écran de la clé : exclu des captures et de la recopie d'écran en version publiée ; retiré en mise au point pour les captures.
        if (!estDebug) window.setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE)
        val configure = coffre.configure()
        vue.findViewById<Button>(R.id.bouton_retour).visibility = if (configure) View.VISIBLE else View.GONE
        vue.findViewById<Button>(R.id.bouton_oublier).visibility = if (configure) View.VISIBLE else View.GONE
    }

    private fun brancherFormulaire(vue: View) {
        val champId = vue.findViewById<EditText>(R.id.champ_id)
        val champCle = vue.findViewById<EditText>(R.id.champ_cle)
        val compteur = vue.findViewById<TextView>(R.id.compteur_cle)
        val afficher = vue.findViewById<Button>(R.id.afficher_cle)
        val erreur = vue.findViewById<TextView>(R.id.texte_erreur)
        val enregistrer = vue.findViewById<Button>(R.id.bouton_enregistrer)
        val aide = vue.findViewById<TextView>(R.id.aide_enregistrer)

        fun majEtat() {
            val n = champCle.text.length
            compteur.text = if (n == 16) getString(R.string.compteur_cle_ok) else getString(R.string.compteur_cle, n)
            val pret = champId.text.isNotBlank() && n == 16
            enregistrer.isEnabled = pret
            enregistrer.alpha = if (pret) 1f else 0.5f
            aide.visibility = if (pret) View.GONE else View.VISIBLE // dit pourquoi « Enregistrer » est grisé
        }
        val surveillant = object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
            override fun onTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
            override fun afterTextChanged(s: Editable?) { erreur.text = ""; majEtat() }
        }
        champId.addTextChangedListener(surveillant)
        champCle.addTextChangedListener(surveillant)
        majEtat()

        // « Coller » : texte du presse-papiers débarrassé des espaces et sauts de ligne (erreur classique du copier-coller).
        fun coller(champ: EditText, max: Int) {
            val texte = getSystemService(ClipboardManager::class.java).primaryClip
                ?.takeIf { it.itemCount > 0 }?.getItemAt(0)?.coerceToText(this)?.toString()
                ?.filterNot { it.isWhitespace() }?.take(max)
            if (texte.isNullOrEmpty()) erreur.setText(R.string.presse_papiers_vide)
            else {
                champ.setText(texte); champ.setSelection(texte.length)
                // La clé ne reste pas dans le presse-papiers (d'autres applis pourraient la lire).
                if (champ === champCle) try { getSystemService(ClipboardManager::class.java).clearPrimaryClip() } catch (e: Exception) { }
            }
        }
        vue.findViewById<Button>(R.id.coller_id).setOnClickListener { coller(champId, 64) }
        vue.findViewById<Button>(R.id.coller_cle).setOnClickListener { coller(champCle, 16) }

        var cleVisible = false
        afficher.setOnClickListener {
            cleVisible = !cleVisible
            champCle.inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS or
                (if (cleVisible) InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD else InputType.TYPE_TEXT_VARIATION_PASSWORD)
            champCle.setSelection(champCle.text.length)
            afficher.setText(if (cleVisible) R.string.masquer else R.string.afficher)
        }

        fun viderChamps() {
            champId.setText("")
            champCle.setText("") // la clé ne reste pas dans les champs de l'écran
            erreur.text = ""
        }

        enregistrer.setOnClickListener {
            val id = champId.text.toString().trim()
            val cle = champCle.text.toString()
            when {
                !Saisie.identifiantValide(id) -> erreur.setText(R.string.erreur_identifiant)
                !Saisie.cleValide(cle) -> erreur.setText(R.string.erreur_cle)
                else -> {
                    enregistrer.isEnabled = false
                    enregistrer.setText(R.string.enregistrement)
                    // Aucune proposition « Enregistrer le mot de passe ? » : la clé n'irait pas dans un gestionnaire en ligne.
                    try { getSystemService(AutofillManager::class.java)?.cancel() } catch (e: Exception) { }
                    masquerClavier(vue)
                    // Magasin de clés hors du fil principal.
                    Thread {
                        val reussi = try { coffre.enregistrer(id, cle); true } catch (e: Exception) { false }
                        if (reussi) pont.oublierMemoire() // une nouvelle clé : l'ancienne copie gardée pour l'attente est périmée
                        runOnUiThread {
                            enregistrer.setText(R.string.enregistrer)
                            if (reussi) { viderChamps(); majEtat(); afficherPage(nouvelleConfiguration = true) }
                            else { erreur.setText(R.string.erreur_enregistrement); majEtat() }
                        }
                    }.start()
                }
            }
        }
        vue.findViewById<Button>(R.id.bouton_retour).setOnClickListener {
            viderChamps()
            masquerClavier(vue)
            if (coffre.configure()) afficherPage()
        }
        vue.findViewById<Button>(R.id.bouton_oublier).setOnClickListener {
            AlertDialog.Builder(this)
                .setTitle(R.string.oublier_titre)
                .setMessage(R.string.oublier_texte)
                .setNegativeButton(R.string.annuler, null)
                .setPositiveButton(R.string.oublier_confirmer) { _, _ ->
                    Thread {
                        coffre.oublier()
                        pont.oublierMemoire() // « Oublier le câble » efface aussi la copie gardée en mémoire
                        runOnUiThread { viderChamps(); afficherFormulaire() }
                    }.start()
                }
                .show()
        }
    }

    private fun masquerClavier(vue: View) {
        getSystemService(InputMethodManager::class.java).hideSoftInputFromWindow(vue.windowToken, 0)
    }

    // --- Page d'essai ---

    // nouvelleConfiguration : la page est rechargée pour relire le câble avec les codes qu'on vient d'enregistrer.
    private fun afficherPage(nouvelleConfiguration: Boolean = false) {
        window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
        val w = webView ?: creerWebView().also { webView = it }
        racine.removeAllViews()
        racine.addView(w, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        if (!pageChargee) {
            pageChargee = true
            w.loadUrl(urlPage())
        } else if (nouvelleConfiguration) {
            w.reload()
        }
    }

    private fun creerWebView(): WebView {
        WebView.setWebContentsDebuggingEnabled(estDebug)
        // Service worker : aucune requête ne doit échapper au filtre de shouldInterceptRequest. La page n'en enregistre
        // pas dans l'appli (sw-register.js) ; s'il y en avait un, toutes ses requêtes recevraient 403.
        if (WebViewFeature.isFeatureSupported(WebViewFeature.SERVICE_WORKER_BASIC_USAGE) &&
            WebViewFeature.isFeatureSupported(WebViewFeature.SERVICE_WORKER_SHOULD_INTERCEPT_REQUEST)) {
            ServiceWorkerControllerCompat.getInstance().setServiceWorkerClient(object : ServiceWorkerClientCompat() {
                override fun shouldInterceptRequest(request: WebResourceRequest): WebResourceResponse = GestionnaireAssets.interdit()
            })
        }
        val chargeur = WebViewAssetLoader.Builder()
            .setDomain(FiltreReseau.HOTE_ORIGINE)
            .addPathHandler("/assets/", GestionnaireAssets(assets, publication = !estDebug))
            .build()
        val w = WebView(this)
        with(w.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true // réglages de la page (site/) ; jamais la clé, qui reste dans le coffre natif
            allowFileAccess = false
            allowContentAccess = false
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            setGeolocationEnabled(false)
            setSupportZoom(false)
        }
        w.webViewClient = object : WebViewClient() {
            // Seule l'origine de l'application est chargée ; tout le reste reçoit 403, sans aucun accès réseau.
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
                val u = request.url
                if (u.scheme != "https" || u.host != FiltreReseau.HOTE_ORIGINE || request.method != "GET") return GestionnaireAssets.interdit()
                return chargeur.shouldInterceptRequest(u) ?: GestionnaireAssets.introuvable()
            }

            // Navigation hors de l'origine : refusée, rien ne s'ouvre (ni ici ni dans un navigateur).
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val u = request.url
                return !(u.scheme == "https" && u.host == FiltreReseau.HOTE_ORIGINE)
            }

            // Processus de rendu perdu : on reconstruit l'activité plutôt que de planter.
            override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
                // Page perdue pendant une attente : elle n'enverra rien, on le dit (règle 2) avant de reconstruire.
                if (AttenteWifi.actif) abandonnerAttente()
                runOnUiThread { recreate() }
                return true
            }
        }
        w.webChromeClient = object : WebChromeClient() {
            // Version de mise au point : seules les lignes « ESSAI … » vont dans logcat (étiquette fixe). Publiée : rien.
            override fun onConsoleMessage(m: ConsoleMessage): Boolean {
                if (estDebug) {
                    val t = m.message()
                    if (t.startsWith("ESSAI ") && t.length <= 600) Log.i(TAG_LOG, t)
                }
                return true
            }
        }
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            WebViewCompat.addWebMessageListener(w, PontLocal.NOM_JS, setOf(FiltreReseau.ORIGINE), pont)
        }
        return w
    }

    // Page d'essai seulement en mise au point avec une action adb ; sinon la vraie page.
    private fun urlPage(): String =
        if (estDebug && intent?.getStringExtra("action") in ACTIONS_AUTO) URL_ESSAI else URL_SITE

    // Action demandée par adb (version de mise au point seulement), rendue une seule fois à la page :
    //   am start -n ... --es action lire|chercher|programmer|filtre|cle|arriere-plan [--es ip 10.0.2.2] [--es heure 05:00]
    //                   [--es delai 20]   (arriere-plan : attente en secondes avant l'envoi, 900 au plus)
    private fun actionAuto(): JSONObject? {
        if (!estDebug || actionAutoPrise) return null
        val action = intent?.getStringExtra("action") ?: return null
        if (action !in ACTIONS_AUTO) return null
        actionAutoPrise = true
        val j = JSONObject().put("action", action)
        intent.getStringExtra("ip")?.let { if (it.length <= 15) j.put("ip", it) }
        intent.getStringExtra("heure")?.let { if (it.length == 5) j.put("heure", it) }
        intent.getStringExtra("delai")?.toIntOrNull()?.let { if (it in 0..900) j.put("delai", it) }
        return j
    }

    companion object {
        const val TAG_LOG = "RechargeEssai"
        const val URL_SITE = "${FiltreReseau.ORIGINE}/assets/site/index.html"
        const val URL_ESSAI = "${FiltreReseau.ORIGINE}/assets/android/essai/index.html"
        private const val CODE_NOTIFICATIONS = 1
        private val ACTIONS_AUTO = setOf("lire", "chercher", "programmer", "filtre", "cle", "arriere-plan")

        @Volatile
        private var actionAutoPrise = false
    }
}
