/*
 * regles.js : règles d'évaluation de la grille SenCyR.
 *
 * Source des règles : mémoire, tableaux 2.1 (fonctions de résilience), 2.2 (échelle)
 * et 2.3 (règles R1 à R6). Les seuils de mesure et de taille d'échantillon ne sont
 * jamais écrits ici : ils sont lus dans parametres.json et passés en argument.
 *
 * Le même fichier sert dans le navigateur (objet global SenCyR) et dans Node
 * (require), pour que les tests vérifient exactement le code publié.
 */
(function (racine) {
  "use strict";

  // ---------------------------------------------------------------- échelle (tableau 2.2)
  // Ordre du moins avancé au plus avancé : l'indice sert aux comparaisons.
  const NIVEAUX = ["émergent", "structuré", "consolidé"];
  // Statuts hors échelle : ils n'entrent dans aucun calcul de niveau.
  const NON_EVALUABLE = "non évaluable";
  const HORS_PERIMETRE = "hors périmètre";
  // Confiance, de la plus faible à la plus forte (R3).
  const CONFIANCES = ["faible", "moyenne", "élevée"];
  // Valeur affichée quand une confiance n'a pas de sens (facteur non évaluable).
  const SANS_CONFIANCE = "—";

  // Intitulés des dimensions (CMM 2021, synthèse du chapitre 3).
  const DIMENSIONS = {
    D1: "Politique et stratégie",
    D2: "Culture et société",
    D3: "Connaissances et capacités",
    D4: "Cadres juridiques et réglementaires",
    D5: "Normes et technologies"
  };

  // ---------------------------------------------------------------- outils de lecture
  function texte(v) {
    return String(v === undefined || v === null ? "" : v).trim();
  }

  // Minuscules sans accents, pour comparer « Émergent », « emergent », « émergent ».
  function sansAccent(v) {
    return texte(v).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  }

  // « Oui », « Oui (Autorité) », true → vrai ; tout le reste → faux.
  function estOui(v) {
    return v === true || sansAccent(v).indexOf("oui") === 0;
  }

  // Ramène une appréciation écrite librement à un niveau ou statut de l'échelle.
  function normaliserNiveau(v) {
    const t = sansAccent(v);
    if (t.indexOf("emerg") === 0) return "émergent";
    if (t.indexOf("struct") === 0) return "structuré";
    if (t.indexOf("consol") === 0) return "consolidé";
    if (t.indexOf("hors") === 0) return HORS_PERIMETRE;
    return NON_EVALUABLE;   // vide, « non évaluable » ou valeur inconnue
  }

  function normaliserConfiance(v) {
    const t = sansAccent(v);
    if (t.indexOf("faib") === 0) return "faible";
    if (t.indexOf("moy") === 0) return "moyenne";
    if (t.indexOf("elev") === 0) return "élevée";
    return SANS_CONFIANCE;
  }

  function estNiveau(n) {
    return NIVEAUX.indexOf(n) >= 0;
  }

  // « A;A;C;D » → { A: 2, B: 0, C: 1 }. Les sources D ne sont pas comptées (R3).
  function compterSources(liste) {
    const compte = { A: 0, B: 0, C: 0 };
    texte(liste).split(/[;,\s]+/).forEach(function (x) {
      const n = x.trim().toUpperCase();
      if (n in compte) compte[n] += 1;
    });
    return compte;
  }

  // ---------------------------------------------------------------- R3 : confiance
  /*
   * R3 (tableau 2.3). La confiance porte sur la justesse du niveau attribué, non sur la
   * maturité.
   *  - source indirecte                        → faible
   *  - aucune source A, B ou C :
   *      niveau fondé sur l'absence de trace (R2) → moyenne
   *      sinon                                  → pas de confiance (« — »)
   *  - convergence : les sources concordent sur le niveau attribué, pas seulement sur
   *    l'existence d'un dispositif ou d'une intention ;
   *  - sources non convergentes : aucune ne recoupe les autres, le niveau repose sur
   *    une source non recoupée → moyenne s'il y a une source A ou B, faible si
   *    seulement des sources C (« source C seule »)
   *  - sources convergentes :
   *      au moins deux sources dont une A       → élevée
   *      une seule source, de niveau C          → faible
   *      autres cas (une A ou une B seule, plusieurs B ou C sans A) → moyenne
   *  - plafond : si le niveau repose sur l'absence de trace (R2), élevée devient moyenne.
   * Les sources D sont ignorées.
   * sources : { A, B, C } (nombres) ; absenceR2, indirecte, convergentes : booléens.
   * convergentes non renseigné → considéré comme vrai (valeur par défaut de preuves.csv).
   */
  function confianceR3(sources, absenceR2, indirecte, convergentes) {
    if (indirecte) return "faible";
    const a = sources.A || 0, b = sources.B || 0, c = sources.C || 0;
    const total = a + b + c;
    if (total === 0) return absenceR2 ? "moyenne" : SANS_CONFIANCE;
    let confiance;
    if (convergentes === false) confiance = (a + b > 0) ? "moyenne" : "faible";
    else if (total >= 2 && a >= 1) confiance = "élevée";
    else if (total === 1 && c === 1) confiance = "faible";
    else confiance = "moyenne";
    if (absenceR2 && confiance === "élevée") confiance = "moyenne";
    return confiance;
  }

  // ---------------------------------------------------------------- R5 : agrégation
  /*
   * R5, facteur décomposé en aspects : le facteur prend le niveau de son aspect
   * évaluable le moins avancé. Aucun aspect évaluable → facteur non évaluable.
   * niveaux : liste de niveaux ou statuts, un par aspect.
   */
  function niveauParAspects(niveaux) {
    const evaluables = niveaux.filter(estNiveau);
    if (evaluables.length === 0) return NON_EVALUABLE;
    return evaluables.reduce(function (plusBas, n) {
      return NIVEAUX.indexOf(n) < NIVEAUX.indexOf(plusBas) ? n : plusBas;
    });
  }

  /*
   * R5, dimension (tableau 2.3) ; même calcul pour une fonction de résilience.
   *  - niveau = le plus fréquent parmi les facteurs évaluables ;
   *    en cas d'égalité, le niveau inférieur est retenu ;
   *  - confiance = la plus faible parmi les facteurs qui ont ce niveau ;
   *  - « n facteurs évaluables sur m » : m exclut les facteurs hors périmètre ;
   *  - aucun facteur évaluable → non évaluable.
   * facteurs : liste de { niveau, confiance }.
   */
  function agregerR5(facteurs) {
    const pris = facteurs.filter(function (f) { return f.niveau !== HORS_PERIMETRE; });
    const evaluables = pris.filter(function (f) { return estNiveau(f.niveau); });
    if (evaluables.length === 0) {
      return { niveau: NON_EVALUABLE, confiance: SANS_CONFIANCE, evaluables: 0, total: pris.length };
    }
    // Parcours du plus bas au plus haut avec une comparaison stricte (>) :
    // à fréquence égale, le niveau le plus bas déjà retenu est conservé.
    let retenu = null, frequenceMax = 0;
    NIVEAUX.forEach(function (n) {
      const frequence = evaluables.filter(function (f) { return f.niveau === n; }).length;
      if (frequence > frequenceMax) { frequenceMax = frequence; retenu = n; }
    });
    const confiances = evaluables
      .filter(function (f) { return f.niveau === retenu && CONFIANCES.indexOf(f.confiance) >= 0; })
      .map(function (f) { return f.confiance; });
    const confiance = confiances.length === 0 ? SANS_CONFIANCE : confiances.reduce(function (plusFaible, c) {
      return CONFIANCES.indexOf(c) < CONFIANCES.indexOf(plusFaible) ? c : plusFaible;
    });
    return { niveau: retenu, confiance: confiance, evaluables: evaluables.length, total: pris.length };
  }

  // ---------------------------------------------------------------- R6 : priorité
  /*
   * R6 (tableau 2.3). Seuls les facteurs émergents sont des lacunes à hiérarchiser.
   * Trois critères : portée, exposition, faisabilité.
   * 3 critères réunis → priorité 1 ; 2 → priorité 2 ; 1 ou 0 → priorité 3.
   * Facteur non émergent → null (recommandation non hiérarchisée).
   */
  function prioriteR6(niveau, portee, exposition, faisabilite) {
    if (niveau !== "émergent") return null;
    const criteres = [portee, exposition, faisabilite].filter(Boolean).length;
    if (criteres === 3) return 1;
    if (criteres === 2) return 2;
    return 3;
  }

  /*
   * Critère de portée de R6, déduit du tableau 2.1 : le facteur conditionne la fonction
   * « répondre et se rétablir », ou au moins deux des quatre fonctions ; la ligne
   * « contribution transversale » n'est pas comptée.
   * fonctions : liste de { fonction, facteurs: [..] }.
   */
  function porteeR6(facteur, fonctions) {
    const concernees = fonctions.filter(function (f) {
      return !estTransversale(f.fonction) && f.facteurs.some(function (code) {
        return codeFacteur(code) === facteur;   // D1.1a compte pour D1.1
      });
    });
    const repondre = concernees.some(function (f) { return sansAccent(f.fonction).indexOf("repondre") === 0; });
    return repondre || concernees.length >= 2;
  }

  function estTransversale(nomFonction) {
    return sansAccent(nomFonction).indexOf("contribution") === 0;
  }

  // Code d'un aspect → code de son facteur : « D1.1a » → « D1.1 ».
  function codeFacteur(code) {
    return texte(code).replace(/[a-z]$/, "");
  }

  // ---------------------------------------------------------------- facteurs mesurés
  /*
   * Niveau d'un indicateur mesuré selon le taux de domaines conformes (en %).
   * Seuils lus dans parametres.json (seuils_mesure_pct).
   */
  function niveauMesure(pourcentage, parametres) {
    const s = parametres.seuils_mesure_pct;
    if (pourcentage < s.structure) return "émergent";
    if (pourcentage < s.consolide) return "structuré";
    return "consolidé";
  }

  /*
   * Confiance d'un indicateur mesuré : intervalle de Wilson de la part k/n.
   * Élevée si l'intervalle reste dans la bande du niveau, moyenne s'il déborde sur une
   * bande voisine, faible s'il couvre les trois bandes. Ce n'est pas R3 (écart E7).
   * Niveau de confiance lu dans parametres.json (confiance_mesure).
   */
  const Z_WILSON = { 90: 1.645, 95: 1.96, 99: 2.576 };

  function wilson(k, n, niveauPct) {
    const z = Z_WILSON[Math.round(niveauPct)];
    const p = k / n;
    const d = 1 + z * z / n;
    const centre = (p + z * z / (2 * n)) / d;
    const demi = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d;
    return [Math.max(0, centre - demi) * 100, Math.min(1, centre + demi) * 100];
  }

  function bande(pct, parametres) {
    const s = parametres.seuils_mesure_pct;
    return pct < s.structure ? 0 : pct < s.consolide ? 1 : 2;
  }

  function confianceMesure(k, n, parametres) {
    const iv = wilson(k, n, parametres.confiance_mesure.niveau_confiance_pct);
    const couvertes = bande(iv[1], parametres) - bande(iv[0], parametres) + 1;
    return ["élevée", "moyenne", "faible"][couvertes - 1];
  }

  /*
   * Facteur mesuré : chaque indicateur donne un niveau ; le facteur prend l'indicateur le
   * moins avancé et la plus faible des confiances de ses indicateurs. n retenu : le plus
   * grand parmi les indicateurs (DNSSEC est compté par zone, donc sur moins d'éléments ;
   * ce comptage est fait par le moteur).
   * indicateurs : liste de { indicateur, pct, n, k } déjà agrégés par le moteur.
   * Si k est absent, il est déduit de pct et n.
   */
  function facteurMesure(indicateurs, parametres) {
    const valides = indicateurs.filter(function (i) { return i.pct !== null && i.pct !== undefined && i.n > 0; });
    if (valides.length === 0) return { niveau: NON_EVALUABLE, confiance: SANS_CONFIANCE, n: 0 };
    const niveau = niveauParAspects(valides.map(function (i) { return niveauMesure(i.pct, parametres); }));
    const ordre = ["faible", "moyenne", "élevée"];
    // confiance du facteur : la plus faible parmi les indicateurs qui fixent son niveau
    const confiances = valides.filter(function (i) { return niveauMesure(i.pct, parametres) === niveau; }).map(function (i) {
      const k = (i.k !== undefined && i.k !== null) ? i.k : Math.floor(i.pct * i.n / 100 + 0.5);
      return confianceMesure(k, i.n, parametres);
    });
    const confiance = confiances.reduce(function (a, c) { return ordre.indexOf(c) < ordre.indexOf(a) ? c : a; });
    const n = Math.max.apply(null, valides.map(function (i) { return i.n; }));
    return { niveau: niveau, confiance: confiance, n: n };
  }

  // ---------------------------------------------------------------- données
  // Ligne de fonctions.csv (ou fonctions.json) → { fonction, facteurs: [..] }.
  function lireFonctions(lignes) {
    return lignes.map(function (l) {
      return {
        fonction: texte(l.fonction),
        facteurs: texte(l.facteurs).split(/[;,\s]+/).filter(Boolean)
      };
    });
  }

  // Colonne « convergentes » : vide ou absente → oui (valeur par défaut).
  function estConvergent(v) {
    return texte(v) === "" ? true : estOui(v);
  }

  // Ligne de aspects.csv (ou aspects.json) → aspect déclaré.
  function aspectDepuisLigne(l) {
    return {
      aspect: texte(l.aspect || l["﻿aspect"]),
      facteur: texte(l.facteur),
      intitule: texte(l.intitule),
      niveau: normaliserNiveau(l.appreciation),
      sources: compterSources(l.niveaux),
      absenceR2: estOui(l.absence_R2),
      indirecte: estOui(l.indirecte),
      convergentes: estConvergent(l.convergentes)
    };
  }

  // Ligne de preuves.csv (ou preuves.json) → déclaration au format du formulaire.
  // lignesAspects (facultatif) : lignes de aspects.csv ; celles du facteur lui sont rattachées.
  function declarationDepuisPreuve(l, lignesAspects) {
    const facteur = texte(l.facteur || l["﻿facteur"]);
    const aspects = (Array.isArray(lignesAspects) ? lignesAspects : []).map(aspectDepuisLigne)
      .filter(function (a) { return a.facteur === facteur; });
    return {
      facteur: facteur,
      intitule: texte(l.intitule),
      dimension: texte(l.dimension) || facteur.slice(0, 2),
      niveau: normaliserNiveau(l.appreciation),
      sources: compterSources(l.niveaux),
      absenceR2: estOui(l.absence_R2),
      indirecte: estOui(l.indirecte),
      convergentes: estConvergent(l.convergentes),
      exposition: estOui(l.exposition),
      faisabilite: estOui(l.faisabilite),
      recommandation: texte(l.recommandation),
      fonctionRecommandation: texte(l.fonction),
      aspects: aspects
    };
  }

  // ---------------------------------------------------------------- évaluation complète
  // R3 appliquée à un facteur ou à un aspect ; pas de confiance s'il n'est pas évaluable.
  function confianceDeclaree(d) {
    return estNiveau(d.niveau) ? confianceR3(d.sources, d.absenceR2, d.indirecte, d.convergentes) : SANS_CONFIANCE;
  }

  /*
   * Applique la grille à une liste de déclarations (une par facteur) :
   * R5 pour les facteurs décomposés en aspects, R3 par facteur et par aspect,
   * R6 par facteur émergent, R5 par dimension et par fonction.
   */
  function evaluer(declarations, fonctions) {
    const facteurs = declarations.map(function (d) {
      const aspects = (d.aspects || []).map(function (a) {
        return { aspect: a.aspect, facteur: d.facteur, intitule: a.intitule, niveau: a.niveau, confiance: confianceDeclaree(a) };
      });
      // R5 : un facteur décomposé en aspects prend le niveau de son aspect évaluable le moins avancé.
      // Sa confiance reste celle que R3 donne à l'ensemble de ses sources.
      const niveau = aspects.length > 0
        ? niveauParAspects(aspects.map(function (a) { return a.niveau; }))
        : d.niveau;
      const portee = porteeR6(d.facteur, fonctions);
      return {
        facteur: d.facteur,
        intitule: d.intitule,
        dimension: d.dimension,
        niveau: niveau,
        confiance: confianceDeclaree({ niveau: niveau, sources: d.sources, absenceR2: d.absenceR2,
          indirecte: d.indirecte, convergentes: d.convergentes }),
        portee: portee,
        exposition: !!d.exposition,
        faisabilite: !!d.faisabilite,
        priorite: prioriteR6(niveau, portee, d.exposition, d.faisabilite),
        recommandation: d.recommandation || "",
        fonctionRecommandation: d.fonctionRecommandation || "",
        aspects: aspects
      };
    });

    const codes = facteurs.map(function (f) { return f.dimension; })
      .filter(function (d, i, t) { return t.indexOf(d) === i; })
      .sort();
    const dimensions = codes.map(function (code) {
      const r = agregerR5(facteurs.filter(function (f) { return f.dimension === code; }));
      r.dimension = code;
      r.intitule = DIMENSIONS[code] || "";
      return r;
    });

    // Le tableau 2.1 cite des facteurs (D1.1) et des aspects (D1.1a) : les deux sont indexés.
    const parCode = {};
    facteurs.forEach(function (f) {
      parCode[f.facteur] = f;
      f.aspects.forEach(function (a) { parCode[a.aspect] = a; });
    });
    const parFonction = fonctions.map(function (fn) {
      // Un code du tableau 2.1 absent des déclarations compte comme non évaluable.
      const liste = fn.facteurs.map(function (code) {
        return parCode[code] || { niveau: NON_EVALUABLE, confiance: SANS_CONFIANCE };
      });
      const r = agregerR5(liste);
      r.fonction = fn.fonction;
      r.facteurs = fn.facteurs.slice();
      return r;
    });

    const priorites = facteurs
      .filter(function (f) { return f.priorite !== null; })
      .sort(function (x, y) { return x.priorite - y.priorite || x.facteur.localeCompare(y.facteur); });

    return { facteurs: facteurs, dimensions: dimensions, fonctions: parFonction, priorites: priorites };
  }

  const SenCyR = {
    NIVEAUX: NIVEAUX, CONFIANCES: CONFIANCES, NON_EVALUABLE: NON_EVALUABLE,
    HORS_PERIMETRE: HORS_PERIMETRE, SANS_CONFIANCE: SANS_CONFIANCE, DIMENSIONS: DIMENSIONS,
    estOui: estOui, estNiveau: estNiveau, normaliserNiveau: normaliserNiveau,
    normaliserConfiance: normaliserConfiance, compterSources: compterSources,
    confianceR3: confianceR3, niveauParAspects: niveauParAspects, agregerR5: agregerR5,
    prioriteR6: prioriteR6, porteeR6: porteeR6, estTransversale: estTransversale, codeFacteur: codeFacteur,
    niveauMesure: niveauMesure, wilson: wilson, confianceMesure: confianceMesure,
    facteurMesure: facteurMesure, lireFonctions: lireFonctions,
    aspectDepuisLigne: aspectDepuisLigne, declarationDepuisPreuve: declarationDepuisPreuve, evaluer: evaluer
  };

  if (typeof module !== "undefined" && module.exports) module.exports = SenCyR;
  else racine.SenCyR = SenCyR;
})(typeof window !== "undefined" ? window : this);
