// Notification de fin de l'attente en arrière-plan (appli 0.4.0) : ce que la page transmet au service (attenteFin).
// Relecture du 2026-11-21 : « Pas de charge ce soir » réussi est annoncé « Charge programmée : démarrage 05:59 ».
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { interpreterReponse } from '../site/service.js';
import { plageRelue, resultatNotification, heureNotification } from '../site/accueil.js';

function fin(demande, relu) {
  const res = interpreterReponse(demande, 200, relu, '06:00');
  return { res, resultat: resultatNotification({ res }), heure: heureNotification({ demande, finHC: '06:00', debutRelu: plageRelue(res).debut }) };
}

test('Charge programmée : résultat ok et début relu', () => {
  const f = fin({ allumage: '02:10' }, { ok: true, debut: '02:10', fin: '06:00', plage_active: true });
  assert.equal(f.res.etat, 'ok');
  assert.equal(f.resultat, 'ok');
  assert.equal(f.heure, '02:10');
});

test('Échec : résultat ko et heure à régler à la main', () => {
  const f = fin({ allumage: '02:10' }, { ok: false, erreur: 'inattendue' });
  assert.equal(f.resultat, 'ko');
  assert.equal(f.heure, '02:10');
});

test('Annulée : résultat annulee', () => {
  assert.equal(resultatNotification({ code: 'local_attente_annulee' }), 'annulee');
});

test('« Pas de charge ce soir » réussi ne doit pas être annoncé « Charge programmée »', () => {
  const f = fin({ desactiver: true }, { ok: true, debut: '05:59', fin: '06:00', plage_active: true, courte: true });
  assert.equal(f.res.etat, 'ok');
  assert.notEqual(f.resultat, 'ok');
});

test('Démarrage immédiat (heure passée) ne doit pas être annoncé « démarrage HH:MM »', () => {
  const f = fin({ allumage: '02:10' }, { ok: true, debut: '19:05', fin: '06:00', plage_active: true, immediat: true });
  assert.equal(f.res.etat, 'ok');
  assert.notEqual(f.resultat, 'ok');
});
