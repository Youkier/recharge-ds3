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
  const pont = faussePont({ programmer: { ok: true, debut: '05:00', fin: '06:00', plage_active: true, tardif: false, courte: false } });
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

test("configuration : cable ne rend jamais de clé ; la page ne peut plus faire garder ni oublier la configuration", async () => {
  const pont = faussePont({ cable: { ok: true, configure: true, adresse: '10.0.2.2' } });
  const client = creerClientPont(pont);
  assert.equal((await client.cable()).configure, true);
  assert.deepEqual(pont.requetes.map((q) => q.op), ['cable']);
  for (const nom of ['memoriser', 'oublierMemoire']) assert.equal(client[nom], undefined, nom);
});

test("attente (E3) : quatre opérations, la demande et les heures partent, jamais de clé ; l'état et le résultat brut reviennent tels quels", async () => {
  const demande = { allumage: '00:35', fin: '06:00', duree_min: 300, depart: '07:30' };
  const resultat = { ok: true, debut: '00:35', fin: '06:00', plage_active: true, tardif: false, courte: false };
  const pont = faussePont({
    attenteDebut: { ok: true },
    attenteEtat: { ok: true, phase: 'terminee', demande, heureManuelle: { debut: '00:35', fin: '06:00' }, resultat },
    attenteAnnuler: { ok: true, annulee: false },
    attenteAcquitter: { ok: true },
    notifications: { ok: true, autorise: false },
    demanderNotifications: { ok: true, autorise: true },
  });
  const client = creerClientPont(pont);
  assert.equal((await client.attenteDebut(demande, { debut: '00:35', fin: '06:00' })).ok, true);
  const e = await client.attenteEtat();
  assert.deepEqual([e.phase, e.resultat], ['terminee', resultat]);
  assert.equal((await client.attenteAnnuler()).annulee, false);
  assert.equal((await client.attenteAcquitter()).ok, true);
  assert.equal((await client.notifications()).autorise, false);
  assert.equal((await client.demanderNotifications()).autorise, true);
  const { n, ...debut } = pont.requetes[0];
  assert.ok(Number.isInteger(n));
  assert.deepEqual(debut, { op: 'attenteDebut', demande, heureManuelle: { debut: '00:35', fin: '06:00' } });
  assert.deepEqual(pont.requetes.map((q) => q.op), ['attenteDebut', 'attenteEtat', 'attenteAnnuler', 'attenteAcquitter', 'notifications', 'demanderNotifications']);
  for (const nom of ['attenteFin', 'essaiArrierePlan']) assert.equal(client[nom], undefined, nom);
});

// Durées d'attente de la réponse du pont : le client attend la durée maximale du natif (OperationsCable, RechercheCable) plus une marge,
// sans quoi il rendrait « pont_muet » alors que le natif travaille encore (revue du 2026-11-22). Les durées natives sont lues dans
// le code Kotlin : un changement d'un côté sans l'autre fait échouer ce test.
test("durées d'attente du client alignées sur celles du code natif", async () => {
  const kt = (f) => lire('../android/src/main/kotlin/fr/rechargeds3/coque/' + f).replace(/\/\/.*$/gm, '');
  const nombre = (src, nom) => Number(src.match(new RegExp(nom + '\\s*=\\s*([0-9_]+)L'))[1].replace(/_/g, ''));
  const ops = kt('OperationsCable.kt');
  const recherche = kt('RechercheCable.kt');
  assert.equal(nombre(ops, 'DELAI_SECONDE_LECTURE_MS'), 8000);
  assert.equal(nombre(ops, 'BUDGET_ECRITURE_MS'), 27000);
  assert.equal(nombre(recherche, 'DELAI_TOTAL_MS'), 30000);
  assert.equal(nombre(recherche, 'DELAI_LECTURE_MS'), 8000);

  const delais = [];
  const vraiSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (f, ms, ...a) => { delais.push(ms); return vraiSetTimeout(f, 0, ...a); }; // le client rend aussitôt « pont_muet » : seules les durées comptent
  try {
    const client = creerClientPont({ postMessage() {}, onmessage: null }); // marge par défaut : 3 s
    await client.lire({}, 4000);
    await client.lire({ reessayer: true }, 4000);
    await client.programmer({ allumage: '05:00' }, {}, 20000);
    await client.programmer({ allumage: '05:00' }, { reessayer: true }, 20000);
    await client.programmer({ allumage: '05:00' }, { reessayer: true }, 30000);
    await client.chercher({}, null, 30000);
    await client.chercher({ reessayer: true }, null, 30000);
    await client.attenteEtat();
    await client.attenteDebut({}, {});
    await client.demanderNotifications();
  } finally {
    globalThis.setTimeout = vraiSetTimeout;
  }
  assert.deepEqual(delais, [
    4000 + 3000, // lecture : un seul essai
    4000 + 8000 + 3000, // lecture avec seconde tentative (8 s)
    20000 + 3000, // programmer : un seul essai
    27000 + 3000, // programmer avec seconde tentative : le budget de 27 s du natif
    30000 + 3000, // délai de 30 s : le natif borne la première tentative pour tenir dans 27 s ; le client attend 33 s au plus
    30000 + 3000, // recherche : un balayage
    2 * (30000 + 9000) + 3000, // recherche : deux balayages
    5000 + 3000, // attenteEtat
    15000 + 3000, // attenteDebut (lecture de la clé dans le magasin, démarrage du service)
    120000 + 3000, // fenêtre de permission des notifications
  ]);
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
  assert.deepEqual(ops, ['attenteAcquitter', 'attenteAnnuler', 'attenteDebut', 'attenteEtat', 'cable', 'chercher', 'demanderNotifications', 'demarrage',
    'essaiFiltre', 'lire', 'notifications', 'prefixeWifi', 'programmer', 'saisirCle', 'variante']);
  assert.match(kt, /RoutesPont\.autorisee\(op, estDebug\)/, 'toute opération passe par la table des routes');
  const routes = lire('../android/src/main/kotlin/fr/rechargeds3/coque/RoutesPont.kt');
  const entre = (nom) => [...routes.match(new RegExp(nom + ' = setOf\(([^)]*)\)'))[1].matchAll(/"(\w+)"/g)].map((m) => m[1]);
  assert.deepEqual(entre('MISE_AU_POINT'), ['essaiFiltre'], 'seule cette opération est réservée à la mise au point');
  assert.deepEqual([...entre('PUBLIQUES'), ...entre('MISE_AU_POINT')].sort(), ops);
  for (const interdit of ['ouvrir', 'envoyer', 'recevoir', 'fermer', 'sonder', 'retenirAdresse']) assert.ok(!ops.includes(interdit), interdit);
  // Seul le transport natif ouvre une connexion : aucun autre fichier de l'appli n'utilise de socket.
  const dossier = '../android/src/main/kotlin/fr/rechargeds3/coque/';
  for (const f of ['PontLocal.kt', 'OperationsCable.kt', 'RechercheCable.kt', 'MainActivity.kt', 'AttenteWifi.kt', 'EnvironnementAndroid.kt', 'CoffreCable.kt']) {
    assert.ok(!/java\.net\.|Socket\(|bindSocket\(/.test(lire(dossier + f).replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')) || f === 'EnvironnementAndroid.kt', `${f} ne doit pas ouvrir de connexion`);
  }
});

test("une seule instance d'OperationsCable et de PiloteAttente par processus : créées par ProprietaireCable, récupérées par l'activité et le service", () => {
  const dossier = '../android/src/main/kotlin/fr/rechargeds3/coque/';
  const sans = (f) => lire(dossier + f).replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  for (const f of ['MainActivity.kt', 'PontLocal.kt', 'AttenteWifi.kt']) {
    assert.ok(!/OperationsCable\(/.test(sans(f)), f + " ne crée pas d'instance");
    assert.ok(!/PiloteAttente\(/.test(sans(f)), f + ' ne crée pas de pilote');
  }
  assert.match(sans('ProprietaireCable.kt'), /val operations = OperationsCable\(env\)/);
  assert.match(sans('ProprietaireCable.kt'), /val pilote = PiloteAttente\(operations, env, StockageAttenteFichier\(/);
  assert.match(sans('MainActivity.kt'), /ProprietaireCable\.obtenir\(this\)/);
  assert.match(sans('AttenteWifi.kt'), /ProprietaireCable\.obtenir\(this\)/);
  // La sortie de l'activité n'annule que la page : l'attente appartient au service (balayer l'appli ne l'annule pas).
  const pont = sans('PontLocal.kt');
  assert.ok(!/annulerTout\(\)/.test(pont), "le pont n'annule que les opérations de la page");
  assert.match(pont, /fun arreter\(\) \{\s*travail\.shutdownNow\(\)\s*Thread \{ operations\.annulerPage\(\) \}\.start\(\)/);
  assert.match(sans('MainActivity.kt'), /pont\.arreter\(\)/);
  assert.ok(!/onTaskRemoved/.test(sans('AttenteWifi.kt')), "balayer l'appli n'annule plus l'attente");
  assert.ok(!/garderMemoire|oublierMemoire/.test(pont + sans('MainActivity.kt')), "la mémoire de la clé n'a qu'un maître : le pilote");
  // Une seule instance de l'activité (deux instances partageraient le Wi-Fi et les opérations).
  assert.match(lire('../android/src/main/AndroidManifest.xml'), /android:name="\.MainActivity"\s+android:launchMode="singleTask"/);
});
