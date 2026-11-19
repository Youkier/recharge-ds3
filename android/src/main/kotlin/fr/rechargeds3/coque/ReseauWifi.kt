package fr.rechargeds3.coque

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import java.net.Inet4Address

/**
 * Réseau Wi-Fi du téléphone. Toute connexion du pont est liée à CE réseau (Network.bindSocket) : jamais par les données
 * mobiles, et « pas de Wi-Fi » devient une cause d'échec distincte de « câble injoignable ».
 * Sources : developer.android.com, ConnectivityManager.registerNetworkCallback, NetworkRequest.Builder.addTransportType,
 * Network.bindSocket, LinkProperties.getLinkAddresses. Permission : ACCESS_NETWORK_STATE (normale, sans demande).
 */
class ReseauWifi(context: Context) {
    private val cm = context.getSystemService(ConnectivityManager::class.java)
    @Volatile private var reseau: Network? = null
    private var enregistre = false

    private val rappel = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) { reseau = network }
        override fun onLost(network: Network) { if (reseau == network) reseau = null }
    }

    fun demarrer() {
        if (enregistre) return
        val demande = NetworkRequest.Builder().addTransportType(NetworkCapabilities.TRANSPORT_WIFI).build()
        cm.registerNetworkCallback(demande, rappel)
        enregistre = true
        // État initial, sans attendre le premier rappel.
        val actif = cm.activeNetwork
        if (actif != null && cm.getNetworkCapabilities(actif)?.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) == true) reseau = actif
    }

    fun arreter() {
        if (!enregistre) return
        try { cm.unregisterNetworkCallback(rappel) } catch (e: IllegalArgumentException) { /* déjà retiré */ }
        enregistre = false
        reseau = null
    }

    fun courant(): Network? = reseau

    /** Réseau /24 du téléphone sur le Wi-Fi (« 10.0.2 »), rien de plus ; null sans Wi-Fi ou sans adresse IPv4 privée. */
    fun prefixe(): String? {
        val n = reseau ?: return null
        val liens = cm.getLinkProperties(n) ?: return null
        for (la in liens.linkAddresses) {
            val a = la.address
            if (a is Inet4Address) FiltreReseau.prefixe24(a.address)?.let { return it }
        }
        return null
    }
}
