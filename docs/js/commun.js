/*
 * commun.js : fonctions d'affichage partagées par l'accueil, le tableau de bord,
 * le benchmark et la page Méthode. Aucune règle d'évaluation ici : elles sont dans
 * regles.js.
 */
(function () {
  "use strict";
  const R = window.SenCyR;

  function echapper(v) {
    return String(v === undefined || v === null ? "" : v)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  // Lit un fichier JSON de docs/data. Un fichier facultatif absent renvoie null
  // (par exemple les mesures, tant que le moteur ne les a pas exportées).
  function chargerJSON(fichier, facultatif) {
    return fetch(fichier).then(function (r) {
      if (r.ok) return r.json();
      if (facultatif && r.status === 404) return null;
      throw new Error(fichier + " : " + r.status);
    });
  }

  function erreurChargement(idElement, e) {
    document.getElementById(idElement).innerHTML =
      "<p class=\"erreur\">Données introuvables (" + echapper(e.message) + "). Ouvrir le site par un " +
      "serveur local : <code>python -m http.server 8000 --directory docs</code>.</p>";
  }

  // Ce que signifie chaque couleur (tableau 2.2, R3, R6), affiché en infobulle.
  const EXPLICATIONS = {
    "émergent": "Niveau émergent : dispositif inexistant, annoncé, en projet ou partiel.",
    "structuré": "Niveau structuré : dispositif en place et formalisé.",
    "consolidé": "Niveau consolidé : dispositif coordonné, durable et ajusté dans le temps.",
    "non évaluable": "Non évaluable : aucune source publique suffisamment fiable ne permet d'apprécier le facteur.",
    "hors périmètre": "Hors périmètre : non documentable en sources ouvertes.",
    "faible": "Confiance faible (R3) : source C seule ou source indirecte.",
    "moyenne": "Confiance moyenne (R3) : une source A ou B non recoupée, plusieurs sources B ou C convergentes sans source A, ou niveau fondé sur l'absence de trace (R2).",
    "élevée": "Confiance élevée (R3) : au moins deux sources convergentes sur le niveau attribué, dont une de niveau A.",
    "1": "Priorité 1 (R6) : lacune réunissant portée, exposition et faisabilité.",
    "2": "Priorité 2 (R6) : lacune réunissant deux des trois critères.",
    "3": "Priorité 3 (R6) : lacune réunissant un critère ou aucun.",
    "—": "Sans objet."
  };
  const CONFIANCE_MESURE = "Confiance d'un facteur mesuré : fixée par la taille de l'échantillon (voir Méthode), pas par R3.";

  // Pastille colorée pour un niveau, une confiance ou une priorité, avec son explication.
  // info (facultatif) remplace l'explication par défaut.
  function badge(v, info) {
    const classes = { "émergent": "b-emergent", "structuré": "b-structure", "consolidé": "b-consolide",
      "non évaluable": "b-non-evaluable", "hors périmètre": "b-hors-perimetre",
      "faible": "b-faible", "moyenne": "b-moyenne", "élevée": "b-elevee",
      "1": "b-p1", "2": "b-p2", "3": "b-p3" };
    const texte = v === null || v === undefined ? "—" : String(v);
    const explication = info || EXPLICATIONS[texte] || "";
    return "<span class=\"badge " + (classes[texte] || "b-aucun") + "\"" +
      (explication ? " data-info=\"" + echapper(explication) + "\"" : "") + ">" + echapper(texte) + "</span>";
  }

  // Barre ordinale en trois crans : un cran par niveau atteint sur l'échelle
  // (émergent = 1, structuré = 2, consolidé = 3) ; aucun cran pour un statut hors échelle.
  function barreNiveau(niveau) {
    const rang = R.NIVEAUX.indexOf(niveau) + 1;
    let h = "<span class=\"niveau-barre\" role=\"img\" aria-label=\"" + echapper(niveau) + "\" title=\"" + echapper(niveau) + "\">";
    for (let i = 1; i <= R.NIVEAUX.length; i++) h += "<span" + (i <= rang ? " class=\"plein\"" : "") + "></span>";
    return h + "</span>";
  }

  // Barre de pourcentage, avec les seuils de niveau de parametres.json en pointillés.
  // info (facultatif) : texte de l'infobulle affichée au survol.
  function barrePct(pct, parametres, info) {
    if (pct === null || pct === undefined) return "<span class=\"note\">non mesuré</span>";
    const s = parametres.seuils_mesure_pct;
    return "<span class=\"pct\" role=\"img\" aria-label=\"" + echapper(info || pct + " %") + "\"" +
      (info ? " data-info=\"" + echapper(info) + "\" tabindex=\"0\"" : "") + ">" +
      "<span class=\"remplissage\" style=\"width:" + pct + "%\"></span>" +
      "<span class=\"seuil\" style=\"left:" + s.structure + "%\"></span>" +
      "<span class=\"seuil\" style=\"left:" + s.consolide + "%\"></span></span>";
  }

  // Nombre au format français (virgule décimale).
  function nombre(x, decimales) {
    return Number(x).toLocaleString("fr-FR", { minimumFractionDigits: decimales, maximumFractionDigits: decimales });
  }

  // Nombre animé au chargement par animations.js ; le texte initial est déjà la valeur finale.
  function compteur(valeur, decimales, suffixe) {
    const d = decimales || 0, suf = suffixe || "";
    return "<span class=\"compteur\" data-compteur=\"" + valeur + "\" data-decimales=\"" + d + "\" data-suffixe=\"" +
      echapper(suf) + "\">" + nombre(valeur, d) + echapper(suf) + "</span>";
  }

  // lignes : liste de cellules (chaînes HTML) ; une ligne peut aussi être un objet
  // { cellules, attributs } pour porter des attributs sur le <tr>.
  function remplirTable(id, entetes, lignes, siVide) {
    let h = "<thead><tr>" + entetes.map(function (e) { return "<th scope=\"col\">" + e + "</th>"; }).join("") + "</tr></thead><tbody>";
    if (lignes.length === 0) h += "<tr><td colspan=\"" + entetes.length + "\">" + echapper(siVide || "—") + "</td></tr>";
    lignes.forEach(function (l) {
      const cellules = Array.isArray(l) ? l : l.cellules;
      h += "<tr" + (Array.isArray(l) ? "" : " " + (l.attributs || "")) + ">" +
        cellules.map(function (c) { return "<td>" + c + "</td>"; }).join("") + "</tr>";
    });
    const table = document.getElementById(id);
    table.innerHTML = h + "</tbody>";
    if (lignes.length > 1) rendreTriable(table);
  }

  // ---------------------------------------------------------------- tri des tableaux
  // Ordre des valeurs de l'échelle et de la confiance ; « — » en dernier.
  const ORDRE = { "hors périmètre": -1, "non évaluable": 0, "émergent": 1, "structuré": 2, "consolidé": 3,
    "faible": 1, "moyenne": 2, "élevée": 3, "—": 99 };

  function cleTri(cellule) {
    const t = (cellule ? cellule.textContent : "").trim();
    if (t in ORDRE) return ORDRE[t];
    const n = parseFloat(t.replace(/\s/g, "").replace(",", "."));
    return isNaN(n) ? t.toLowerCase() : n;
  }

  function comparer(a, b) {
    if (typeof a === "number" && typeof b === "number") return a - b;
    if (typeof a === "number") return -1;
    if (typeof b === "number") return 1;
    return a.localeCompare(b, "fr");
  }

  /*
   * Rend un tableau triable : un clic sur un en-tête trie les lignes (croissant puis
   * décroissant). Une ligne de classe « enfant » (aspect, détail déplié) reste sous
   * la ligne qui la précède.
   */
  function rendreTriable(table) {
    const ths = table.querySelectorAll("thead th");
    ths.forEach(function (th, colonne) {
      const bouton = document.createElement("button");
      bouton.type = "button";
      bouton.className = "tri";
      bouton.innerHTML = th.innerHTML + "<span class=\"fleche\" aria-hidden=\"true\"></span>";
      bouton.title = "Trier par cette colonne";
      th.innerHTML = "";
      th.appendChild(bouton);
      bouton.addEventListener("click", function () {
        const sens = th.getAttribute("aria-sort") === "ascending" ? -1 : 1;
        ths.forEach(function (x) { x.removeAttribute("aria-sort"); });
        th.setAttribute("aria-sort", sens === 1 ? "ascending" : "descending");
        const tbody = table.tBodies[0];
        const groupes = [];
        Array.prototype.forEach.call(tbody.rows, function (tr) {
          if (tr.classList.contains("enfant") && groupes.length) groupes[groupes.length - 1].push(tr);
          else groupes.push([tr]);
        });
        groupes.sort(function (g1, g2) { return sens * comparer(cleTri(g1[0].cells[colonne]), cleTri(g2[0].cells[colonne])); });
        groupes.forEach(function (g) { g.forEach(function (tr) { tbody.appendChild(tr); }); });
      });
    });
  }

  // ---------------------------------------------------------------- infobulles
  // Une seule infobulle pour la page, affichée au survol ou au focus d'un élément [data-info].
  function initialiserInfobulles() {
    const bulle = document.createElement("div");
    bulle.id = "infobulle";
    bulle.setAttribute("role", "tooltip");
    document.body.appendChild(bulle);
    let cible = null;
    function montrer(el) {
      cible = el;
      bulle.textContent = el.getAttribute("data-info");
      bulle.classList.add("visible");
      const r = el.getBoundingClientRect(), b = bulle.getBoundingClientRect();
      let x = r.left + r.width / 2 - b.width / 2;
      x = Math.max(8, Math.min(x, window.innerWidth - b.width - 8));
      let y = r.bottom + 8;
      if (y + b.height > window.innerHeight - 8) y = r.top - b.height - 8;
      bulle.style.left = x + "px";
      bulle.style.top = y + "px";
    }
    function cacher() { cible = null; bulle.classList.remove("visible"); }
    document.addEventListener("mouseover", function (e) {
      const el = e.target.closest && e.target.closest("[data-info]");
      if (el && el !== cible) montrer(el); else if (!el && cible) cacher();
    });
    document.addEventListener("focusin", function (e) {
      const el = e.target.closest && e.target.closest("[data-info]");
      if (el) montrer(el);
    });
    document.addEventListener("focusout", cacher);
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") cacher(); });
    window.addEventListener("scroll", cacher, { passive: true });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initialiserInfobulles);
  else initialiserInfobulles();

  /*
   * Évaluation du pays étudié au format de l'export du moteur (evaluation.json).
   * Si l'export existe, il est utilisé tel quel. Sinon, l'évaluation documentaire est
   * recalculée par regles.js à partir de preuves.json (aucune mesure) : même résultat
   * que le moteur sans mesure, vérifié par les tests.
   */
  function evaluationPaysEtudie(evaluation, preuves, aspects, fonctions) {
    if (evaluation && evaluation.meta) {
      const pays = evaluation.meta.pays_etudie;
      return { pays: pays, lignes: evaluation.pays[pays] || [], meta: evaluation.meta };
    }
    const r = R.evaluer(preuves.map(function (l) { return R.declarationDepuisPreuve(l, aspects); }), R.lireFonctions(fonctions));
    const lignes = [];
    r.facteurs.forEach(function (f) {
      lignes.push({ type: "facteur", code: f.facteur, intitule: f.intitule, dimension: f.dimension, niveau: f.niveau,
        confiance: f.confiance, base: "documentaire", priorite: f.priorite, recommandation: f.recommandation,
        fonction_recommandation: f.fonctionRecommandation });
      f.aspects.forEach(function (a) {
        lignes.push({ type: "aspect", code: a.aspect, intitule: a.intitule, dimension: f.dimension, niveau: a.niveau,
          confiance: a.confiance, base: "documentaire", priorite: null });
      });
    });
    r.dimensions.forEach(function (d) {
      lignes.push({ type: "dimension", code: d.dimension, intitule: d.intitule, niveau: d.niveau, confiance: d.confiance,
        detail: d.evaluables + " facteurs évaluables sur " + d.total });
    });
    r.fonctions.forEach(function (fn) {
      lignes.push({ type: "fonction", code: fn.fonction, intitule: fn.facteurs.join(", "), niveau: fn.niveau,
        confiance: fn.confiance, detail: fn.evaluables + " facteurs évaluables sur " + fn.total });
    });
    return { pays: "SN", lignes: lignes, meta: null };
  }

  // Période de mesure : une seule date si toutes les mesures ont la même.
  function periode(p) {
    if (!p || p.length === 0) return "—";
    return p[0] === p[1] ? p[0] : p[0] + " au " + p[1];
  }

  function deType(lignes, type) {
    return lignes.filter(function (l) { return l.type === type; });
  }

  window.Commun = {
    echapper: echapper, chargerJSON: chargerJSON, erreurChargement: erreurChargement, badge: badge,
    barreNiveau: barreNiveau, barrePct: barrePct, nombre: nombre, remplirTable: remplirTable,
    evaluationPaysEtudie: evaluationPaysEtudie, deType: deType, periode: periode,
    compteur: compteur, rendreTriable: rendreTriable, EXPLICATIONS: EXPLICATIONS, CONFIANCE_MESURE: CONFIANCE_MESURE
  };
})();
