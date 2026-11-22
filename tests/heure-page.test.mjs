// tools/heure-page.mjs : l'heure que les scénarios d'émulateur attendent de la page doit rester celle de la page.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { REGLAGES_PAR_DEFAUT, SOC_DE_DEPART, heurePage, demandePage, decisionPage, choisirTardif, heureParis } from '../tools/heure-page.mjs';
import { deciderPlage } from '../worker/src/service.js';

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

// Instants de l'hiver 2027 (UTC+1) : l'heure de Paris d'un instant « HH:MM » est HH:MM - 1 h en UTC.
const instant = (hhmm) => new Date(`2027-01-12T00:00:00Z`).getTime() + (minutes(hhmm) - 60) * 60000;

test('demandePage : le contrat du 2026-11-22 (début, fin, durée, départ) pour la batterie du cas', () => {
  assert.deepEqual(demandePage(39), { allumage: '00:35', fin: '06:00', duree_min: 325, depart: '07:30' });
  assert.equal(demandePage(80), null);
});

test('choisirTardif : de 20:00 à 07:13, un cas « tardif » qui le reste 6 minutes plus tard ; de 07:20 à 07:24 « trop_tard » ; en journée, aucun', () => {
  for (let n = 0; n < 1440; n++) {
    const h = hhmm(n);
    const c = choisirTardif(new Date(instant(h)));
    if (c) {
      assert.ok(c.soc >= 0 && c.soc < 80, `soc ${c.soc}`);
      assert.equal(c.debut, heurePage(c.soc));
      for (const plus of [0, 2, 4, 6]) {
        const r = deciderPlage(demandePage(c.soc), new Date(instant(hhmm(n + plus))));
        assert.equal(r.statut, c.cas, `à ${h} +${plus} min : ${c.debut} -> ${r.statut}, attendu ${c.cas}`);
      }
      assert.equal(decisionPage(c.soc, new Date(instant(h))), c.cas);
    } else {
      // Aucun cas : jamais entre 20:00 et 07:13 (heure calculée la plus tôt 19:25, marge de 6 minutes).
      assert.ok(n >= minutes('07:14') && n < minutes('20:00'), `aucun cas à ${h}`);
    }
  }
  assert.equal(choisirTardif(new Date(instant('23:00'))).cas, 'tardif');
  assert.equal(choisirTardif(new Date(instant('07:22'))).cas, 'trop_tard');
  assert.equal(choisirTardif(new Date(instant('14:00'))), null);
});

test('decisionPage : normal avant l\'heure calculée, variable à la limite des 10 minutes', () => {
  assert.equal(decisionPage(39, new Date(instant('21:00'))), 'normal'); // début 00:35
  assert.equal(decisionPage(39, new Date(instant('02:00'))), 'tardif');
  assert.equal(decisionPage(39, new Date(instant('00:20'))), 'variable'); // 00:25 : le début passe sous les 10 minutes
  assert.equal(decisionPage(39, new Date(instant('14:00'))), 'normal');
  assert.equal(decisionPage(80), 'aucun');
});

test('heureParis : format HH:MM', () => {
  assert.match(heureParis(new Date('2026-11-22T10:05:00Z')), /^11:05$/);
  assert.match(heureParis(new Date('2026-07-22T22:30:00Z')), /^00:30$/);
});
