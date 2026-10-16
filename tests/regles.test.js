/*
 * Tests de docs/js/regles.js.
 * Lancement, depuis la racine du dépôt :  node tests/regles.test.js
 * Données : donnees/preuves.csv, donnees/fonctions.csv, donnees/parametres.json.
 * Les attendus du §7 du cahier des charges viennent du mémoire (synthèse du chapitre 3).
 */
"use strict";
const fs = require("fs");
const path = require("path");
const assert = require("assert");
const R = require("../docs/js/regles.js");

const RACINE = path.join(__dirname, "..");
const PARAMETRES = JSON.parse(fs.readFileSync(path.join(RACINE, "donnees", "parametres.json"), "utf8"));

// ---------------------------------------------------------------- lecture CSV
// Lecteur CSV minimal : virgule, guillemets doubles, BOM éventuel.
function lireCSV(fichier) {
  const brut = fs.readFileSync(path.join(RACINE, fichier), "utf8").replace(/^﻿/, "");
  const lignes = [];
  let champ = "", ligne = [], entreGuillemets = false;
  for (let i = 0; i < brut.length; i++) {
    const c = brut[i];
    if (entreGuillemets) {
      if (c === '"' && brut[i + 1] === '"') { champ += '"'; i++; }
      else if (c === '"') entreGuillemets = false;
      else champ += c;
    } else if (c === '"') entreGuillemets = true;
    else if (c === ",") { ligne.push(champ); champ = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && brut[i + 1] === "\n") i++;
      ligne.push(champ); champ = "";
      if (ligne.some(function (x) { return x !== ""; })) lignes.push(ligne);
      ligne = [];
    } else champ += c;
  }
  if (champ !== "" || ligne.length) { ligne.push(champ); lignes.push(ligne); }
  const entete = lignes.shift();
  return lignes.map(function (l) {
    const o = {};
    entete.forEach(function (cle, j) { o[cle] = l[j] === undefined ? "" : l[j]; });
    return o;
  });
}

// ---------------------------------------------------------------- mini-cadre de test
let reussis = 0, echecs = 0;
function test(nom, fn) {
  try { fn(); reussis++; console.log("  ok   " + nom); }
  catch (e) { echecs++; console.log("  ÉCHEC " + nom + "\n         " + e.message); }
}
function egal(obtenu, attendu, message) { assert.deepStrictEqual(obtenu, attendu, message); }
function section(titre) { console.log("\n" + titre); }

// ---------------------------------------------------------------- R3
section("R3 : confiance");
test("source indirecte → faible", function () { egal(R.confianceR3({ A: 2 }, false, true), "faible"); });
test("aucune source, absence de trace (R2) → moyenne", function () { egal(R.confianceR3({}, true, false), "moyenne"); });
test("aucune source, sans R2 → pas de confiance", function () { egal(R.confianceR3({}, false, false), "—"); });
test("deux sources dont une A → élevée", function () { egal(R.confianceR3({ A: 1, C: 1 }, false, false), "élevée"); });
test("deux sources A avec R2 → plafond moyenne", function () { egal(R.confianceR3({ A: 2 }, true, false), "moyenne"); });
test("une source C seule → faible", function () { egal(R.confianceR3({ C: 1 }, false, false), "faible"); });
test("plusieurs C sans A → moyenne", function () { egal(R.confianceR3({ C: 3 }, false, false), "moyenne"); });
test("une source A seule → moyenne", function () { egal(R.confianceR3({ A: 1 }, false, false), "moyenne"); });
test("une source B seule → moyenne", function () { egal(R.confianceR3({ B: 1 }, false, false), "moyenne"); });
test("sources D ignorées", function () { egal(R.compterSources("A;D;D;C"), { A: 1, B: 0, C: 1 }); });
test("deux sources A non convergentes → moyenne", function () { egal(R.confianceR3({ A: 2 }, false, false, false), "moyenne"); });
test("une A et une C non convergentes → moyenne", function () { egal(R.confianceR3({ A: 1, C: 1 }, false, false, false), "moyenne"); });
test("plusieurs C non convergentes → faible", function () { egal(R.confianceR3({ C: 2 }, false, false, false), "faible"); });
test("convergence non renseignée → considérée comme vraie", function () { egal(R.confianceR3({ A: 2 }, false, false, undefined), "élevée"); });

// ---------------------------------------------------------------- R5
section("R5 : agrégation");
const f = function (niveau, confiance) { return { niveau: niveau, confiance: confiance }; };
test("niveau le plus fréquent", function () {
  egal(R.agregerR5([f("structuré", "élevée"), f("structuré", "moyenne"), f("émergent", "faible")]).niveau, "structuré");
});
test("égalité → niveau inférieur", function () {
  egal(R.agregerR5([f("structuré", "élevée"), f("émergent", "moyenne")]).niveau, "émergent");
});
test("confiance = la plus faible des facteurs au niveau retenu", function () {
  egal(R.agregerR5([f("émergent", "élevée"), f("émergent", "moyenne"), f("structuré", "faible")]).confiance, "moyenne");
});
test("hors périmètre exclu du compte, non évaluable compté", function () {
  const r = R.agregerR5([f("émergent", "moyenne"), f("non évaluable", "—"), f("hors périmètre", "—")]);
  egal([r.evaluables, r.total], [1, 2]);
});
test("aucun facteur évaluable → non évaluable", function () {
  egal(R.agregerR5([f("non évaluable", "—")]).niveau, "non évaluable");
});
test("aspects : D1.1 (structuré, émergent, non évaluable) → émergent", function () {
  egal(R.niveauParAspects(["structuré", "émergent", "non évaluable"]), "émergent");
});

// ---------------------------------------------------------------- R6
section("R6 : priorité");
test("3 critères → 1", function () { egal(R.prioriteR6("émergent", true, true, true), 1); });
test("2 critères → 2", function () { egal(R.prioriteR6("émergent", false, true, true), 2); });
test("1 critère → 3", function () { egal(R.prioriteR6("émergent", false, true, false), 3); });
test("0 critère → 3", function () { egal(R.prioriteR6("émergent", false, false, false), 3); });
test("facteur structuré → non hiérarchisé", function () { egal(R.prioriteR6("structuré", true, true, true), null); });

// ---------------------------------------------------------------- facteurs mesurés
section("Facteurs mesurés (seuils lus dans parametres.json)");
const S = PARAMETRES.seuils_mesure_pct;
test("juste sous le seuil structuré → émergent", function () { egal(R.niveauMesure(S.structure - 1, PARAMETRES), "émergent"); });
test("au seuil structuré → structuré", function () { egal(R.niveauMesure(S.structure, PARAMETRES), "structuré"); });
test("juste sous le seuil consolidé → structuré", function () { egal(R.niveauMesure(S.consolide - 1, PARAMETRES), "structuré"); });
test("au seuil consolidé → consolidé", function () { egal(R.niveauMesure(S.consolide, PARAMETRES), "consolidé"); });
test("Wilson : cas limites dans [0, 100]", function () {
  [[0, 1], [1, 1], [0, 40], [40, 40], [20, 40]].forEach(function (c) {
    const iv = R.wilson(c[0], c[1], 95);
    egal(iv[0] >= 0 && iv[0] <= iv[1] && iv[1] <= 100, true);
  });
});
test("confiance : n = 1 → faible", function () { egal(R.confianceMesure(1, 1, PARAMETRES), "faible"); });
test("confiance : part nette sur grand échantillon → élevée", function () {
  egal(R.confianceMesure(5, 100, PARAMETRES), "élevée");
  egal(R.confianceMesure(100, 100, PARAMETRES), "élevée");
});
test("confiance : part proche d'un seuil → moyenne", function () { egal(R.confianceMesure(62, 100, PARAMETRES), "moyenne"); });
test("facteur : indicateur le moins avancé, confiance la plus faible, plus grand échantillon", function () {
  const r = R.facteurMesure([{ indicateur: "dnssec", pct: 50, n: 6, k: 3 },
                             { indicateur: "dmarc_applique", pct: 100, n: 100, k: 100 }], PARAMETRES);
  egal([r.niveau, r.confiance, r.n], ["émergent", "faible", 100]);
  // un indicateur plus avancé et peu précis ne dégrade pas la confiance du facteur
  const r2 = R.facteurMesure([{ indicateur: "hsts", pct: 5, n: 100, k: 5 },
                              { indicateur: "dmarc_applique", pct: 70, n: 3, k: 2 }], PARAMETRES);
  egal([r2.niveau, r2.confiance], ["émergent", "élevée"]);
});
test("facteur sans indicateur mesuré → non évaluable", function () {
  egal(R.facteurMesure([{ indicateur: "hsts", pct: null, n: 0 }], PARAMETRES).niveau, "non évaluable");
});
test("un autre jeu de paramètres change le résultat (pas de seuil en dur)", function () {
  const autres = JSON.parse(JSON.stringify(PARAMETRES));
  autres.seuils_mesure_pct.structure = S.structure + 10;
  egal(R.niveauMesure(S.structure + 5, autres), "émergent");
});

// ---------------------------------------------------------------- données du Sénégal (§7)
const preuves = lireCSV("donnees/preuves.csv");
const fonctions = R.lireFonctions(lireCSV("donnees/fonctions.csv"));
const aspects = lireCSV("donnees/aspects.csv");
const declarations = preuves.map(function (l) { return R.declarationDepuisPreuve(l, aspects); });
const resultat = R.evaluer(declarations, fonctions);
const dim = {};
resultat.dimensions.forEach(function (d) { dim[d.dimension] = [d.niveau, d.confiance, d.evaluables + " sur " + d.total]; });

section("Attendus du §7 (Sénégal, preuves.csv, sans mesure)");
test("23 facteurs et 3 aspects lus", function () { egal([preuves.length, aspects.length], [23, 3]); });
test("D1.1 : niveau tiré de ses aspects (R5) = émergent", function () {
  egal(resultat.facteurs[0].niveau, "émergent");
  egal(resultat.facteurs[0].aspects.map(function (a) { return a.aspect + " " + a.niveau; }),
    ["D1.1a émergent", "D1.1b émergent", "D1.1c non évaluable"]);
});
test("D1 : émergent, moyenne, 3 sur 3", function () { egal(dim.D1, ["émergent", "moyenne", "3 sur 3"]); });
test("D2 : émergent, faible, 3 sur 5", function () { egal(dim.D2, ["émergent", "faible", "3 sur 5"]); });
test("D3 : émergent, moyenne, 4 sur 4", function () { egal(dim.D3, ["émergent", "moyenne", "4 sur 4"]); });
test("D4 : structuré, moyenne, 4 sur 4", function () { egal(dim.D4, ["structuré", "moyenne", "4 sur 4"]); });
test("D5 : émergent, moyenne, 2 sur 6", function () { egal(dim.D5, ["émergent", "moyenne", "2 sur 6"]); });
function avecPriorite(p) {
  return resultat.facteurs.filter(function (x) { return x.priorite === p; }).map(function (x) { return x.facteur; });
}
test("priorité 1 : D1.1, D1.2", function () { egal(avecPriorite(1), ["D1.1", "D1.2"]); });
test("priorité 2 : D1.3, D5.1", function () { egal(avecPriorite(2), ["D1.3", "D5.1"]); });
test("priorité 3 : D2.1, D2.2, D3.1, D3.3, D3.4, D5.6", function () {
  egal(avecPriorite(3), ["D2.1", "D2.2", "D3.1", "D3.3", "D3.4", "D5.6"]);
});

section("Concordance avec l'évaluation manuelle du mémoire");
test("niveau identique au mémoire pour les 23 facteurs", function () {
  preuves.forEach(function (p, i) { egal(resultat.facteurs[i].niveau, R.normaliserNiveau(p.appreciation), p.facteur); });
});
const ecarts = [];
preuves.forEach(function (p, i) {
  if (resultat.facteurs[i].confiance !== R.normaliserConfiance(p.confiance_memoire)) {
    ecarts.push(p.facteur + " (outil " + resultat.facteurs[i].confiance + ", mémoire " + R.normaliserConfiance(p.confiance_memoire) + ")");
  }
});
test("confiance identique au mémoire pour les 23 facteurs", function () { egal(ecarts, []); });
test("confiance des aspects de D1.1 identique au mémoire", function () {
  aspects.forEach(function (a, i) {
    egal(resultat.facteurs[0].aspects[i].confiance, R.normaliserConfiance(a.confiance_memoire), a.aspect);
  });
});
test("portée R6 déduite du tableau 2.1 = colonne portee de preuves.csv", function () {
  preuves.filter(function (p) { return p.portee !== ""; }).forEach(function (p) {
    egal(R.porteeR6(p.facteur, fonctions), R.estOui(p.portee), p.facteur);
  });
});

section("Fonctions de résilience (choix nouveau, absent du mémoire : valeurs de contrôle)");
const fn = {};
resultat.fonctions.forEach(function (x) { fn[x.fonction] = [x.niveau, x.confiance, x.evaluables + " sur " + x.total]; });
test("Anticiper : émergent, moyenne, 4 sur 4", function () { egal(fn["Anticiper"], ["émergent", "moyenne", "4 sur 4"]); });
test("Résister : émergent, moyenne, 3 sur 6", function () { egal(fn["Résister"], ["émergent", "moyenne", "3 sur 6"]); });
test("Répondre et se rétablir : structuré, moyenne, 4 sur 4", function () {
  egal(fn["Répondre et se rétablir"], ["structuré", "moyenne", "4 sur 4"]);
});
test("S'adapter (aspect D1.1a) : émergent, moyenne, 3 sur 3", function () { egal(fn["S'adapter"], ["émergent", "moyenne", "3 sur 3"]); });
test("Contribution transversale : structuré, élevée, 3 sur 5", function () {
  egal(fn["Contribution transversale"], ["structuré", "élevée", "3 sur 5"]);
});

section("Cohérence des fichiers publiés (docs/data)");
function lireJSON(fichier) { return JSON.parse(fs.readFileSync(path.join(RACINE, fichier), "utf8")); }
test("docs/data/preuves.json = donnees/preuves.csv", function () { egal(lireJSON("docs/data/preuves.json"), preuves); });
test("docs/data/fonctions.json = donnees/fonctions.csv", function () {
  egal(lireJSON("docs/data/fonctions.json"), lireCSV("donnees/fonctions.csv"));
});
test("docs/data/aspects.json = donnees/aspects.csv", function () { egal(lireJSON("docs/data/aspects.json"), aspects); });
test("docs/data/parametres.json = donnees/parametres.json", function () {
  egal(lireJSON("docs/data/parametres.json"), PARAMETRES);
});

test("docs/data/gci2024.json = donnees/gci2024.csv", function () { egal(lireJSON("docs/data/gci2024.json"), lireCSV("donnees/gci2024.csv")); });

section("Pages du site");
const DOCS = path.join(RACINE, "docs");
const pages = fs.readdirSync(DOCS).filter(function (f) { return f.endsWith(".html"); });
const scripts = fs.readdirSync(path.join(DOCS, "js")).map(function (f) { return path.join("js", f); });
test("les 5 pages existent", function () {
  egal(pages.sort(), ["benchmark.html", "diagnostic.html", "index.html", "methode.html", "tableau-de-bord.html"]);
});
test("liens internes et scripts présents", function () {
  pages.forEach(function (page) {
    const html = fs.readFileSync(path.join(DOCS, page), "utf8");
    (html.match(/(?:href|src)="([^"#:]+)"/g) || []).forEach(function (m) {
      const cible = m.replace(/^(?:href|src)="/, "").replace(/"$/, "");
      assert.ok(fs.existsSync(path.join(DOCS, cible)), page + " → " + cible);
    });
  });
});
test("aucun seuil de niveau écrit en dur dans les pages et les scripts", function () {
  const S = PARAMETRES.seuils_mesure_pct;
  const motif = new RegExp("\\b(" + S.structure + "|" + S.consolide + ")\\s*%");
  pages.map(function (f) { return f; }).concat(scripts).forEach(function (f) {
    const texte = fs.readFileSync(path.join(DOCS, f), "utf8");
    assert.ok(!motif.test(texte), f + " contient un seuil écrit en dur");
  });
});
const methode = fs.readFileSync(path.join(DOCS, "methode.html"), "utf8");
if (methode.indexOf("À COMPLÉTER") >= 0) {
  console.log("  À FAIRE  page Méthode : définitions des niveaux de fiabilité A à D à insérer avant publication");
}

console.log("\n" + reussis + " tests réussis, " + echecs + " échec(s).");
process.exit(echecs === 0 ? 0 : 1);
