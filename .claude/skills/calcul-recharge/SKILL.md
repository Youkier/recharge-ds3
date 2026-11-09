---
name: calcul-recharge
description: Règles de calcul de la recharge nocturne (durée, plage horaire, heures creuses, coût). À lire avant toute modification ou réimplémentation du calcul, et pour écrire ou vérifier les tests.
---

# Calcul de la recharge

La référence est la fonction `plan()` de la page validée (`site/index.html`, puis `site/calc.js` après extraction). Les sorties attendues sont dans `tests/golden-cases.json`. Cette skill décrit l'algorithme pour pouvoir le réimplémenter (application Android, Worker) ou le tester.

## Paramètres

| Clé | Sens | Défaut |
|---|---|---|
| `cap` | Capacité utile de la batterie (kWh) | 46 |
| `soh` | État de santé (%) | 92 |
| `target` | Batterie visée (%) | 80 |
| `dep` | Heure de départ `HH:MM` | 07:30 |
| `hcStart`, `hcEnd` | Heures creuses `HH:MM` (peuvent traverser minuit) | 22:00, 06:00 |
| `amp`, `volt` | Courant (A), tension (V) | 16, 230 |
| `eff` | Rendement de charge (%) | 90 |
| `pre` | Prise rallumée avant le départ (min) | 30 |
| `pHC`, `pHP` | Prix HC et HP (€/kWh) | 0.146688, 0.196476 |
| `mode` | `end` : finir à la fin des HC ; `start` : commencer au début des HC | end |
| `deduct` | Déduire la recharge pendant le préconditionnement | false |
| `soc` | Batterie restante saisie le soir (%) | – |

## Algorithme

Toutes les heures sont converties en minutes depuis minuit, puis exprimées **relativement au début des heures creuses** : `rel(x) = ((x - hcStart) mod 1440 + 1440) mod 1440`.

```
usable     = cap × soh / 100                      # kWh réellement disponibles
P          = amp × volt / 1000                    # kW tirés au réseau
rate       = P × eff / 100                        # kW reçus par la batterie
pctPerHour = rate / usable × 100                  # % gagnés par heure
preGain    = deduct ? rate × 0.5 × pre/60 / usable × 100 : 0
need       = target − soc − preGain               # % à charger en HC

hcLen  = rel(hcEnd) ou 1440 si 0
preRel = rel(dep − pre) ; depRel = rel(dep)
limit  = preRel < hcLen ? preRel : hcLen          # la charge s'arrête au plus tard ici
```

- Si `need ≤ 0` : statut `none`, aucune charge, `chargeMin = 0`, `offMin = 0`.
- Sinon `needMin = ceil(need / pctPerHour × 60 / 5) × 5` (arrondi au multiple de 5 min supérieur).
  - Si `needMin ≤ limit` : statut `ok`.
    - `mode = end` : `endRel = limit`, `startRel = floor((limit − needMin) / 5) × 5`
    - `mode = start` : `startRel = 0`, `endRel = needMin`
  - Si `needMin > limit` : statut `short` (quel que soit le mode) : `endRel = limit`, `startRel = max(floor((limit − needMin) / 5) × 5, depRel + 30 − 1440)`. `startRel` est alors négatif : la charge démarre avant les heures creuses.
- `chargeMin = endRel − startRel`
- `offMin = max(0, −startRel) + max(0, endRel − hcLen)` : minutes hors heures creuses
- `charged = chargeMin / 60 × pctPerHour`
- `arrival = min(100, soc + charged + preGain)` : batterie estimée après recharge
- `kwh = chargeMin / 60 × P` : énergie injectée
- `kwhHP = offMin / 60 × P` ; `kwhHC = kwh − kwhHP`
- `cost = kwhHC × pHC + kwhHP × pHP` (le préconditionnement n'est pas compté)
- Heures affichées : `start = hcStart + startRel`, `end = hcStart + endRel`, formatées `HH:MM` modulo 24 h.

## Conventions

- Affichage : virgule décimale, énergie à 0,1 kWh, coût à 0,01 €, batterie estimée arrondie à l'unité.
- La programmation fixe de la prise (extinction à `hcEnd`, rallumage à `dep − pre`, extinction à `dep + 30`) est indépendante du calcul et n'est jamais modifiée par le service.

## Tests

- `tests/golden-cases.json` : 13 cas avec entrée complète et sortie attendue. Tolérances : 0,05 kWh, 0,005 €, égalité stricte pour le reste.
- Ne jamais modifier une sortie attendue pour faire passer un test. Un écart signale un bug, ou une décision à soumettre à Mathieu.
- Cas limites utiles à ajouter : cible 100 %, `soc` supérieur à la cible, heures creuses ne traversant pas minuit (par exemple 01:00–07:00), départ pendant les heures creuses, courant ou capacité à 0 (la page affiche « Paramètres incomplets »).
