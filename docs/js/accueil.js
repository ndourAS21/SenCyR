/*
 * accueil.js : repères chiffrés de la grille, lus dans les données (aucune valeur en dur) :
 * facteurs, dimensions, fonctions de résilience (tableau 2.1, hors contribution
 * transversale) et pays comparés.
 */
(function () {
  "use strict";
  const C = window.Commun, R = window.SenCyR;

  Promise.all([C.chargerJSON("data/preuves.json"), C.chargerJSON("data/fonctions.json"), C.chargerJSON("data/parametres.json")])
    .then(function (d) {
      const preuves = d[0], fonctions = R.lireFonctions(d[1]), P = d[2];
      const dimensions = preuves.map(function (l) { return l.dimension; })
        .filter(function (x, i, t) { return x && t.indexOf(x) === i; });
      const reperes = [
        { n: preuves.length, libelle: "facteurs du CMM 2021" },
        { n: dimensions.length, libelle: "dimensions" },
        { n: fonctions.filter(function (f) { return !R.estTransversale(f.fonction); }).length, libelle: "fonctions de résilience" },
        { n: Object.keys(P.pays).length, libelle: "pays comparés" }
      ];
      document.getElementById("reperes").innerHTML = reperes.map(function (r) {
        return "<div class=\"repere\"><strong>" + C.compteur(r.n) + "</strong><span>" + C.echapper(r.libelle) + "</span></div>";
      }).join("");
    })
    .catch(function () { document.getElementById("reperes").remove(); });
})();
