// La confirmation du % de batterie survit à un rechargement de la page (changement de thème : activité et WebView recréées),
// avec la même validité que la confirmation (moins de 6 h, même jour), et jamais d'un soir à l'autre.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { confirmationAEnregistrer, confirmationRestauree, VALIDITE_CONFIRMATION_MS } from '../site/accueil.js';

const t0 = new Date(2027, 0, 12, 18, 30).getTime();

test('enregistrement : instant et % ; rien si l\'un des deux manque', () => {
  assert.deepEqual(JSON.parse(confirmationAEnregistrer(t0, 39)), { le: t0, soc: 39 });
  assert.equal(confirmationAEnregistrer(null, 39), null);
  assert.equal(confirmationAEnregistrer(t0, null), null);
});

test('rechargement quelques secondes plus tard, même % : la confirmation revient avec son instant d\'origine', () => {
  const brut = confirmationAEnregistrer(t0, 39);
  assert.equal(confirmationRestauree(brut, t0 + 5000, 39), t0);
  assert.equal(confirmationRestauree(brut, t0 + 3 * 3600 * 1000, 39), t0); // 21:30 : encore valable
});

test('jamais d\'un soir à l\'autre ni au-delà de 6 h, même durée de validité que la confirmation', () => {
  const brut = confirmationAEnregistrer(t0, 39);
  assert.equal(confirmationRestauree(brut, t0 + VALIDITE_CONFIRMATION_MS + 1, 39), null);
  assert.equal(confirmationRestauree(brut, new Date(2027, 0, 13, 7, 0).getTime(), 39), null); // lendemain matin, moins de 13 h
  assert.equal(confirmationRestauree(brut, new Date(2027, 0, 13, 18, 30).getTime(), 39), null);
  assert.equal(confirmationRestauree(brut, t0 - 1000, 39), null); // horloge revenue en arrière
});

test('autre % affiché, ou valeur absente ou illisible : pas de confirmation', () => {
  const brut = confirmationAEnregistrer(t0, 39);
  assert.equal(confirmationRestauree(brut, t0 + 1000, 40), null);
  assert.equal(confirmationRestauree(brut, t0 + 1000, null), null);
  for (const x of [null, undefined, '', 'pas du json', '[]', 'null', '{"le":"x","soc":39}', '{"soc":39}', '{"le":1,"soc":"39"}']) {
    assert.equal(confirmationRestauree(x, t0 + 1000, 39), null, String(x));
  }
});

test('page : lue avant tout setConfirme, enregistrée à chaque confirmation, effacée à chaque perte de confirmation', () => {
  const app = readFileSync(new URL('../site/app.js', import.meta.url), 'utf8');
  assert.match(app, /var confirmationReprise = confirmationRestauree\(lsGet\(CLE_CONFIRMATION\)[\s\S]*?\n\s*loadService\(\); chargerVehicules\(\); render\(\);/);
  assert.match(app, /setConfirme\(confirmationReprise !== null \|\|/);
  assert.match(app, /if \(brut\) lsSet\(CLE_CONFIRMATION, brut\); else lsDel\(CLE_CONFIRMATION\);/);
});

test('page : updateSend chaque minute quand la page est visible, et au retour au premier plan', () => {
  const app = readFileSync(new URL('../site/app.js', import.meta.url), 'utf8');
  assert.match(app, /setInterval\(function \(\) \{ if \(!document\.hidden\) \{ try \{ updateSend\(\); \} catch \(e\)[^}]*\} \} \}, 60000\);/);
  assert.match(app, /verifierConfirmation\(\);\s*updateSend\(\);/);
});
