package fr.rechargeds3.coque

import android.app.Activity
import android.content.pm.ApplicationInfo
import android.os.Bundle
import android.util.Log
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.view.WindowInsets
import android.view.WindowManager
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
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONObject

/**
 * Une seule activité : l'écran natif de saisie de l'identifiant et de la clé du câble, puis la WebView qui affiche la page
 * d'essai embarquée (android/essai/). Thème plateforme DeviceDefault.DayNight (pas d'AppCompat) : prefers-color-scheme
 * de la page suit le thème clair ou sombre du téléphone.
 */
class MainActivity : Activity() {

    private val estDebug: Boolean get() = (applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0

    private lateinit var racine: FrameLayout
    private lateinit var wifi: ReseauWifi
    private lateinit var pont: PontLocal
    private var formulaire: View? = null
    private var webView: WebView? = null
    private var pageChargee = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        wifi = ReseauWifi(this)
        pont = PontLocal(wifi, estDebug, surSaisirCle = { afficherFormulaire() }, prendreActionAuto = { actionAuto() })

        racine = FrameLayout(this)
        // Ciblage SDK 36 : l'affichage va sous les barres système ; on réserve leur place (et celle du clavier).
        racine.setOnApplyWindowInsetsListener { v, insets ->
            val b = insets.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.displayCutout() or WindowInsets.Type.ime())
            v.setPadding(b.left, b.top, b.right, b.bottom)
            WindowInsets.CONSUMED
        }
        setContentView(racine)

        if (CableConfig.configure()) afficherPage() else afficherFormulaire()
    }

    override fun onStart() {
        super.onStart()
        wifi.demarrer()
    }

    // Sortie de l'activité (autre appli, écran éteint, retour) : plus aucune connexion ouverte.
    override fun onStop() {
        pont.fermerToutAsync()
        wifi.arreter()
        super.onStop()
    }

    override fun onDestroy() {
        pont.arreter()
        webView?.let { (it.parent as? ViewGroup)?.removeView(it); it.destroy() }
        webView = null
        super.onDestroy()
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
        vue.findViewById<Button>(R.id.bouton_retour).visibility = if (CableConfig.configure()) View.VISIBLE else View.GONE
    }

    private fun brancherFormulaire(vue: View) {
        val champId = vue.findViewById<EditText>(R.id.champ_id)
        val champCle = vue.findViewById<EditText>(R.id.champ_cle)
        val erreur = vue.findViewById<TextView>(R.id.texte_erreur)
        vue.findViewById<Button>(R.id.bouton_enregistrer).setOnClickListener {
            val id = champId.text.toString().trim()
            val cle = champCle.text.toString()
            when {
                !Saisie.identifiantValide(id) -> erreur.setText(R.string.erreur_identifiant)
                !Saisie.cleValide(cle) -> erreur.setText(R.string.erreur_cle)
                else -> {
                    CableConfig.definir(id, cle)
                    champId.setText("")
                    champCle.setText("") // la clé ne reste pas dans les champs de l'écran
                    erreur.text = ""
                    masquerClavier(vue)
                    afficherPage()
                }
            }
        }
        vue.findViewById<Button>(R.id.bouton_retour).setOnClickListener {
            champId.setText("")
            champCle.setText("")
            erreur.text = ""
            masquerClavier(vue)
            if (CableConfig.configure()) afficherPage()
        }
    }

    private fun masquerClavier(vue: View) {
        getSystemService(InputMethodManager::class.java).hideSoftInputFromWindow(vue.windowToken, 0)
    }

    // --- Page d'essai ---

    private fun afficherPage() {
        window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
        val w = webView ?: creerWebView().also { webView = it }
        racine.removeAllViews()
        racine.addView(w, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        if (!pageChargee) {
            pageChargee = true
            w.loadUrl(URL_ESSAI)
        }
    }

    private fun creerWebView(): WebView {
        WebView.setWebContentsDebuggingEnabled(estDebug)
        val chargeur = WebViewAssetLoader.Builder()
            .setDomain(FiltreReseau.HOTE_ORIGINE)
            .addPathHandler("/assets/", GestionnaireAssets(assets))
            .build()
        val w = WebView(this)
        with(w.settings) {
            javaScriptEnabled = true
            domStorageEnabled = false // la page d'essai n'en a pas besoin ; le lot C4 l'activera pour site/
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

    // Action demandée par adb (version de mise au point seulement), rendue une seule fois à la page :
    //   am start -n ... --es action lire|chercher|programmer|filtre [--es ip 10.0.2.2] [--es heure 05:00]
    private fun actionAuto(): JSONObject? {
        if (!estDebug || actionAutoPrise) return null
        val action = intent?.getStringExtra("action") ?: return null
        if (action !in ACTIONS_AUTO) return null
        actionAutoPrise = true
        val j = JSONObject().put("action", action)
        intent.getStringExtra("ip")?.let { if (it.length <= 15) j.put("ip", it) }
        intent.getStringExtra("heure")?.let { if (it.length == 5) j.put("heure", it) }
        return j
    }

    companion object {
        const val TAG_LOG = "RechargeEssai"
        const val URL_ESSAI = "${FiltreReseau.ORIGINE}/assets/android/essai/index.html"
        private val ACTIONS_AUTO = setOf("lire", "chercher", "programmer", "filtre")

        @Volatile
        private var actionAutoPrise = false
    }
}
