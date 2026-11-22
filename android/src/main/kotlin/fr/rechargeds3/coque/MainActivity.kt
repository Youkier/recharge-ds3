package fr.rechargeds3.coque

import android.Manifest
import android.app.Activity
import android.app.AlertDialog
import android.app.NotificationManager
import android.content.ClipboardManager
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.os.Bundle
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
    private lateinit var pilote: PiloteAttente
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
        pilote = proprietaire.pilote
        pont = PontLocal(
            wifi, proprietaire.operations, pilote, estDebug,
            surSaisirCle = { afficherFormulaire() },
            prendreActionAuto = { actionAuto() },
            notifications = { op, rep -> notifications(op, rep) },
            lancerService = { AttenteWifi.lancer(this) },
            surResultatVu = { AttenteWifi.retirerResultat(this) },
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
        AttenteWifi.activiteVisible = true // la page montre elle-même le résultat d'une attente
        wifi.demarrer() // suivi compté : le service d'attente a le sien
        // Appli rouverte : plus aucun envoi de la page en cours.
        if (themeAChanger && !pont.connexionOuverte()) { themeAChanger = false; recreate() }
    }

    // Appli rouverte par une notification (activité unique, singleTask) : la page est déjà là, elle relit l'attente à la reprise.
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
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
        if (pont.connexionOuverte()) themeAChanger = true else recreate()
    }

    // Sortie de l'activité (autre appli, écran éteint, retour) : les connexions ouvertes PAR LA PAGE sont coupées. Une attente en
    // cours appartient au service (PiloteAttente) : elle continue, avec son propre suivi du Wi-Fi.
    override fun onStop() {
        visible = false
        AttenteWifi.activiteVisible = false
        pont.fermerToutAsync()
        wifi.arreter()
        super.onStop()
    }

    override fun onDestroy() {
        // Balayer l'appli ou détruire l'activité n'annule plus l'attente (décision du 2026-11-21) : le service l'a en main, et
        // la page, rechargée, relira son état.
        demandeNotifications = null
        pont.arreter()
        webView?.let { (it.parent as? ViewGroup)?.removeView(it); it.destroy() }
        webView = null
        super.onDestroy()
    }

    // --- Permission de notification (l'attente elle-même est tenue par le service, voir PiloteAttente) ---
    // Contrat (site/pont.js) : notifications -> { autorise }, demanderNotifications -> { autorise }. Sans notifications, l'attente
    // fonctionne quand même : le résultat est montré à la réouverture de l'appli.

    private var demandeNotifications: ((JSONObject) -> Unit)? = null

    private fun notificationsAutorisees(): Boolean =
        checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED &&
            getSystemService(NotificationManager::class.java).areNotificationsEnabled()

    private fun ok(): JSONObject = JSONObject().put("ok", true)
    private fun erreur(code: String): JSONObject = JSONObject().put("ok", false).put("erreur", code)

    // Appelé sur le fil principal (PontLocal.onPostMessage).
    private fun notifications(op: String, repondre: (JSONObject) -> Unit) {
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
            else -> repondre(erreur("operation_inconnue"))
        }
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode != CODE_NOTIFICATIONS) return
        val r = demandeNotifications ?: return
        demandeNotifications = null
        r(ok().put("autorise", notificationsAutorisees()))
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
                        if (reussi) pilote.arreterPourCle() // une nouvelle clé : l'attente en cours s'arrête, l'ancienne copie gardée est effacée
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
                        pilote.arreterPourCle() // « Oublier le câble » arrête l'attente en cours et efface la copie gardée en mémoire
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
                // Page perdue : l'attente éventuelle continue dans le service, la page reconstruite relira son état.
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
    //   am start -n ... --es action lire|chercher|programmer|filtre|cle [--es ip 10.0.2.2] [--es heure 05:00] [--es delai 20]
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
        private val ACTIONS_AUTO = setOf("lire", "chercher", "programmer", "filtre", "cle")

        @Volatile
        private var actionAutoPrise = false
    }
}
