package fr.rechargeds3.coque

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyPermanentlyInvalidatedException
import android.security.keystore.KeyProperties
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Identifiant, clé locale et adresse du câble, conservés sur le téléphone (coque v0.3, décisions du 2026-11-20,
 * SECURITE.md « Coque Android »).
 *
 * - Identifiant et clé : chiffrés ensemble en AES-GCM par une clé du magasin de clés d'Android (fournisseur
 *   « AndroidKeyStore », non exportable : « Key material never enters the application process »,
 *   developer.android.com/privacy-and-security/keystore), créée avec setUnlockedDeviceRequired(true), sans biométrie.
 *   IV choisi par le magasin (chiffrement aléatoire exigé par défaut), lu par Cipher.getIV().
 * - Adresse IP : en clair dans le même fichier privé (elle n'est pas secrète).
 * - Fichier : SharedPreferences MODE_PRIVATE ; exclu de la sauvegarde et du transfert (allowBackup="false",
 *   regles_extraction.xml).
 *
 * Toutes les méthodes qui touchent au magasin s'appellent HORS du fil principal (« apps should avoid using
 * AndroidKeyStore on their main thread »). Rien n'est journalisé. Un bloc illisible rend null et n'est jamais effacé ici :
 * le prochain enregistrement l'écrase, « Oublier » l'efface.
 */
class CoffreCable(contexte: Context) {
    private val prefs = contexte.applicationContext.getSharedPreferences(FICHIER, Context.MODE_PRIVATE)

    /** Un bloc est enregistré (sans le déchiffrer : utilisable sur le fil principal). */
    fun configure(): Boolean = prefs.contains(BLOC)

    @Synchronized
    fun enregistrer(identifiant: String, cle: String) {
        val c = Cipher.getInstance(TRANSFORMATION)
        try {
            c.init(Cipher.ENCRYPT_MODE, cleDuMagasin(creer = true))
        } catch (e: KeyPermanentlyInvalidatedException) {
            // Clé du magasin devenue inutilisable (changement de verrouillage…) : on la remplace, l'ancien bloc est écrasé.
            supprimerCleDuMagasin()
            c.init(Cipher.ENCRYPT_MODE, cleDuMagasin(creer = true))
        }
        val bloc = Enveloppe.encoder(c.iv, c.doFinal(Enveloppe.contenu(identifiant, cle)))
        check(prefs.edit().putString(BLOC, bloc).commit()) { "enregistrement impossible" }
    }

    /** (identifiant, clé) déchiffrés, ou null (rien d'enregistré, bloc illisible, clé du magasin absente ou refusée). */
    @Synchronized
    fun lire(): Pair<String, String>? {
        val (iv, chiffre) = Enveloppe.decoder(prefs.getString(BLOC, null)) ?: return null
        return try {
            val k = cleDuMagasin(creer = false) ?: return null // magasin illisible : null, jamais d'exception vers le pont
            val c = Cipher.getInstance(TRANSFORMATION)
            c.init(Cipher.DECRYPT_MODE, k, GCMParameterSpec(Enveloppe.TAILLE_ETIQUETTE * 8, iv))
            Enveloppe.lireContenu(c.doFinal(chiffre))
        } catch (e: Exception) { // étiquette fausse, téléphone verrouillé, clé invalidée… : jamais d'exception vers la page
            null
        }
    }

    /** Dernière adresse où une lecture a réussi, si elle est encore une IPv4 privée valide. */
    fun adresse(): String? = prefs.getString(ADRESSE, null)?.takeIf { FiltreReseau.adressePrivee(it) != null }

    /** À n'appeler qu'après une lecture réussie avec la bonne clé (contrat tenu par OperationsCable, qui l'appelle après une lecture, une écriture ou une recherche réussie). Hors du fil
     *  principal : écriture synchrone, pour que l'adresse survive à un arrêt immédiat de l'appli. */
    @Synchronized
    fun retenirAdresse(ip: String) {
        require(FiltreReseau.adressePrivee(ip) != null)
        prefs.edit().putString(ADRESSE, ip).commit()
    }

    /** « Oublier le câble » : fichier vidé et clé du magasin supprimée. */
    @Synchronized
    fun oublier() {
        prefs.edit().clear().commit()
        supprimerCleDuMagasin()
    }

    private fun supprimerCleDuMagasin() {
        try {
            KeyStore.getInstance(MAGASIN).apply { load(null) }.deleteEntry(ALIAS)
        } catch (e: Exception) { /* déjà absente */ }
    }

    private fun cleDuMagasin(creer: Boolean): SecretKey? {
        val magasin = KeyStore.getInstance(MAGASIN).apply { load(null) }
        (magasin.getKey(ALIAS, null) as? SecretKey)?.let { return it }
        if (!creer) return null
        val spec = KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .setUnlockedDeviceRequired(true)
            .build()
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, MAGASIN).apply { init(spec) }.generateKey()
    }

    companion object {
        private const val MAGASIN = "AndroidKeyStore"
        private const val ALIAS = "cable-v1"
        private const val TRANSFORMATION = "AES/GCM/NoPadding"
        private const val FICHIER = "cable"
        private const val BLOC = "bloc"
        private const val ADRESSE = "adresse"
    }
}
