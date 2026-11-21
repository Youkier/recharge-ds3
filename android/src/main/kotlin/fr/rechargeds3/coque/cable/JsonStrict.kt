package fr.rechargeds3.coque.cable

import java.nio.ByteBuffer
import java.nio.charset.CharacterCodingException
import java.nio.charset.CodingErrorAction

/** JSON invalide ou refusé (message fixe : jamais un extrait du texte analysé). */
class ErreurJson : Exception("json")

/**
 * Petit analyseur JSON en Kotlin pur (org.json n'est qu'un bouchon dans les tests JVM d'Android).
 *
 * Mêmes règles que JSON.parse : espaces permis ' ' \t \n \r, pas de virgule finale, pas de zéro de tête, pas de
 * caractère de contrôle dans une chaîne. Différences voulues : profondeur limitée à 32, UTF-8 invalide refusé
 * (comme TextDecoder avec fatal:true). Les objets gardent l'ORDRE des clés (LinkedHashMap) : une clé en double garde
 * sa première place et prend la dernière valeur, comme JSON.parse.
 *
 * Représentation : objet = LinkedHashMap<String, Any?>, tableau = List<Any?>, chaîne = String, nombre = Long s'il est
 * entier et sûr (moins de 15 chiffres, ou valeur entière de Double), sinon Double ; Boolean ; null.
 */
object JsonStrict {
    private const val PROFONDEUR_MAX = 32

    /** UTF-8 strict ; octet invalide = null. Un BOM initial est retiré (comme TextDecoder). */
    fun decoderUtf8(octets: ByteArray): String? {
        val texte = try {
            Charsets.UTF_8.newDecoder()
                .onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT)
                .decode(ByteBuffer.wrap(octets)).toString()
        } catch (e: CharacterCodingException) {
            return null
        }
        return if (texte.startsWith("\uFEFF")) texte.substring(1) else texte
    }

    /** Analyse un texte ; lève [ErreurJson] s'il n'est pas du JSON valide. */
    fun parser(texte: String): Any? = Analyseur(texte).racine()

    /** Décode l'UTF-8 strict puis analyse ; lève [ErreurJson] dans les deux cas d'échec. */
    fun parserOctets(octets: ByteArray): Any? = parser(decoderUtf8(octets) ?: throw ErreurJson())

    /** La valeur si c'est un objet JSON, sinon null. */
    @Suppress("UNCHECKED_CAST")
    fun objet(v: Any?): Map<String, Any?>? = if (v is Map<*, *>) v as Map<String, Any?> else null

    /** Texte JSON compact (comme JSON.stringify) : sert aux comparaisons et au faux câble de test. */
    fun serialiser(v: Any?): String {
        val sb = StringBuilder()
        ecrire(sb, v)
        return sb.toString()
    }

    /** Chaîne JSON entre guillemets (comme JSON.stringify d'une chaîne). */
    fun chaine(texte: String): String {
        val sb = StringBuilder()
        ecrireChaine(sb, texte)
        return sb.toString()
    }

    private fun ecrire(sb: StringBuilder, v: Any?) {
        when (v) {
            null -> sb.append("null")
            is String -> ecrireChaine(sb, v)
            is Boolean -> sb.append(if (v) "true" else "false")
            is Long -> sb.append(v.toString())
            is Int -> sb.append(v.toString())
            is Double -> sb.append(v.toString())
            is Map<*, *> -> {
                sb.append('{')
                var premier = true
                for ((k, x) in v) {
                    if (k !is String) throw ErreurJson()
                    if (!premier) sb.append(',')
                    premier = false
                    ecrireChaine(sb, k)
                    sb.append(':')
                    ecrire(sb, x)
                }
                sb.append('}')
            }
            is List<*> -> {
                sb.append('[')
                var premier = true
                for (x in v) {
                    if (!premier) sb.append(',')
                    premier = false
                    ecrire(sb, x)
                }
                sb.append(']')
            }
            else -> throw ErreurJson()
        }
    }

    private fun ecrireChaine(sb: StringBuilder, s: String) {
        sb.append('"')
        for (c in s) {
            when {
                c == '"' -> sb.append("\\\"")
                c == '\\' -> sb.append("\\\\")
                c == '\b' -> sb.append("\\b")
                c == '\u000C' -> sb.append("\\f")
                c == '\n' -> sb.append("\\n")
                c == '\r' -> sb.append("\\r")
                c == '\t' -> sb.append("\\t")
                c < ' ' -> {
                    val hex = c.code.toString(16)
                    sb.append("\\u").append("0000".substring(hex.length)).append(hex)
                }
                else -> sb.append(c)
            }
        }
        sb.append('"')
    }

    private class Analyseur(private val s: String) {
        private var i = 0

        fun racine(): Any? {
            blancs()
            val v = valeur(0)
            blancs()
            if (i != s.length) erreur()
            return v
        }

        private fun erreur(): Nothing = throw ErreurJson()

        private fun courant(): Char = if (i < s.length) s[i] else erreur()

        private fun blancs() {
            while (i < s.length && (s[i] == ' ' || s[i] == '\t' || s[i] == '\n' || s[i] == '\r')) i++
        }

        private fun valeur(profondeur: Int): Any? {
            if (profondeur > PROFONDEUR_MAX) erreur()
            return when (courant()) {
                '{' -> objet(profondeur)
                '[' -> tableau(profondeur)
                '"' -> chaine()
                't' -> mot("true", true)
                'f' -> mot("false", false)
                'n' -> mot("null", null)
                else -> nombre()
            }
        }

        private fun mot(texte: String, valeur: Any?): Any? {
            if (!s.startsWith(texte, i)) erreur()
            i += texte.length
            return valeur
        }

        private fun objet(profondeur: Int): Any? {
            i++ // '{'
            val m = LinkedHashMap<String, Any?>()
            blancs()
            if (courant() == '}') { i++; return m }
            while (true) {
                blancs()
                if (courant() != '"') erreur()
                val cle = chaine()
                blancs()
                if (courant() != ':') erreur()
                i++
                blancs()
                m[cle] = valeur(profondeur + 1)
                blancs()
                when (courant()) {
                    ',' -> i++
                    '}' -> { i++; return m }
                    else -> erreur()
                }
            }
        }

        private fun tableau(profondeur: Int): Any? {
            i++ // '['
            val l = ArrayList<Any?>()
            blancs()
            if (courant() == ']') { i++; return l }
            while (true) {
                blancs()
                l.add(valeur(profondeur + 1))
                blancs()
                when (courant()) {
                    ',' -> i++
                    ']' -> { i++; return l }
                    else -> erreur()
                }
            }
        }

        private fun chiffreHex(c: Char): Int = when (c) {
            in '0'..'9' -> c - '0'
            in 'a'..'f' -> c - 'a' + 10
            in 'A'..'F' -> c - 'A' + 10
            else -> erreur()
        }

        private fun chaine(): String {
            i++ // guillemet ouvrant
            val sb = StringBuilder()
            while (true) {
                val c = courant()
                i++
                when {
                    c == '"' -> return sb.toString()
                    c == '\\' -> {
                        val e = courant()
                        i++
                        when (e) {
                            '"' -> sb.append('"')
                            '\\' -> sb.append('\\')
                            '/' -> sb.append('/')
                            'b' -> sb.append('\b')
                            'f' -> sb.append('\u000C')
                            'n' -> sb.append('\n')
                            'r' -> sb.append('\r')
                            't' -> sb.append('\t')
                            'u' -> {
                                var code = 0
                                for (k in 0 until 4) {
                                    code = code * 16 + chiffreHex(courant())
                                    i++
                                }
                                sb.append(code.toChar())
                            }
                            else -> erreur()
                        }
                    }
                    c < ' ' -> erreur()
                    else -> sb.append(c)
                }
            }
        }

        private fun chiffres(): Int {
            val debut = i
            while (i < s.length && s[i] in '0'..'9') i++
            return i - debut
        }

        private fun nombre(): Any? {
            val debut = i
            if (courant() == '-') i++
            if (courant() == '0') {
                i++
            } else {
                if (courant() !in '1'..'9') erreur()
                chiffres()
            }
            var entier = true
            if (i < s.length && s[i] == '.') {
                entier = false
                i++
                if (chiffres() == 0) erreur()
            }
            if (i < s.length && (s[i] == 'e' || s[i] == 'E')) {
                entier = false
                i++
                if (i < s.length && (s[i] == '+' || s[i] == '-')) i++
                if (chiffres() == 0) erreur()
            }
            val texte = s.substring(debut, i)
            if (entier && texte.length <= 15) return texte.toLong()
            val d = texte.toDouble()
            return if (d == Math.rint(d) && Math.abs(d) < 1e15) d.toLong() else d
        }
    }
}
