// Écriture du début de plage : seul « ss » change, tout format inattendu est refusé (hors ligne).
import { test } from "node:test";
import assert from "node:assert/strict";
import { formaterDebut, CODE_DEBUT_PLAGE } from "../tools/tuya-probe.mjs";

const ACTUELLE = '{"m":2,"dt":0,"ss":"04:00","se":"06:00"}';

test("code du point de données identifié en T2", () => {
  assert.equal(CODE_DEBUT_PLAGE, "x_charge_mode");
});

test("seul le début change, format identique", () => {
  assert.equal(formaterDebut("00:35", ACTUELLE), '{"m":2,"dt":0,"ss":"00:35","se":"06:00"}');
});

test("heure invalide refusée", () => {
  for (const h of ["24:00", "7:30", "07:60", "", "07:30:00", null]) assert.throws(() => formaterDebut(h, ACTUELLE));
});

test("plage désactivée (m = 0) : le début est réglé ET la plage réactivée (m = 2)", () => {
  assert.equal(formaterDebut("00:35", '{"m":0,"dt":0,"ss":"04:00","se":"06:00"}'), '{"m":2,"dt":0,"ss":"00:35","se":"06:00"}');
});

test("mode inconnu refusé", () => {
  for (const m of [1, 3, "2", null]) {
    assert.throws(() => formaterDebut("00:35", JSON.stringify({ m, dt: 0, ss: "04:00", se: "06:00" })), /inconnu/);
  }
});

test("format inattendu refusé", () => {
  for (const v of ["", "pas du json", "[]", "{}", '{"m":2,"ss":"04:00","se":"06:00"}', '{"m":2,"dt":0,"ss":"04:00","se":"06:00","x":1}', '{"m":2,"dt":0,"ss":"4h","se":"06:00"}']) {
    assert.throws(() => formaterDebut("00:35", v), undefined, v);
  }
});
