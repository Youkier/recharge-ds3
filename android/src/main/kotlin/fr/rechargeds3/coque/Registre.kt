package fr.rechargeds3.coque

import java.io.Closeable

/**
 * Registre de la connexion de données du pont : une seule à la fois, un identifiant par connexion, jamais réutilisé.
 * Sans dépendance Android (testé en JUnit local : RegistreTest).
 *
 * Revue de sécurité du 2026-11-18 : un `fermer` tardif d'une ancienne connexion ne doit pas couper l'appel suivant ;
 * les opérations sur un identifiant périmé sont refusées ; `fermer(id)` est idempotent.
 */
class Registre<T : Closeable> {
    private var compteur = 0
    private var occupe = false
    private var idCourant = 0
    private var ressource: T? = null

    /** Réserve l'emplacement et rend un nouvel identifiant, ou null si une connexion est déjà ouverte ou en cours d'ouverture. */
    @Synchronized
    fun reserver(): Int? {
        if (occupe) return null
        occupe = true
        compteur += 1
        idCourant = compteur
        ressource = null
        return idCourant
    }

    /** Installe la ressource ouverte pour [id]. Si l'identifiant est périmé (fermé entre-temps), la ressource est fermée et false est rendu. */
    fun installer(id: Int, r: T): Boolean {
        val garder = synchronized(this) {
            if (occupe && id == idCourant && ressource == null) { ressource = r; true } else false
        }
        if (!garder) fermerSansErreur(r)
        return garder
    }

    /** Libère la réservation de [id] après un échec d'ouverture. */
    @Synchronized
    fun liberer(id: Int) {
        if (occupe && id == idCourant && ressource == null) occupe = false
    }

    @Synchronized
    fun obtenir(id: Int): T? = if (occupe && id == idCourant) ressource else null

    /** Idempotent : un identifiant inconnu, périmé ou déjà fermé ne fait rien et ne touche pas la connexion courante. */
    fun fermer(id: Int): Boolean {
        val r = synchronized(this) {
            if (occupe && id == idCourant) { val x = ressource; ressource = null; occupe = false; x ?: return true } else return false
        }
        fermerSansErreur(r)
        return true
    }

    /** Ferme la connexion courante, quelle qu'elle soit (sortie de l'activité, nouvelle page). */
    fun fermerTout() {
        val r = synchronized(this) { val x = ressource; ressource = null; occupe = false; x }
        if (r != null) fermerSansErreur(r)
    }

    @Synchronized
    fun ouverte(): Boolean = occupe

    private fun fermerSansErreur(r: Closeable) { try { r.close() } catch (e: Exception) { /* déjà fermée */ } }
}
