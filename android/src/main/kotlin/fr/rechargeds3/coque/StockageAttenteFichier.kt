package fr.rechargeds3.coque

import java.io.File

/**
 * Fichier privé de l'attente (dossier interne de l'application, exclu de la sauvegarde et du transfert : voir
 * regles_extraction.xml). Il ne contient AUCUN secret : phase, heures, résultat brut. Écriture par fichier temporaire puis
 * renommage, pour qu'un processus tué en pleine écriture ne laisse pas un fichier tronqué.
 */
class StockageAttenteFichier(private val fichier: File) : StockageAttente {
    override fun lire(): String? = try {
        if (fichier.exists()) fichier.readText(Charsets.UTF_8) else null
    } catch (e: Exception) {
        null
    }

    override fun ecrire(contenu: String?) {
        if (contenu == null) { fichier.delete(); return }
        val tmp = File(fichier.path + ".tmp")
        tmp.writeText(contenu, Charsets.UTF_8)
        if (!tmp.renameTo(fichier)) { fichier.delete(); check(tmp.renameTo(fichier)) { "écriture impossible" } }
    }
}
