// Client JavaScript du pont de la coque Android. Module ES, aucune importation.
//
// Le pont natif (PontLocal.kt) est injecté par addWebMessageListener sous le nom window.PontLocal : on lui envoie une
// chaîne par postMessage et il répond par une chaîne dans onmessage. Les messages sont du JSON :
//   requête  { "n": <entier>, "op": "<opération>", ...paramètres }
//   réponse  { "n": <même entier>, "ok": true|false, ...résultat }  ou  { "n", "ok": false, "erreur": "<code>" }
//
// Depuis le lot E2 (décision du 2026-11-21), le protocole local tourne UNIQUEMENT dans le code natif (Kotlin) : la page
// demande des opérations de haut niveau et ne voit jamais la clé du câble. Il n'existe plus de route générique (ouvrir,
// envoyer, recevoir, sonder) : le pont répond « operation_inconnue ».
//
// Opérations sur le câble (une seule à la fois côté natif, sinon erreur occupe) :
//   lire { ip?, delai? }            -> { debut, fin, plage_active }
//   programmer { allumage:"HH:MM" | desactiver:true, ip?, delai? }
//                                   -> { debut, fin, plage_active, immediat, courte }   (lit, écrit, relit)
//                                      échec : { ok:false, erreur, ecrit? } ; ecrit:true = l'écriture est partie, ne jamais la relancer
//   chercher { ip? }                -> { ip, trouve, debut, fin, plage_active } | erreur introuvable
//                                      pendant la recherche : messages { n, progres:true, etape, appareils, lectures, echeance }
//   ip : adresse IPv4 privée à utiliser à la place de l'adresse retenue (filtrée côté natif) ; delai : millisecondes
//   (1000 à 30000, 20000 par défaut). L'adresse est retenue côté natif après une lecture, une écriture ou une recherche réussie.
//   Erreurs : cle, hors_ligne, delai, format, relecture_differente, requete_invalide, pas_de_cle, pas_wifi, sans_adresse,
//   refuse (adresse hors filtre), occupe, introuvable, pont_muet (pas de réponse du natif).
// Configuration :
//   demarrage                       -> { variante, auto }   coupe toute opération restée en cours (nouvelle page)
//   variante                        -> { variante: "debug" | "release" }
//   prefixeWifi                     -> { prefixe: "10.0.2" } | erreur pas_wifi
//   cable                           -> { configure, illisible?, adresse? }   jamais l'identifiant ni la clé
//   memoriser                       -> {} | erreur pas_de_cle   garde la configuration côté natif 15 min au plus (attente
//                                      en arrière-plan : la clé du magasin est illisible téléphone verrouillé)
//   oublierMemoire                  -> {}
//   saisirCle                       -> {}   ouvre l'écran natif de saisie
// Attente en arrière-plan (service de premier plan AttenteWifi, version publiée ; textes de notification FIXES côté
// Kotlin, la page ne fournit qu'une heure HH:MM validée et un résultat pris dans une liste fermée) :
//   notifications                   -> { autorise }   permission POST_NOTIFICATIONS accordée ET notifications activées
//   demanderNotifications           -> { autorise }   demande système ; réponse quand l'utilisateur a choisi (prévoir
//                                      un long délai d'attente), tout de suite si déjà accordée ou refus définitif ;
//                                      erreur occupe si une demande est déjà ouverte
//   attenteDebut { heure }          -> {}   | erreur requete_invalide, notifications, occupe, service ; notification
//                                      continue « En attente du Wi-Fi et du câble » avec « Annuler »
//   attenteEtat                     -> { active, annulee }   annulee : « Annuler » touché dans la notification
//   attenteFin { resultat: "ok"|"ko"|"annulee", heure?, incertain? } -> {}   notification de résultat (heure absente :
//                                      texte sans heure), puis arrêt du service et oubli de la configuration gardée
// Filets côté service : 15 min sans attenteFin -> « Résultat inconnu » ; appli fermée -> « Programmation non envoyée » ;
// 60 s après « Annuler » sans attenteFin -> « Résultat inconnu ».
// Mise au point seulement : essaiArrierePlan { quoi }, essaiFiltre (le transport natif refuse tout sauf IPv4 privée:6668).

const MARGE_REPONSE_MS = 3000; // attente de réponse du pont au-delà du délai demandé

export function creerClientPont(pont, { margeMs = MARGE_REPONSE_MS } = {}) {
  const attente = new Map();
  let n = 0;
  const client = {};

  pont.onmessage = (evt) => {
    let r;
    try { r = JSON.parse(evt.data); } catch { return; }
    if (!r || !Number.isInteger(r.n) || !attente.has(r.n)) return;
    const { resoudre, minuteur, surProgres } = attente.get(r.n);
    if (r.progres === true) { // avancement d'une opération longue : la réponse finale suit
      if (surProgres) { try { surProgres(r); } catch { /* sans effet */ } }
      return;
    }
    attente.delete(r.n);
    clearTimeout(minuteur);
    resoudre(r);
  };

  // Ne rejette jamais : une réponse manquante devient { ok:false, erreur:"pont_muet" }.
  client.appeler = (op, params = {}, delaiMs = 5000, surProgres = null) => new Promise((resoudre) => {
    const id = ++n;
    const minuteur = setTimeout(() => { attente.delete(id); resoudre({ n: id, ok: false, erreur: 'pont_muet' }); }, delaiMs + margeMs);
    attente.set(id, { resoudre, minuteur, surProgres });
    try { pont.postMessage(JSON.stringify({ n: id, op, ...params })); } catch {
      attente.delete(id); clearTimeout(minuteur); resoudre({ n: id, ok: false, erreur: 'pont_muet' });
    }
  });

  client.demarrage = () => client.appeler('demarrage');
  client.variante = () => client.appeler('variante');
  client.prefixeWifi = () => client.appeler('prefixeWifi');
  client.cable = () => client.appeler('cable');
  client.saisirCle = () => client.appeler('saisirCle');
  client.memoriser = () => client.appeler('memoriser');
  client.oublierMemoire = () => client.appeler('oublierMemoire');
  client.lire = (params = {}, delaiMs = 20000) => client.appeler('lire', { ...params, delai: delaiMs }, delaiMs);
  client.programmer = (action, params = {}, delaiMs = 20000) => client.appeler('programmer', { ...action, ...params, delai: delaiMs }, delaiMs);
  // surProgres (facultatif) reçoit { etape, appareils, lectures, echeance } ; une exception du rappel est ignorée.
  client.chercher = (params = {}, surProgres = null, delaiMs = 30000) =>
    client.appeler('chercher', params, delaiMs, surProgres);

  return client;
}
