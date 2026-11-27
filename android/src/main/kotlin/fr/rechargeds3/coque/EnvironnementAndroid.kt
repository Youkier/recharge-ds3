package fr.rechargeds3.coque

import fr.rechargeds3.coque.cable.Transport

/** Wi-Fi et coffre du téléphone, vus par OperationsCable. Chaque connexion est liée au réseau Wi-Fi (jamais le mobile). */
class EnvironnementAndroid(private val wifi: ReseauWifi, private val coffre: CoffreCable) : EnvironnementCable {
    override fun configure(): Boolean = coffre.configure()
    override fun lireCle(): Pair<String, String>? = coffre.lire()
    override fun adresse(): String? = coffre.adresse()

    // Seulement si un câble est enregistré : l'adresse d'un câble qu'on ne connaît pas n'a rien à faire dans le coffre.
    override fun retenirAdresse(ip: String) { if (coffre.configure()) coffre.retenirAdresse(ip) }

    override fun prefixeWifi(): String? = wifi.prefixe()

    override fun creerTransport(): Transport? {
        val reseau = wifi.courant() ?: return null
        return TransportTcp { s -> reseau.bindSocket(s) }
    }

    override fun sonder(ip: String, delaiMs: Int): Boolean {
        val reseau = wifi.courant() ?: throw SondeImpossible("pas de réseau Wi-Fi")
        return TransportTcp.sonder(ip, delaiMs) { s -> reseau.bindSocket(s) }
    }
}
