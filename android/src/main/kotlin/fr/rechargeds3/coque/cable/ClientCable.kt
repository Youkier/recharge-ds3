package fr.rechargeds3.coque.cable

import java.net.SocketTimeoutException
import java.time.ZonedDateTime
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference

/**
 * Configuration du câble. [cleLocale] : les 16 octets de la clé locale (jamais copiée dans un résultat, un message
 * d'exception ou un journal ; [toString] ne la montre pas). [deviceId] est conservé pour l'appelant : le protocole
 * local n'en a pas besoin. [delaiGlobalMs] : échéance de toute l'opération (20 s).
 */
class ConfigCable( // pas de data class : ni copy() ni composante qui exposerait la clé
    val deviceId: String,
    val cleLocale: ByteArray,
    val ip: String,
    val delaiGlobalMs: Long = 20_000,
) {
    override fun toString(): String = "ConfigCable(***)"
}

/**
 * Les deux seules actions : régler la plage (début [hhmm], fin [fin], durée de charge [dureeMin] en minutes, heure de départ
 * [depart], voir Plage.decider pour le démarrage tardif), ou la rendre « courte » : fin = [Desactiver.fin] (fin des heures creuses),
 * début = fin moins une minute.
 */
sealed class Action {
    data class Allumage(val hhmm: String, val fin: String, val dureeMin: Int, val depart: String) : Action()
    data class Desactiver(val fin: String) : Action()
}

/**
 * Résultat, mêmes champs que le JS (plage_active devient [plageActive]). [erreur] : "cle", "hors_ligne", "delai",
 * "format", "relecture_differente", "requete_invalide" ou "trop_tard" (début >= départ : rien n'est écrit). [tardif] : le début a été
 * reporté à maintenant + 10 min (début et fin sont ceux réellement écrits et relus). [ecrit] : l'écriture est partie, donc a pu être appliquée :
 * l'appelant ne doit JAMAIS la relancer.
 */
data class Resultat(
    val ok: Boolean,
    val erreur: String? = null,
    val debut: String? = null,
    val fin: String? = null,
    val plageActive: Boolean? = null,
    val tardif: Boolean = false,
    val courte: Boolean = false,
    val ecrit: Boolean = false,
)

/**
 * Les deux opérations du projet sur le câble : lire la plage, programmer le début. Reprise de local/tuya-local.js
 * (même ordre des échanges, mêmes délais, mêmes codes d'erreur). Kotlin pur, sans android.*.
 *
 * Garanties :
 *  - n'écrit que `ss`, `se` et `m` du dp 151 (règle n°9, élargie le 2026-11-22) ; `dt` est recopié de la valeur relue ;
 *  - relit avant d'écrire : valeur au format exact attendu, sinon RIEN n'est envoyé ;
 *  - relit après : succès seulement si le dp 151 relu est celui demandé et qu'aucun autre point non volatil a changé ;
 *  - une seule connexion, fermée dans tous les cas (une seule fois) ; échéance globale tenue par un fil de travail
 *    et la fermeture du transport (un transport bloqué est débloqué par fermer()) ;
 *  - la clé n'apparaît dans aucun résultat ni message ; rien n'est journalisé ; les copies de clé sont mises à zéro.
 */
object ClientCable {
    private const val DELAI_CONNEXION_MS = 5_000L
    private const val DELAI_TRAME_MS = 5_000L
    private const val DELAI_ACCUSE_MS = 2_000L
    private val ATTENTES_RELECTURE_MS = longArrayOf(500L, 1500L, 2500L)
    private const val LONGUEUR_CLE = 16

    fun lireEtat(cfg: ConfigCable, t: Transport, aleas: (Int) -> ByteArray = Aleas.parDefaut): Resultat =
        executer(cfg, t, aleas, { ms -> Thread.sleep(ms) }, { ZonedDateTime.now(Plage.PARIS) }) { ctx ->
            reponsePlage(plageDepuisDps(lireDps(ctx)))
        }

    fun programmer(
        cfg: ConfigCable,
        t: Transport,
        action: Action,
        maintenant: () -> ZonedDateTime = { ZonedDateTime.now(Plage.PARIS) },
        pause: (Long) -> Unit = { ms -> Thread.sleep(ms) },
        aleas: (Int) -> ByteArray = Aleas.parDefaut,
    ): Resultat {
        if (action is Action.Allumage && !Plage.demandeValide(action.hhmm, action.fin, action.dureeMin, action.depart)) {
            return Resultat(false, "requete_invalide")
        }
        if (action is Action.Desactiver && !Plage.heureValide(action.fin)) return Resultat(false, "requete_invalide")
        return executer(cfg, t, aleas, pause, maintenant) { ctx -> programmerEnSession(ctx, action) }
    }

    // --- Contexte d'une opération ---

    internal class Contexte(
        val transport: Transport,
        val cleLocale: ByteArray,
        val aleas: (Int) -> ByteArray,
        val pause: (Long) -> Unit,
        val maintenant: () -> ZonedDateTime,
        val echeance: Long,
    ) {
        var cleActive: ByteArray = cleLocale
        var seq: Long = 1
        val tampon = Tuya35.Tampon()
        @Volatile var annule = false
        @Volatile var ecrit = false
    }

    private fun horloge(): Long = System.nanoTime() / 1_000_000

    private fun erreurTransport(e: Exception): ErreurCable {
        if (e is TransportException && (e.code == "delai" || e.code == "ferme" || e.code == "hors_ligne")) return ErreurCable(e.code)
        if (e is SocketTimeoutException) return ErreurCable("delai")
        return ErreurCable("hors_ligne") // tout autre échec du transport ; le message de l'exception n'est jamais repris
    }

    private fun tempsRestant(ctx: Contexte): Long {
        val r = ctx.echeance - horloge()
        if (r <= 0 || ctx.annule) throw ErreurCable("delai")
        return r
    }

    /** Résultat d'échec : « delai » (incertain) si l'écriture est partie, jamais un code qui dirait « rien n'a changé ». */
    private fun echec(ctx: Contexte, code: String): Resultat =
        if (ctx.ecrit) Resultat(false, if (code == "relecture_differente") code else "delai", ecrit = true)
        else Resultat(false, if (code == "ferme") "hors_ligne" else code)

    // --- Cadre commun : validation, connexion unique, échéance globale, fermeture dans tous les cas ---

    private fun executer(
        cfg: ConfigCable,
        t: Transport,
        aleas: (Int) -> ByteArray,
        pause: (Long) -> Unit,
        maintenant: () -> ZonedDateTime,
        travail: (Contexte) -> Resultat,
    ): Resultat {
        if (cfg.cleLocale.size != LONGUEUR_CLE) return Resultat(false, "cle")
        if (cfg.ip.isEmpty()) return Resultat(false, "hors_ligne")
        val delaiGlobal = maxOf(cfg.delaiGlobalMs, 1L)
        val ctx = Contexte(t, cfg.cleLocale.copyOf(), aleas, pause, maintenant, horloge() + delaiGlobal)
        val ferme = AtomicBoolean(false)
        // Le transport est fermé une seule fois, par le fil de travail ou par l'échéance, selon le premier arrivé.
        fun fermer() {
            if (ferme.compareAndSet(false, true)) {
                try { t.fermer() } catch (e: Exception) { /* rien à faire */ }
            }
        }
        val sortie = AtomicReference<Resultat?>(null)
        val fil = Thread {
            try {
                val r: Resultat = try {
                    try {
                        t.ouvrir(cfg.ip, Tuya35.PORT, minOf(DELAI_CONNEXION_MS, delaiGlobal).toInt())
                    } catch (e: Exception) {
                        throw erreurTransport(e)
                    }
                    try {
                        negocier(ctx)
                    } catch (e: ErreurCable) {
                        // Connexion fermée par le câble pendant la négociation : clé refusée (hypothèse tinytuya).
                        throw if (e.code == "ferme") ErreurCable("cle") else e
                    }
                    travail(ctx)
                } catch (e: Throwable) {
                    // Seul le code est renvoyé : jamais le message d'une exception.
                    echec(ctx, if (e is ErreurCable) e.code else "format")
                }
                sortie.set(r)
            } finally {
                ctx.annule = true
                ctx.cleLocale.fill(0)
                ctx.cleActive.fill(0)
                fermer()
            }
        }
        fil.isDaemon = true
        fil.start()
        try {
            fil.join(delaiGlobal)
        } catch (e: InterruptedException) {
            Thread.currentThread().interrupt()
        }
        if (fil.isAlive) {
            // Échéance : on coupe le transport (débloque un recevoir ou un envoyer bloqué) et on rend « delai ».
            ctx.annule = true
            fermer()
            fil.interrupt()
            return echec(ctx, "delai")
        }
        return sortie.get() ?: Resultat(false, "format")
    }

    // --- Échanges ---

    private fun envoyerTrame(ctx: Contexte, cmd: Long, clair: ByteArray) {
        tempsRestant(ctx)
        val seq = ctx.seq++
        val trame = Tuya35.empaqueter(ctx.cleActive, seq, cmd, clair, ctx.aleas(12))
        try {
            ctx.transport.envoyer(trame)
        } catch (e: Exception) {
            throw erreurTransport(e)
        }
    }

    /** Attend une trame que [filtre] accepte ; les autres (annonces d'état, accusés) sont ignorées. */
    private fun attendreTrame(ctx: Contexte, delaiMs: Long, filtre: (Message) -> Boolean): Message {
        val limite = horloge() + delaiMs
        while (true) {
            var trame = ctx.tampon.extraire()
            while (trame != null) {
                val msg = Tuya35.depaqueter(ctx.cleActive, trame)
                if (filtre(msg)) return msg
                trame = ctx.tampon.extraire()
            }
            val attente = minOf(tempsRestant(ctx), limite - horloge())
            if (attente <= 0) throw ErreurCable("delai")
            val morceau = try {
                ctx.transport.recevoir(attente.toInt())
            } catch (e: Exception) {
                throw erreurTransport(e)
            }
            if (morceau.isEmpty()) throw ErreurCable("ferme")
            ctx.tampon.ajouter(morceau)
        }
    }

    /**
     * Négociation de la clé de session (version 3.5) :
     * 1. nous : cmd 3, nonce local (16 octets), chiffré avec la clé locale ;
     * 2. câble : cmd 4, nonce du câble (16) + HMAC-SHA256(clé locale, nonce local) (32) ; nous vérifions le HMAC ;
     * 3. nous : cmd 5, HMAC-SHA256(clé locale, nonce du câble) ; pas de réponse attendue ;
     * 4. clé de session : voir [Tuya35.cleDeSession].
     */
    private fun negocier(ctx: Contexte) {
        val nonce = ctx.aleas(16)
        if (nonce.size != 16) throw ErreurCable("format")
        ctx.cleActive = ctx.cleLocale
        envoyerTrame(ctx, Tuya35.CMD_NEG_DEBUT, nonce)
        val rep = attendreTrame(ctx, DELAI_TRAME_MS) { it.cmd == Tuya35.CMD_NEG_REPONSE }
        if (rep.payload.size < 48) throw ErreurCable("cle")
        val nonceCable = rep.payload.copyOfRange(0, 16)
        if (!Tuya35.egaux(Tuya35.hmacSha256(ctx.cleLocale, nonce), rep.payload.copyOfRange(16, 48))) throw ErreurCable("cle")
        envoyerTrame(ctx, Tuya35.CMD_NEG_FIN, Tuya35.hmacSha256(ctx.cleLocale, nonceCable))
        ctx.cleActive = Tuya35.cleDeSession(ctx.cleLocale, nonce, nonceCable)
    }

    /** Lecture des points de données (cmd 0x10, corps « {} », sans en-tête de version). */
    private fun lireDps(ctx: Contexte): Map<String, Any?> {
        envoyerTrame(ctx, Tuya35.CMD_LECTURE, "{}".toByteArray(Charsets.UTF_8))
        val msg = attendreTrame(ctx, DELAI_TRAME_MS) { it.cmd == Tuya35.CMD_LECTURE && it.payload.isNotEmpty() }
        var p = msg.payload
        // « 3.5 » + 12 octets nuls devant le corps (_decode_payload) ; plus court que 15 octets : corps vide, donc format.
        if (p.size >= 3 && p[0] == 0x33.toByte() && p[1] == 0x2e.toByte() && p[2] == 0x35.toByte()) {
            p = if (p.size > 15) p.copyOfRange(15, p.size) else ByteArray(0)
        }
        val json = try {
            JsonStrict.parserOctets(p)
        } catch (e: ErreurJson) {
            throw ErreurCable("format")
        }
        val racine = JsonStrict.objet(json) ?: throw ErreurCable("format")
        // json.dps ?? json.data?.dps : « dps » présent mais pas un objet n'autorise PAS le repli sur data.dps.
        val brut = racine["dps"] ?: JsonStrict.objet(racine["data"])?.get("dps")
        return JsonStrict.objet(brut) ?: throw ErreurCable("format")
    }

    private fun plageDepuisDps(dps: Map<String, Any?>): PlageCharge {
        val valeur = dps[Plage.DP_PLAGE] as? String ?: throw ErreurCable("format")
        return Plage.lirePlage(valeur) ?: throw ErreurCable("format")
    }

    private fun memePlage(a: PlageCharge, b: PlageCharge): Boolean = a == b

    private fun reponsePlage(p: PlageCharge, tardif: Boolean = false, courte: Boolean = false): Resultat =
        Resultat(true, debut = p.ss, fin = p.se, plageActive = p.m == 2, tardif = tardif, courte = courte)

    // --- Écriture : la SEULE construction d'une commande d'écriture du module ---

    /**
     * Corps tinytuya (payload_dict « v3.5 », CONTROL -> CONTROL_NEW), construit à la main à partir de valeurs validées,
     * identique à l'octet à JSON.stringify côté JS :
     * {"protocol":5,"t":<secondes>,"data":{"dps":{"151":"{\"m\":2,\"dt\":0,\"ss\":\"05:00\",\"se\":\"06:00\"}"}}}
     * précédé de l'en-tête de version « 3.5 » + 12 octets nuls. Garde-fou : seuls m (forcé à 2), ss et se changent ; dt est
     * recopié de la valeur relue, et les deux heures sont revalidées ici.
     */
    private fun corpsEcriture(actuelle: PlageCharge, debut: String, fin: String, t: Long): ByteArray {
        if (!Plage.heureValide(debut) || !Plage.heureValide(fin)) throw ErreurCable("format")
        val valeur = "{\"m\":2,\"dt\":" + actuelle.dt + ",\"ss\":\"" + debut + "\",\"se\":\"" + fin + "\"}"
        val json = "{\"protocol\":5,\"t\":" + t + ",\"data\":{\"dps\":{\"" + Plage.DP_PLAGE + "\":\"" +
            valeur.replace("\"", "\\\"") + "\"}}}"
        val entete = ByteArray(15)
        entete[0] = 0x33
        entete[1] = 0x2e
        entete[2] = 0x35
        return Tuya35.concat(entete, json.toByteArray(Charsets.UTF_8))
    }

    private fun programmerEnSession(ctx: Contexte, action: Action): Resultat {
        val avant = lireDps(ctx)
        val actuelle = plageDepuisDps(avant) // format inattendu : on s'arrête ici, rien n'est envoyé
        val debut: String
        val fin: String
        val tardif: Boolean
        val courte: Boolean
        if (action is Action.Allumage) {
            // Décision au moment de l'envoi (après la lecture) : normale, tardive, ou trop tard (rien n'est écrit).
            val d = Plage.decider(action.hhmm, action.fin, action.dureeMin, action.depart, ctx.maintenant())
            if (d is Decision.Normale) {
                debut = d.debut; fin = d.fin; tardif = false
            } else if (d is Decision.Tardive) {
                debut = d.debut; fin = d.fin; tardif = true
            } else {
                return Resultat(false, if (d is Decision.TropTard) "trop_tard" else "requete_invalide")
            }
            courte = false
        } else {
            val des = action as Action.Desactiver
            debut = Plage.moinsUneMinute(des.fin)
            fin = des.fin // la fin des heures creuses est réécrite : une fin repoussée la veille ne reste pas
            tardif = false
            courte = true
        }
        val t = ctx.maintenant().toEpochSecond()
        corpsEcriture(actuelle, debut, fin, t) // valide aussi le format, avant tout envoi
        val voulue = PlageCharge(2, actuelle.dt, debut, fin)
        if (memePlage(actuelle, voulue)) return reponsePlage(actuelle, tardif, courte) // déjà réglé : rien à envoyer

        // Un seul endroit construit et envoie l'écriture (toujours la même valeur voulue : seuls m, ss et se du dp 151).
        fun envoyerEcriture(tEnvoi: Long) {
            val trame = corpsEcriture(actuelle, debut, fin, tEnvoi)
            ctx.ecrit = true // à partir d'ici, l'écriture a pu être appliquée même si la suite échoue
            envoyerTrame(ctx, Tuya35.CMD_ECRITURE, trame)
            // Accusé du câble (même commande, retcode 0) : son absence n'est pas une erreur, la relecture décide.
            try {
                attendreTrame(ctx, DELAI_ACCUSE_MS) { it.cmd == Tuya35.CMD_ECRITURE }
            } catch (e: ErreurCable) {
                if (e.code != "delai" || ctx.annule || ctx.echeance - horloge() <= 0) throw e
            }
        }
        envoyerEcriture(t)

        // Câble en veille (dp 109 = « SLEEP ») : il se réveille avec la première écriture et la jette. On renvoie alors
        // UNE fois la même valeur : sans effet si elle avait été appliquée entre-temps (docs/tuya-findings.md).
        var renvoyee = false
        val enVeille = avant[Plage.DP_ETAT] == "SLEEP"
        for (attente in ATTENTES_RELECTURE_MS) {
            if (attente >= tempsRestant(ctx)) throw ErreurCable("delai") // plus le temps de relire : résultat incertain
            ctx.pause(attente)
            val apres = lireDps(ctx)
            val relue = plageDepuisDps(apres)
            if (memePlage(relue, voulue)) {
                if (Plage.autresPointsModifies(avant, apres)) throw ErreurCable("relecture_differente")
                return reponsePlage(relue, tardif, courte)
            }
            if (enVeille && !renvoyee && memePlage(relue, actuelle)) {
                renvoyee = true
                envoyerEcriture(ctx.maintenant().toEpochSecond())
            }
        }
        throw ErreurCable("relecture_differente")
    }
}
