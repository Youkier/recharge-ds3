// Tests du client du pont de la coque (site/pont.js) contre un pont SIMULÉ en JavaScript qui applique le
// contrat décrit dans l'en-tête de site/pont.js (le vrai pont est PontLocal.kt + OperationsCable.kt, testé en JUnit et
// sur émulateur). Depuis le lot E2, le client n'a plus de transport ni de sonde : seulement des opérations de haut niveau.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { creerClientPont } from '../site/pont.js';

const lire = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

// Pont simulé : réponses par opération (valeur ou fonction), journal des requêtes reçues.
function faussePont(reponses, { retard = 0 } = {}) {
  const pont = { onmessage: null, requetes: [] };
  const envoyer = (n, r) => setTimeout(() => pont.onmessage({ data: JSON.stringify({ n, ...r }) }), retard);
  pont.postMessage = (texte) => {
    const q = JSON.parse(texte);
    pont.requetes.push(q);
    const r = typeof reponses[q.op] === 'function' ? reponses[q.op](q, (x) => envoyer(q.n, x)) : reponses[q.op];
    envoyer(q.n, r ?? { ok: false, erreur: 'operation_inconnue' });
  };
  return pont;
}

test('lire : paramètres et délai transmis, résultat rendu', async () => {
  const pont = faussePont({ lire: { ok: true, debut: '03:30', fin: '06:00', plage_active: true } });
  const client = creerClientPont(pont);
  const r = await client.lire({ ip: '10.0.2.2' }, 4000);
  assert.deepEqual([r.ok, r.debut, r.fin, r.plage_active], [true, '03:30', '06:00', true]);
  const q = pont.requetes[0];
  assert.deepEqual([q.op, q.ip, q.delai], ['lire', '10.0.2.2', 4000]);
});

test('programmer : l\'action et l\'adresse partent, rien d\'autre ; le résultat natif est rendu tel quel', async () => {
  const pont = faussePont({ programmer: { ok: true, debut: '05:00', fin: '06:00', plage_active: true, immediat: false, courte: false } });
  const client = creerClientPont(pont);
  const r = await client.programmer({ allumage: '05:00' }, { ip: '10.0.2.2' }, 20000);
  assert.equal(r.ok, true);
  const { n, ...reste } = pont.requetes[0];
  assert.ok(Number.isInteger(n));
  assert.deepEqual(reste, { op: 'programmer', allumage: '05:00', ip: '10.0.2.2', delai: 20000 });
  await client.programmer({ desactiver: true }, {}, 1000);
  const { n: _n, ...reste2 } = pont.requetes[1];
  assert.deepEqual(reste2, { op: 'programmer', desactiver: true, delai: 1000 });
});

test('chercher : la progression est relayée, la réponse finale résout', async () => {
  const pont = faussePont({
    chercher: (q, envoyer) => {
      envoyer({ progres: true, etape: 'sondes', appareils: 0, lectures: 0, echeance: 1234 });
      envoyer({ progres: true, etape: 'lectures', appareils: 1, lectures: 1, echeance: 1234 });
      return { ok: true, ip: '10.0.2.2', trouve: true, debut: '03:30', fin: '06:00', plage_active: true };
    },
  });
  const client = creerClientPont(pont);
  const vus = [];
  const r = await client.chercher({ ip: '10.0.2.250' }, (p) => vus.push(p.etape));
  assert.equal(r.ok, true);
  assert.equal(r.ip, '10.0.2.2');
  assert.deepEqual(vus, ['sondes', 'lectures']);
  assert.equal(pont.requetes[0].ip, '10.0.2.250');
});

test('une exception du rappel de progression est sans effet ; un message de progression tardif est ignoré', async () => {
  const pont = faussePont({ chercher: (q, envoyer) => { envoyer({ progres: true, etape: 'sondes' }); return { ok: false, erreur: 'introuvable' }; } });
  const client = creerClientPont(pont);
  const r = await client.chercher({}, () => { throw new Error('page'); });
  assert.deepEqual([r.ok, r.erreur], [false, 'introuvable']);
  pont.onmessage({ data: JSON.stringify({ n: 1, progres: true, etape: 'x' }) }); // plus d'attente pour ce numéro : ignoré
});

test('configuration : cable, memoriser et oublierMemoire ne rendent jamais de clé', async () => {
  const pont = faussePont({ cable: { ok: true, configure: true, adresse: '10.0.2.2' }, memoriser: { ok: true }, oublierMemoire: { ok: true } });
  const client = creerClientPont(pont);
  assert.equal((await client.cable()).configure, true);
  assert.equal((await client.memoriser()).ok, true);
  assert.equal((await client.oublierMemoire()).ok, true);
  assert.deepEqual(pont.requetes.map((q) => q.op), ['cable', 'memoriser', 'oublierMemoire']);
});

test('le client n\'a plus de route générique : ni transport, ni sonde, ni base64', async () => {
  const mod = await import('../site/pont.js');
  assert.deepEqual(Object.keys(mod), ['creerClientPont']);
  const client = creerClientPont(faussePont({}));
  for (const nom of ['creerTransport', 'sonder', 'ouvrir', 'envoyer', 'recevoir', 'fermer']) assert.equal(client[nom], undefined, nom);
  const src = lire('../site/pont.js').replace(/\/\/.*$/gm, '');
  assert.ok(!/btoa|atob|ouvrir|recevoir/.test(src));
});

test('opération inconnue du natif : { ok:false, erreur:"operation_inconnue" } rendu sans exception', async () => {
  const client = creerClientPont(faussePont({}));
  const r = await client.appeler('ouvrir', { ip: '10.0.2.2', port: 6668 });
  assert.deepEqual([r.ok, r.erreur], [false, 'operation_inconnue']);
});

test('pont muet : réponse pont_muet au lieu d\'un blocage', async () => {
  const client = creerClientPont({ postMessage() {}, onmessage: null }, { margeMs: 10 });
  const t0 = Date.now();
  const r = await client.appeler('variante', {}, 1);
  assert.deepEqual([r.ok, r.erreur], [false, 'pont_muet']);
  assert.ok(Date.now() - t0 < 5000);
});

test('pont qui lève une exception à l\'envoi : pont_muet', async () => {
  const client = creerClientPont({ postMessage() { throw new Error('page détruite'); }, onmessage: null });
  const r = await client.lire();
  assert.deepEqual([r.ok, r.erreur], [false, 'pont_muet']);
});

test('la page d\'essai ne garde ni ne journalise la clé : pas de stockage, une seule ligne ESSAI', () => {
  for (const f of ['../android/essai/essai.js', '../site/pont.js']) {
    const src = lire(f).replace(/\/\/.*$/gm, ''); // sans les commentaires
    assert.ok(!/localStorage|sessionStorage|indexedDB|document\.cookie|location\.(hash|search)|history\./.test(src), f);
    assert.ok(!/cleLocale|deviceId|\.cle\b/.test(src), `${f} : la page ne manipule ni clé ni identifiant`);
  }
  const src = lire('../android/essai/essai.js');
  const logs = src.match(/console\.\w+\(/g) || [];
  assert.deepEqual(logs, ['console.log('], 'un seul appel de console, celui de la ligne ESSAI');
  assert.ok(/console\.log\('ESSAI ' \+ JSON\.stringify\(ligne\)\)/.test(src));
  assert.ok(!/ligne\s*=\s*\{[^}]*(cle|cleLocale|deviceId)/.test(src), 'la ligne ESSAI ne contient ni clé ni identifiant');
  assert.ok(!/textContent\s*=[^;]*(cleLocale|\.cle\b)/.test(src), 'la clé n\'est jamais affichée');
  // Les en-têtes des fichiers de la page ne chargent rien hors de l'origine de l'application.
  const html = lire('../android/essai/index.html');
  assert.ok(!/https?:\/\//.test(html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, '')), 'aucune ressource distante');
  assert.match(html, /script-src 'self'/);
});

test('le pont natif n\'expose aucune route générique : liste fermée des opérations', () => {
  const kt = lire('../android/src/main/kotlin/fr/rechargeds3/coque/PontLocal.kt').replace(/\/\/.*$/gm, '');
  const ops = [...kt.matchAll(/^\s*"([A-Za-z]+)"(?:, "[A-Za-z]+")* ->/gm)].flatMap((m) => m[0].match(/"[A-Za-z]+"/g)).map((s) => s.slice(1, -1)).sort();
  assert.deepEqual(ops, ['attenteDebut', 'attenteEtat', 'attenteFin', 'cable', 'chercher', 'demanderNotifications', 'demarrage',
    'essaiArrierePlan', 'essaiFiltre', 'lire', 'memoriser', 'notifications', 'oublierMemoire', 'prefixeWifi', 'programmer', 'saisirCle', 'variante']);
  assert.match(kt, /RoutesPont\.autorisee\(op, estDebug\)/, 'toute opération passe par la table des routes');
  const routes = lire('../android/src/main/kotlin/fr/rechargeds3/coque/RoutesPont.kt');
  const entre = (nom) => [...routes.match(new RegExp(nom + ' = setOf\(([^)]*)\)'))[1].matchAll(/"(\w+)"/g)].map((m) => m[1]);
  assert.deepEqual(entre('MISE_AU_POINT'), ['essaiArrierePlan', 'essaiFiltre'], 'seules ces deux opérations sont réservées à la mise au point');
  assert.deepEqual([...entre('PUBLIQUES'), ...entre('MISE_AU_POINT')].sort(), ops);
  for (const interdit of ['ouvrir', 'envoyer', 'recevoir', 'fermer', 'sonder', 'retenirAdresse']) assert.ok(!ops.includes(interdit), interdit);
  // Seul le transport natif ouvre une connexion : aucun autre fichier de l'appli n'utilise de socket.
  const dossier = '../android/src/main/kotlin/fr/rechargeds3/coque/';
  for (const f of ['PontLocal.kt', 'OperationsCable.kt', 'RechercheCable.kt', 'MainActivity.kt', 'AttenteWifi.kt', 'EnvironnementAndroid.kt', 'CoffreCable.kt']) {
    assert.ok(!/java\.net\.|Socket\(|bindSocket\(/.test(lire(dossier + f).replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')) || f === 'EnvironnementAndroid.kt', `${f} ne doit pas ouvrir de connexion`);
  }
});

test('une seule instance d\'OperationsCable par processus : créée par ProprietaireCable, récupérée par l\'activité et le service', () => {
  const dossier = '../android/src/main/kotlin/fr/rechargeds3/coque/';
  const sans = (f) => lire(dossier + f).replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  for (const f of ['MainActivity.kt', 'PontLocal.kt', 'AttenteWifi.kt']) assert.ok(!/OperationsCable\(/.test(sans(f)), `${f} ne crée pas d'instance`);
  assert.match(sans('ProprietaireCable.kt'), /OperationsCable\(EnvironnementAndroid\(wifi, coffre\)\)/);
  assert.match(sans('MainActivity.kt'), /ProprietaireCable\.obtenir\(this\)/);
  assert.match(sans('AttenteWifi.kt'), /ProprietaireCable\.obtenir\(this\)\.operations\.oublierMemoire\(\)/);
  // demarrage et sortie de l'activité n'annulent que la page ; la mémoire est gardée si une attente est active.
  const pont = sans('PontLocal.kt');
  assert.ok(!/annulerTout\(\)/.test(pont), 'le pont n\'annule que les opérations de la page');
  assert.match(pont, /fun arreter\(garderMemoire: Boolean = false\)/);
  assert.match(sans('MainActivity.kt'), /pont\.arreter\(garderMemoire = AttenteWifi\.attenteEnCours\(\)\)/);
});
