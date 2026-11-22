#!/usr/bin/env node
// Essais du Worker lancé en local (npx wrangler dev), sans afficher le jeton.
// Le jeton est lu dans worker/.dev.vars par ce script ; il n'est jamais affiché ni journalisé,
// et n'est envoyé qu'au Worker local (http://localhost:8787 ou 127.0.0.1).
//
// Usage :
//   node tools/essai-worker.mjs etat
//   node tools/essai-worker.mjs sans-jeton
//   node tools/essai-worker.mjs programmer HH:MM --confirmer   (écrit sur le câble si l'heure diffère)
//   node tools/essai-worker.mjs desactiver
//   node tools/essai-worker.mjs route-inconnue
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ICI = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.WORKER_LOCAL || 'http://localhost:8787';
const HEURE_VALIDE = /^([01]\d|2[0-3]):[0-5]\d$/;

function lireJeton() {
  const chemin = join(ICI, '..', 'worker', '.dev.vars');
  if (!existsSync(chemin)) throw new Error('worker/.dev.vars introuvable.');
  for (const brute of readFileSync(chemin, 'utf8').split(/\r?\n/)) {
    const m = brute.match(/^\s*(?:export\s+)?JETON_ACCES\s*=\s*(.*)$/);
    if (!m) continue;
    const v = m[1].trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
    if (v) return v;
  }
  throw new Error('JETON_ACCES absent de worker/.dev.vars.');
}

async function appeler(chemin, { methode = 'GET', corps, jeton = true } = {}) {
  const url = new URL(chemin, BASE);
  if (!['localhost', '127.0.0.1'].includes(url.hostname)) throw new Error('Refus : ce script ne parle qu\'au Worker local.');
  const entetes = {};
  if (jeton) entetes.Authorization = `Bearer ${lireJeton()}`;
  if (corps !== undefined) entetes['Content-Type'] = 'application/json';
  const debut = Date.now();
  const rep = await fetch(url, { method: methode, headers: entetes, body: corps === undefined ? undefined : JSON.stringify(corps), signal: AbortSignal.timeout(30000), redirect: 'error' });
  const texte = await rep.text();
  console.log(`${methode} ${url.pathname} -> HTTP ${rep.status} (${Date.now() - debut} ms)`);
  console.log(texte);
}

const [action, arg] = process.argv.slice(2);
const confirmer = process.argv.includes('--confirmer');
try {
  switch (action) {
    case 'etat': await appeler('/api/etat'); break;
    case 'sans-jeton': await appeler('/api/etat', { jeton: false }); break;
    case 'route-inconnue': await appeler('/api/commande'); break;
    case 'desactiver': await appeler('/api/programmer', { methode: 'POST', corps: { desactiver: true, fin: '06:00' } }); break;
    case 'programmer': {
      if (!HEURE_VALIDE.test(arg ?? '')) throw new Error('Usage : programmer HH:MM --confirmer');
      // Contrat du 2026-11-22 (démarrage tardif) : fin, durée et départ fixés pour l'essai (heures creuses 22:00-06:00, départ 07:30).
      const corps = { allumage: arg, fin: '06:00', duree_min: 420, depart: '07:30' };
      if (!confirmer) { console.log(`Simulation : enverrait ${JSON.stringify(corps)}. Ajouter --confirmer pour l'envoyer.`); break; }
      await appeler('/api/programmer', { methode: 'POST', corps });
      break;
    }
    default:
      console.log('Actions : etat | sans-jeton | route-inconnue | desactiver | programmer HH:MM --confirmer');
  }
} catch (e) {
  console.error('Erreur : ' + (e?.message ?? e));
  process.exitCode = 1;
}
