package fr.rechargeds3.coque

import fr.rechargeds3.coque.cable.Transport
import fr.rechargeds3.coque.cable.TransportException
import java.io.IOException
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.Socket
import java.net.SocketTimeoutException

/**
 * Transport TCP du protocole local (règle n°9 de CLAUDE.md) : le SEUL code de l'appli qui ouvre une connexion vers le
 * câble. Il refuse tout sauf une adresse IPv4 privée en notation décimale stricte (FiltreReseau.adressePrivee, aucune
 * résolution de nom) et le port 6668 ; une connexion par instance, jamais réutilisée ; messages de 2 Ko au plus.
 *
 * [lier] attache la socket au réseau Wi-Fi (Network.bindSocket) avant la connexion : jamais par les données mobiles.
 * Il est fourni par l'appelant pour que ce fichier reste testable sans Android. Aucune clé ni donnée dans les messages
 * d'exception ni dans un journal.
 */
class TransportTcp private constructor(
    private val lier: (Socket) -> Unit,
    private val adresse: (String) -> ByteArray?,
) : Transport {

    constructor(lier: (Socket) -> Unit) : this(lier, { ip -> FiltreReseau.adressePrivee(ip) })

    private val verrou = Any()
    private var socket: Socket? = null
    private var utilise = false
    @Volatile private var ferme = false

    override fun ouvrir(ip: String, port: Int, delaiMs: Int) {
        val octets = adresse(ip)
        if (octets == null || !FiltreReseau.portAutorise(port)) throw TransportException("hors_ligne")
        val s = Socket()
        synchronized(verrou) {
            if (utilise || ferme) { fermerSansErreur(s); throw TransportException(if (ferme) "ferme" else "hors_ligne") }
            utilise = true
            socket = s // fermer() depuis un autre fil débloque la connexion en cours
        }
        try {
            lier(s)
            s.tcpNoDelay = true
            s.connect(InetSocketAddress(InetAddress.getByAddress(octets), FiltreReseau.PORT), delaiMs.coerceIn(200, 5000))
        } catch (e: IOException) {
            fermerSansErreur(s)
            throw TransportException(if (ferme) "ferme" else "hors_ligne")
        } catch (e: RuntimeException) { // lier() : réseau perdu
            fermerSansErreur(s)
            throw TransportException("hors_ligne")
        }
        if (ferme) { fermerSansErreur(s); throw TransportException("ferme") }
    }

    override fun envoyer(octets: ByteArray) {
        val s = socket ?: throw TransportException("ferme")
        if (octets.isEmpty() || !FiltreReseau.tailleAutorisee(octets.size)) throw TransportException("ferme")
        try {
            s.getOutputStream().apply { write(octets); flush() }
        } catch (e: IOException) {
            throw TransportException("ferme")
        }
    }

    override fun recevoir(delaiMs: Int): ByteArray {
        val s = socket ?: throw TransportException("ferme")
        try {
            s.soTimeout = delaiMs.coerceIn(50, 10_000)
            val tampon = ByteArray(FiltreReseau.TAILLE_MAX)
            val n = s.getInputStream().read(tampon)
            if (n < 0) throw TransportException("ferme")
            return tampon.copyOf(n)
        } catch (e: SocketTimeoutException) {
            throw TransportException("delai")
        } catch (e: IOException) {
            throw TransportException("ferme") // aussi quand fermer() coupe la lecture en cours
        }
    }

    override fun fermer() {
        val s = synchronized(verrou) { ferme = true; val x = socket; socket = null; x }
        if (s != null) fermerSansErreur(s)
    }

    private fun fermerSansErreur(s: Socket) { try { s.close() } catch (e: IOException) { /* déjà fermée */ } }

    companion object {
        /** Tests seulement : filtre d'adresse remplacé (une socket de test écoute sur 127.0.0.1, que le vrai filtre refuse). */
        internal fun pourTest(lier: (Socket) -> Unit, adresse: (String) -> ByteArray?) = TransportTcp(lier, adresse)

        /** Sonde de port : connexion puis fermeture, sans envoyer d'octet. Mêmes filtres que [ouvrir]. */
        fun sonder(ip: String, delaiMs: Int, lier: (Socket) -> Unit): Boolean {
            val octets = FiltreReseau.adressePrivee(ip) ?: return false
            val s = Socket()
            return try {
                lier(s)
                s.connect(InetSocketAddress(InetAddress.getByAddress(octets), FiltreReseau.PORT), delaiMs.coerceIn(50, 1000))
                true
            } catch (e: IOException) {
                false
            } catch (e: RuntimeException) {
                false
            } finally {
                try { s.close() } catch (e: IOException) { /* rien */ }
            }
        }
    }
}
