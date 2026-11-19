package fr.rechargeds3.coque

/**
 * Règles de service des fichiers embarqués (sans dépendance Android, testé en JUnit local : FiltreAssetsTest).
 * Seuls les fichiers web connus sont servis, par type MIME fixé d'après l'extension (même liste que
 * tools/assets-apk.mjs), jamais par déduction du système ; sw.js n'est jamais servi (404).
 */
object FiltreAssets {
    private val MIME = mapOf(
        "html" to "text/html",
        "js" to "text/javascript",
        "mjs" to "text/javascript",
        "css" to "text/css",
        "json" to "application/json",
        "webmanifest" to "application/manifest+json",
        "txt" to "text/plain",
        "svg" to "image/svg+xml",
        "png" to "image/png",
        "ico" to "image/x-icon",
    )
    private val TEXTE = setOf("html", "js", "mjs", "css", "json", "webmanifest", "txt", "svg")
    private val CHEMIN = Regex("^[A-Za-z0-9._/-]{1,200}$")

    /** Chemin relatif à assets/ (ex. « android/essai/index.html »). Pas de « .. », de « // », de « / » initial ni de fichier caché. */
    fun cheminValide(chemin: String): Boolean {
        if (!CHEMIN.matches(chemin)) return false
        if (chemin.startsWith("/") || chemin.contains("//") || chemin.endsWith("/")) return false
        return chemin.split('/').none { it.isEmpty() || it.startsWith(".") }
    }

    fun extension(chemin: String): String? {
        val nom = chemin.substringAfterLast('/')
        val point = nom.lastIndexOf('.')
        return if (point <= 0 || point == nom.length - 1) null else nom.substring(point + 1).lowercase()
    }

    /** Type MIME du fichier, ou null s'il ne doit pas être servi (chemin invalide, extension inconnue, sw.js). */
    fun typeMime(chemin: String): String? {
        if (!cheminValide(chemin)) return null
        if (chemin.substringAfterLast('/') == "sw.js") return null
        return extension(chemin)?.let { MIME[it] }
    }

    fun estTexte(chemin: String): Boolean = extension(chemin) in TEXTE
}
