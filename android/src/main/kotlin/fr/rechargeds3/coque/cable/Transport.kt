package fr.rechargeds3.coque.cable

/**
 * Transport fourni par l'appelant (socket TCP vers le câble, ou faux câble en test). Kotlin pur, sans `android.*`.
 *
 * Contrat (identique à celui de local/tuya-local.js) :
 *  - [ouvrir] : connexion TCP vers [ip] sur [port] ; échec = [TransportException] "hors_ligne" ;
 *  - [envoyer] : écrit tous les octets ;
 *  - [recevoir] : rend les octets disponibles (au moins un) ; [TransportException] "delai" si rien n'arrive dans
 *    [delaiMs], "ferme" si la connexion est fermée ; un tableau vide est aussi lu comme « fermée » ;
 *  - [fermer] : idempotent, peut être appelé depuis un AUTRE fil que celui qui est bloqué dans [recevoir] ou
 *    [envoyer] : il doit alors débloquer ce fil (c'est ainsi que l'échéance globale de 20 s est tenue).
 *
 * Toute autre exception levée par le transport est traitée comme "hors_ligne". Le transport ne doit jamais mettre
 * de clé dans un message d'exception ni dans un journal.
 */
interface Transport {
    fun ouvrir(ip: String, port: Int, delaiMs: Int)
    fun envoyer(octets: ByteArray)
    fun recevoir(delaiMs: Int): ByteArray
    fun fermer()
}

/** Échec du transport, [code] valant "hors_ligne", "delai" ou "ferme" (le message est le code, rien d'autre). */
class TransportException(val code: String) : Exception(code)
