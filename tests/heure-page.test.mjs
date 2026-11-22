// tools/heure-page.mjs : l'heure que les scénarios d'émulateur attendent de la page doit rester celle de la page.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { REGLAGES_PAR_DEFAUT, SOC_DE_DEPART, heurePage, choisirImmediat, heureParis } from '../tools/heure-page.mjs';

const lire = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const minutes = (h) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3));
const hhmm = (m) => { m = ((m % 1440) + 1440) % 1440; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };

test('les réglages par défaut recopient DEFAULTS de site/app.js', () => {
  const m = /var DEFAULTS = (\{[^}]*\});/.exec(lire('../site/app.js'));
  assert.ok(m, 'DEFAULTS introuvable dans site/app.js');
  const page = new Function(`return ${m[1]}`)();
  for (const [k, v] of Object.entries(REGLAGES_PAR_DEFAUT)) assert.equal(page[k], v, `réglage « ${k} » différent de la page`);
  assert.equal(page.soc, SOC_DE_DEPART, 'la batterie de départ de « Ajouter 1 % » est celle de la page');
});

test('heurePage : valeurs connues de la page (revue UX : 39 % -> 00:35), pas d\'heure au-dessus de l\'objectif', () => {
  assert.equal(heurePage(38), '00:25');
  assert.equal(heurePage(39), '00:35');
  assert.equal(heurePage(79), '05:50');
  assert.equal(heurePage(80), null);
  assert.equal(heurePage(100), null);
});

test('choisirImmediat : pour chaque minute de la journée, l\'heure est déjà passée pour le téléphone, même quelques minutes plus tard', () => {
  // Règle du téléphone (local/tuya-local.js, decider) : immédiat si l'heure actuelle est dans [début ; fin de la plage du câble).
  const dedans = (a, f, n) => (a < f ? n >= a && n < f : a > f ? n >= a || n < f : false);
  for (let n = 0; n < 1440; n++) {
    const c = choisirImmediat(hhmm(n));
    assert.ok(c.soc > SOC_DE_DEPART && c.soc < 80, `soc ${c.soc}`);
    assert.equal(c.debut, heurePage(c.soc));
    assert.equal(c.fin, hhmm(minutes(c.debut) - 1));
    for (const plus of [0, 1, 2, 3]) {
      assert.ok(dedans(minutes(c.debut), minutes(c.fin), (n + plus) % 1440), `à ${hhmm(n)} +${plus} min : ${c.debut} -> ${c.fin} pas immédiat`);
    }
  }
});

test('heureParis : format HH:MM', () => {
  assert.match(heureParis(new Date('2026-11-22T10:05:00Z')), /^11:05$/);
  assert.match(heureParis(new Date('2026-07-22T22:30:00Z')), /^00:30$/);
});
