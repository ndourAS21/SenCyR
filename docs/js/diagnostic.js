/*
 * diagnostic.js : page d'auto-diagnostic.
 * Construit le formulaire à partir de data/preuves.json (facteurs) et data/aspects.json
 * (facteurs décomposés en aspects), applique les règles de regles.js à chaque
 * modification et affiche le résultat. Aucune donnée n'est envoyée : tout reste dans
 * le navigateur.
 */
(function () {
  "use strict";
  const R = window.SenCyR;

  let parametres = null;   // data/parametres.json
  let catalogue = [];      // lignes de data/preuves.json (facteurs, intitulés, recommandations)
  let lignesAspects = [];  // lignes de data/aspects.json
  let fonctions = [];      // data/fonctions.json, lu par R.lireFonctions
  let dernierResultat = null;
  const renseignes = new Set();   // facteurs modifiés par l'utilisateur (progression de la saisie)
  let resumePrecedent = {};       // dernier résultat affiché dans le panneau en direct

  // ---------------------------------------------------------------- chargement
  function charger(fichier) {
    return fetch(fichier).then(function (r) {
      if (!r.ok) throw new Error(fichier + " : " + r.status);
      return r.json();
    });
  }

  Promise.all([charger("data/parametres.json"), charger("data/preuves.json"),
    charger("data/aspects.json"), charger("data/fonctions.json")])
    .then(function (donnees) {
      parametres = donnees[0];
      catalogue = donnees[1].map(nettoyerCles);
      lignesAspects = donnees[2].map(nettoyerCles);
      fonctions = R.lireFonctions(donnees[3]);
      construireFormulaire();
      brancherBoutons();
      recalculer();
    })
    .catch(function (e) {
      document.getElementById("formulaire").innerHTML =
        "<p class=\"erreur\">Données introuvables (" + echapper(e.message) + "). Ouvrir la page par un " +
        "serveur local : <code>python -m http.server 8000 --directory docs</code>, puis " +
        "<code>http://localhost:8000/diagnostic.html</code>.</p>";
    });

  // Retire un éventuel BOM du nom de la première colonne.
  function nettoyerCles(ligne) {
    const o = {};
    Object.keys(ligne).forEach(function (k) { o[k.replace(/^﻿/, "")] = ligne[k]; });
    return o;
  }

  function aspectsDe(facteur) {
    return lignesAspects.filter(function (a) { return a.facteur === facteur; });
  }

  // ---------------------------------------------------------------- formulaire
  const NB_COLONNES = 11;

  function construireFormulaire() {
    const parDimension = {};
    catalogue.forEach(function (l) {
      (parDimension[l.dimension] = parDimension[l.dimension] || []).push(l);
    });
    let h = "";
    Object.keys(parDimension).sort().forEach(function (dim) {
      h += "<fieldset><legend>" + dim + " " + echapper(R.DIMENSIONS[dim] || "") + "</legend>";
      h += "<div class=\"defile\"><table class=\"saisie\"><thead><tr>" +
        "<th scope=\"col\">Facteur</th><th scope=\"col\">Niveau déclaré</th>" +
        "<th scope=\"col\" title=\"Nombre de sources de niveau A\">A</th>" +
        "<th scope=\"col\" title=\"Nombre de sources de niveau B\">B</th>" +
        "<th scope=\"col\" title=\"Nombre de sources de niveau C\">C</th>" +
        "<th scope=\"col\">Absence de trace (R2)</th><th scope=\"col\">Source indirecte</th>" +
        "<th scope=\"col\">Sources convergentes</th>" +
        "<th scope=\"col\">Exposition</th><th scope=\"col\">Faisabilité</th>" +
        "<th scope=\"col\">Portée</th></tr></thead><tbody>";
      parDimension[dim].forEach(function (l) {
        const aspects = aspectsDe(l.facteur);
        h += ligneFacteur(l, aspects.length > 0);
        aspects.forEach(function (a) { h += ligneAspect(a); });
      });
      h += "</tbody></table></div></fieldset>";
    });
    document.getElementById("formulaire").innerHTML = h;
    // Toute modification d'un champ marque son facteur comme renseigné (un aspect compte
    // pour son facteur), puis le résultat est recalculé en direct.
    document.getElementById("formulaire").addEventListener("input", function (evt) {
      const tr = evt.target.closest("tr");
      if (tr) renseignes.add(tr.dataset.facteur || tr.dataset.de);
      recalculer();
    });
  }

  // Cellules de saisie communes aux facteurs et aux aspects.
  function champs(code) {
    const id = function (champ) { return "c-" + code.replace(".", "-") + "-" + champ; };
    const nombre = function (s) {
      return "<td><input type=\"number\" min=\"0\" max=\"20\" step=\"1\" value=\"0\" id=\"" + id(s) +
        "\" data-champ=\"" + s + "\" aria-label=\"" + code + " : sources " + s + "\"></td>";
    };
    const case_ = function (champ, libelle, cochee) {
      return "<td><input type=\"checkbox\" id=\"" + id(champ) + "\" data-champ=\"" + champ + "\"" +
        (cochee ? " checked" : "") + " aria-label=\"" + code + " : " + libelle + "\"></td>";
    };
    const options = [R.NON_EVALUABLE].concat(R.NIVEAUX).map(function (n) {
      return "<option value=\"" + n + "\">" + n + "</option>";
    }).join("");
    return {
      niveau: "<td><select id=\"" + id("niveau") + "\" data-champ=\"niveau\" aria-label=\"" + code +
        " : niveau\">" + options + "</select></td>",
      sources: nombre("A") + nombre("B") + nombre("C") +
        case_("absenceR2", "absence de trace") + case_("indirecte", "source indirecte") +
        case_("convergentes", "sources convergentes", true),
      r6: case_("exposition", "exposition") + case_("faisabilite", "faisabilité")
    };
  }

  function ligneFacteur(l, aDesAspects) {
    const f = l.facteur;
    const etiquette = "<th scope=\"row\"><span class=\"code\">" + f + "</span> " + echapper(l.intitule) + "</th>";
    // Le facteur hors périmètre (D1.4) n'est pas saisi.
    if (R.normaliserNiveau(l.appreciation) === R.HORS_PERIMETRE) {
      return "<tr data-facteur=\"" + f + "\" data-hors=\"1\">" + etiquette +
        "<td colspan=\"" + (NB_COLONNES - 1) + "\" class=\"grise\">Hors périmètre (non documentable en sources ouvertes)</td></tr>";
    }
    const c = champs(f);
    // Facteur à aspects : son niveau n'est pas saisi, il est calculé (R5, aspect le moins avancé).
    const niveau = aDesAspects
      ? "<td><span class=\"calcule\" data-niveau-calcule=\"" + f + "\">—</span><br><small>R5, aspects</small></td>"
      : c.niveau;
    const portee = R.porteeR6(f, fonctions) ? "Oui" : "Non";
    return "<tr data-facteur=\"" + f + "\">" + etiquette + niveau + c.sources + c.r6 +
      "<td class=\"centre\">" + portee + "</td></tr>";
  }

  function ligneAspect(a) {
    const c = champs(a.aspect);
    return "<tr class=\"aspect\" data-aspect=\"" + a.aspect + "\" data-de=\"" + a.facteur + "\">" +
      "<th scope=\"row\"><span class=\"code\">" + a.aspect + "</span> " + echapper(a.intitule) + " <small>(aspect)</small></th>" +
      c.niveau + c.sources + "<td colspan=\"3\" class=\"grise\"></td></tr>";
  }

  function lireLigne(tr) {
    const champ = function (nom) { return tr.querySelector("[data-champ=\"" + nom + "\"]"); };
    const entier = function (nom) { return Math.max(0, parseInt(champ(nom).value, 10) || 0); };
    const d = {
      sources: { A: entier("A"), B: entier("B"), C: entier("C") },
      absenceR2: champ("absenceR2").checked,
      indirecte: champ("indirecte").checked,
      convergentes: champ("convergentes").checked
    };
    if (champ("niveau")) d.niveau = champ("niveau").value;
    if (champ("exposition")) {
      d.exposition = champ("exposition").checked;
      d.faisabilite = champ("faisabilite").checked;
    }
    return d;
  }

  // Lit le formulaire et produit une déclaration par facteur, au format de regles.js.
  function lireFormulaire() {
    return catalogue.map(function (l) {
      const tr = document.querySelector("tr[data-facteur=\"" + l.facteur + "\"]");
      const base = {
        facteur: l.facteur, intitule: l.intitule, dimension: l.dimension,
        recommandation: l.recommandation, fonctionRecommandation: l.fonction, aspects: []
      };
      if (tr.dataset.hors) {
        return Object.assign(base, { niveau: R.HORS_PERIMETRE, sources: {}, absenceR2: false,
          indirecte: false, convergentes: true, exposition: false, faisabilite: false });
      }
      base.aspects = aspectsDe(l.facteur).map(function (a) {
        const ta = document.querySelector("tr[data-aspect=\"" + a.aspect + "\"]");
        return Object.assign({ aspect: a.aspect, facteur: l.facteur, intitule: a.intitule }, lireLigne(ta));
      });
      // Le niveau d'un facteur à aspects est recalculé par regles.js (R5).
      return Object.assign(base, { niveau: R.NON_EVALUABLE }, lireLigne(tr));
    });
  }

  function remplirLigne(tr, d) {
    const champ = function (nom) { return tr.querySelector("[data-champ=\"" + nom + "\"]"); };
    if (champ("niveau")) champ("niveau").value = R.estNiveau(d.niveau) ? d.niveau : R.NON_EVALUABLE;
    const s = d.sources || {};
    champ("A").value = s.A || 0;
    champ("B").value = s.B || 0;
    champ("C").value = s.C || 0;
    champ("absenceR2").checked = !!d.absenceR2;
    champ("indirecte").checked = !!d.indirecte;
    champ("convergentes").checked = d.convergentes !== false;
    if (champ("exposition")) {
      champ("exposition").checked = !!d.exposition;
      champ("faisabilite").checked = !!d.faisabilite;
    }
  }

  // Remplit le formulaire avec des déclarations (exemple Sénégal ou réinitialisation).
  function remplirFormulaire(declarations) {
    declarations.forEach(function (d) {
      const tr = document.querySelector("tr[data-facteur=\"" + d.facteur + "\"]");
      if (!tr || tr.dataset.hors) return;
      remplirLigne(tr, d);
      (d.aspects || []).forEach(function (a) {
        const ta = document.querySelector("tr[data-aspect=\"" + a.aspect + "\"]");
        if (ta) remplirLigne(ta, a);
      });
    });
  }

  // ---------------------------------------------------------------- calcul et affichage
  function recalculer() {
    dernierResultat = R.evaluer(lireFormulaire(), fonctions);
    // Affiche dans le formulaire le niveau calculé des facteurs à aspects.
    dernierResultat.facteurs.forEach(function (f) {
      const cellule = document.querySelector("[data-niveau-calcule=\"" + f.facteur + "\"]");
      if (cellule) cellule.innerHTML = badge(f.niveau);
    });
    afficher(dernierResultat);
    afficherProgression();
    afficherDirect(dernierResultat);
  }

  // Progression : facteurs renseignés sur facteurs à saisir (D1.4, hors périmètre, exclu).
  function afficherProgression() {
    const total = catalogue.filter(function (l) { return R.normaliserNiveau(l.appreciation) !== R.HORS_PERIMETRE; }).length;
    const n = Math.min(renseignes.size, total);
    document.getElementById("progression-texte").textContent = n + " facteur" + (n > 1 ? "s" : "") + " renseigné" +
      (n > 1 ? "s" : "") + " sur " + total;
    document.getElementById("progression-barre").style.width = (total ? Math.round(100 * n / total) : 0) + "%";
    const piste = document.querySelector("#progression .piste");
    piste.setAttribute("aria-valuemax", String(total));
    piste.setAttribute("aria-valuenow", String(n));
  }

  // Panneau collant : niveau de chaque dimension et nombre de lacunes par priorité,
  // mis à jour à chaque saisie ; un éclat signale ce qui vient de changer.
  function afficherDirect(r) {
    const resume = {};
    let h = "<strong>Résultat en direct</strong>";
    r.dimensions.forEach(function (d) {
      resume[d.dimension] = d.niveau;
      h += "<span class=\"element\" data-cle=\"" + d.dimension + "\">" + d.dimension + " " + badge(d.niveau) + "</span>";
    });
    [1, 2, 3].forEach(function (p) {
      const n = r.priorites.filter(function (f) { return f.priorite === p; }).length;
      resume["P" + p] = String(n);
      h += "<span class=\"element\" data-cle=\"P" + p + "\">" + badge(String(p)) + " " + n + "</span>";
    });
    h += "<a href=\"#resultats\">Voir le détail</a>";
    const zone = document.getElementById("direct");
    zone.innerHTML = h;
    Object.keys(resume).forEach(function (cle) {
      if (resumePrecedent[cle] !== undefined && resumePrecedent[cle] !== resume[cle]) {
        const el = zone.querySelector("[data-cle=\"" + cle + "\"]");
        if (el) el.classList.add("maj");
      }
    });
    resumePrecedent = resume;
  }

  function afficher(r) {
    const evalues = r.facteurs.filter(function (f) { return R.estNiveau(f.niveau); }).length;
    const total = r.facteurs.filter(function (f) { return f.niveau !== R.HORS_PERIMETRE; }).length;
    document.getElementById("contexte-resultat").textContent =
      evalues + " facteurs évaluables sur " + total + " (D1.4 hors périmètre).";

    remplirTable("t-dimensions", ["Dimension", "Niveau", "Confiance", "Facteurs évaluables"],
      r.dimensions.map(function (d) {
        return [texte(d.dimension + " " + d.intitule), badge(d.niveau), badge(d.confiance),
          texte(d.evaluables + " sur " + d.total)];
      }));

    remplirTable("t-fonctions", ["Fonction", "Niveau", "Confiance", "Facteurs évaluables", "Facteurs"],
      r.fonctions.map(function (fn) {
        return [texte(fn.fonction), badge(fn.niveau), badge(fn.confiance),
          texte(fn.evaluables + " sur " + fn.total), texte(fn.facteurs.join(", "))];
      }));

    remplirTable("t-priorites", ["Priorité", "Facteur", "Portée", "Exposition", "Faisabilité", "Recommandation associée"],
      r.priorites.map(function (f) {
        return [badge(String(f.priorite)), texte(f.facteur + " " + f.intitule), texte(ouiNon(f.portee)),
          texte(ouiNon(f.exposition)), texte(ouiNon(f.faisabilite)), texte(f.recommandation || "—")];
      }), "Aucun facteur émergent : pas de lacune à hiérarchiser.");

    remplirTable("t-autres", ["Facteur", "Niveau", "Recommandation associée"],
      r.facteurs.filter(function (f) { return f.priorite === null && f.recommandation && f.niveau !== R.HORS_PERIMETRE; })
        .map(function (f) { return [texte(f.facteur + " " + f.intitule), badge(f.niveau), texte(f.recommandation)]; }),
      "Aucune.");

    const lignes = [];
    r.facteurs.forEach(function (f) {
      lignes.push([texte(f.facteur + " " + f.intitule), badge(f.niveau), badge(f.confiance),
        f.priorite === null ? texte("—") : badge(String(f.priorite))]);
      f.aspects.forEach(function (a) {
        lignes.push(["<span class=\"retrait\">" + texte(a.aspect + " " + a.intitule + " (aspect)") + "</span>",
          badge(a.niveau), badge(a.confiance), texte("")]);
      });
    });
    remplirTable("t-facteurs", ["Facteur", "Niveau", "Confiance (R3)", "Priorité (R6)"], lignes);
  }

  // Cellules : chaîne HTML déjà échappée.
  function texte(v) { return echapper(v); }
  function ouiNon(b) { return b ? "Oui" : "Non"; }
  // Pastille avec infobulle d'explication (commun.js).
  function badge(v) { return window.Commun.badge(v); }

  function remplirTable(id, entetes, lignes, siVide) {
    let h = "<thead><tr>" + entetes.map(function (e) { return "<th scope=\"col\">" + e + "</th>"; }).join("") + "</tr></thead><tbody>";
    if (lignes.length === 0) h += "<tr><td colspan=\"" + entetes.length + "\">" + echapper(siVide || "—") + "</td></tr>";
    lignes.forEach(function (l) { h += "<tr>" + l.map(function (c) { return "<td>" + c + "</td>"; }).join("") + "</tr>"; });
    document.getElementById(id).innerHTML = h + "</tbody>";
  }

  function echapper(v) {
    return String(v === undefined || v === null ? "" : v)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  // ---------------------------------------------------------------- boutons et exports
  function brancherBoutons() {
    document.getElementById("btn-exemple").addEventListener("click", function () {
      remplirFormulaire(catalogue.map(function (l) { return R.declarationDepuisPreuve(l, lignesAspects); }));
      catalogue.forEach(function (l) { if (R.normaliserNiveau(l.appreciation) !== R.HORS_PERIMETRE) renseignes.add(l.facteur); });
      recalculer();
      message("Exemple chargé : évaluation du Sénégal. Vous pouvez la modifier.");
    });
    document.getElementById("btn-vider").addEventListener("click", function () {
      remplirFormulaire(catalogue.map(function (l) {
        return {
          facteur: l.facteur, niveau: R.NON_EVALUABLE, sources: {},
          aspects: aspectsDe(l.facteur).map(function (a) { return { aspect: a.aspect, niveau: R.NON_EVALUABLE, sources: {} }; })
        };
      }));
      renseignes.clear();
      resumePrecedent = {};
      recalculer();
      message("Formulaire réinitialisé.");
    });
    document.getElementById("btn-json").addEventListener("click", exporterJSON);
    document.getElementById("btn-csv").addEventListener("click", exporterCSV);
    document.getElementById("btn-imprimer").addEventListener("click", function () { window.print(); });
  }

  function message(t) { document.getElementById("message").textContent = t; }

  function horodatage() { return new Date().toISOString().slice(0, 19).replace(/:/g, "-"); }

  function telecharger(nom, contenu, type) {
    const lien = document.createElement("a");
    lien.href = URL.createObjectURL(new Blob([contenu], { type: type }));
    lien.download = nom;
    document.body.appendChild(lien);
    lien.click();
    lien.remove();
    setTimeout(function () { URL.revokeObjectURL(lien.href); }, 1000);
  }

  function exporterJSON() {
    const export_ = {
      outil: "SenCyR, auto-diagnostic",
      date: new Date().toISOString(),
      avertissement: "Appréciation qualitative et déclarative, sans valeur officielle.",
      parametres: parametres,
      declarations: lireFormulaire(),
      resultat: dernierResultat
    };
    telecharger("sencyr-diagnostic-" + horodatage() + ".json", JSON.stringify(export_, null, 2), "application/json");
  }

  // CSV au séparateur point-virgule, avec BOM, pour une ouverture directe dans un tableur en français.
  // Les aspects suivent leur facteur (colonne facteur = code de l'aspect).
  function exporterCSV() {
    const colonnes = ["facteur", "intitule", "dimension", "niveau", "confiance", "priorite",
      "portee", "exposition", "faisabilite", "recommandation"];
    const cellule = function (v) {
      const s = v === null || v === undefined ? "" : typeof v === "boolean" ? (v ? "oui" : "non") : String(v);
      return /[";\n]/.test(s) ? "\"" + s.replace(/"/g, "\"\"") + "\"" : s;
    };
    const lignes = [colonnes.join(";")];
    dernierResultat.facteurs.forEach(function (f) {
      lignes.push(colonnes.map(function (c) { return cellule(f[c]); }).join(";"));
      f.aspects.forEach(function (a) {
        lignes.push(colonnes.map(function (c) {
          return cellule(c === "facteur" ? a.aspect : c === "dimension" ? f.dimension :
            ["intitule", "niveau", "confiance"].indexOf(c) >= 0 ? a[c] : "");
        }).join(";"));
      });
    });
    telecharger("sencyr-diagnostic-" + horodatage() + ".csv", "﻿" + lignes.join("\r\n"), "text/csv;charset=utf-8");
  }
})();
