package fr.rechargeds3.coque

import android.content.res.AssetManager
import android.webkit.WebResourceResponse
import androidx.webkit.WebViewAssetLoader
import java.io.ByteArrayInputStream
import java.io.IOException

/**
 * Sert les fichiers de assets/ sous https://appassets.androidplatform.net/assets/…
 * Écrit à la place d'AssetsPathHandler pour fixer le type MIME par extension (les modules ES exigent un type JavaScript),
 * refuser sw.js, les chemins étranges et les extensions inconnues, et ajouter des en-têtes de sécurité.
 * Sources : developer.android.com, WebViewAssetLoader.PathHandler (handle(path) : suffixe après « /assets/ », null =
 * « non géré » donc repli sur le réseau, d'où la réponse 404 explicite), WebResourceResponse.
 */
class GestionnaireAssets(private val assets: AssetManager, private val publication: Boolean = false) : WebViewAssetLoader.PathHandler {

    override fun handle(path: String): WebResourceResponse? {
        if (publication && !FiltreAssets.serviEnPublication(path)) return introuvable()
        val mime = FiltreAssets.typeMime(path) ?: return introuvable()
        val flux = try { assets.open(path, AssetManager.ACCESS_STREAMING) } catch (e: IOException) { return introuvable() }
        val entetes = HashMap<String, String>()
        entetes["Cache-Control"] = "no-store"
        entetes["X-Content-Type-Options"] = "nosniff"
        if (mime == "text/html") entetes["Content-Security-Policy"] = CSP_PAGE
        return WebResourceResponse(mime, if (FiltreAssets.estTexte(path)) "utf-8" else null, 200, "OK", entetes, flux)
    }

    companion object {
        // En-tête en plus de la balise <meta> des pages : l'intersection des deux s'applique.
        const val CSP_PAGE = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"

        fun reponse(code: Int, texte: String): WebResourceResponse =
            WebResourceResponse("text/plain", "utf-8", code, texte, mapOf("Cache-Control" to "no-store"), ByteArrayInputStream(ByteArray(0)))

        fun introuvable(): WebResourceResponse = reponse(404, "Not Found")
        fun interdit(): WebResourceResponse = reponse(403, "Forbidden")
    }
}
