package fr.rechargeds3.coque

import java.util.concurrent.atomic.AtomicInteger

/**
 * Identifiants des démarrages d'un service (startId de onStartCommand). Un arrêt demandé par une fin d'attente doit viser le DERNIER
 * démarrage connu : `stopSelf(id)` n'arrête le service que si aucun démarrage plus récent n'est arrivé entre-temps (nouvelle attente
 * lancée pendant qu'une fin tardive s'achève). Kotlin pur, testé en JUnit.
 */
class SuiviDemarrages {
    private val dernier = AtomicInteger(0)

    fun enregistrer(startId: Int) {
        dernier.accumulateAndGet(startId) { a, b -> maxOf(a, b) }
    }

    /** Identifiant à donner à stopSelf. */
    fun pourArret(): Int = dernier.get()

    enum class Suite { ARRETER, RELANCER }

    companion object {
        /**
         * Que faire à la fin d'une attente, sur le fil principal : si le pilote est déjà reparti en attente (nouveau « Programmer » passé
         * avant ce post, dont onStartCommand a vu une boucle encore vivante), il faut relancer la boucle, jamais arrêter le service.
         */
        fun suiteApresFin(phase: Phase): Suite = if (phase == Phase.ATTENTE) Suite.RELANCER else Suite.ARRETER
    }
}
