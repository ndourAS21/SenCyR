/*
 * tableau-de-bord.js : profil national du pays étudié.
 * Lit data/evaluation.json et data/mesures_agregees.json produits par le moteur
 * (commande exporter). Tant que ces fichiers n'existent pas, l'évaluation documentaire
 * est recalculée par regles.js et la partie mesurée est signalée comme absente.
 * La page ne reçoit que des agrégats : aucune institution, aucun domaine, aucun hébergeur.
 *
 * Vue d'ensemble : chiffres clés, niveau par dimension, tableau croisé dimension ×
 * fonction, liste des facteurs (clic sur une dimension) avec filtres par niveau,
 * fonction et priorité. Dessous, les cinq blocs détaillés, repliables.
 * Tous les chiffres viennent des données : rien n'est écrit en dur.
 */
(function () {
  "use strict";
  const C = window.Commun, R = window.SenCyR;
  const e = C.echapper;

  // Libellés courants des niveaux, affichés à côté des termes de l'échelle (tableau 2.2).
  const LIBELLES_SIMPLES = { "émergent": "en démarrage", "structuré": "en place", "consolidé": "bien installé" };

  // État de la vue d'ensemble : dimension choisie et filtres.
  const etat = { dimension: "", niveau: "", fonction: "", priorite: "" };

  Promise.all([
    C.chargerJSON("data/parametres.json"), C.chargerJSON("data/preuves.json"),
    C.chargerJSON("data/aspects.json"), C.chargerJSON("data/fonctions.json"),
    C.chargerJSON("data/evaluation.json", true), C.chargerJSON("data/mesures_agregees.json", true)
  ]).then(function (d) {
    afficher(d[0], d[1], d[2], d[3], d[4], d[5]);
  }).catch(function (err) { C.erreurChargement("source", err); });

  // Pastille de confiance : l'explication dépend de la base (preuves ou mesure).
  function badgeConfiance(x) {
    return C.badge(x.confiance, /^mesure/.test(x.base || "") ? C.CONFIANCE_MESURE : null);
  }

  function badgePriorite(x) {
    return x.priorite ? C.badge(String(x.priorite)) : C.badge("—");
  }

  function afficher(P, preuves, aspects, fonctions, evaluation, mesures) {
    const ev = C.evaluationPaysEtudie(evaluation, preuves, aspects, fonctions);
    const mesures_ = Object.keys(P.facteurs_mesures).join(" et ");

    // Bandeau : d'où viennent les résultats affichés.
    if (ev.meta) {
      document.getElementById("source").innerHTML =
        "Résultats exportés par le moteur (" + e(ev.meta.moteur) + ") le " + e(ev.meta.date_export) + ". " +
        "Mesure passive de " + ev.meta.nb_domaines + " domaines publics (" + e(C.periode(ev.meta.periode_mesure)) + "). " +
        e(mesures_) + " : mesure ; autres facteurs : preuves documentaires du mémoire.";
    } else {
      document.getElementById("source").innerHTML =
        "Évaluation documentaire seule (preuves du mémoire), calculée dans le navigateur par les règles " +
        "de la grille. Les mesures techniques ne sont pas encore exportées : " + e(mesures_) +
        " restent non évaluables.";
    }

    const lignes = ev.lignes;
    const facteurs = C.deType(lignes, "facteur");
    const aspectsDe = function (code) {
      return C.deType(lignes, "aspect").filter(function (a) { return R.codeFacteur(a.code) === code; });
    };
    // Fonctions de résilience et codes qu'elles citent (facteurs ou aspects, tableau 2.1).
    const fonctionsListe = C.deType(lignes, "fonction").map(function (f) {
      return { nom: f.code, codes: String(f.intitule).split(/,\s*/) };
    });
    const fonctionsDe = function (code) {
      return fonctionsListe.filter(function (f) {
        return f.codes.some(function (c) { return R.codeFacteur(c) === code; });
      }).map(function (f) { return f.nom; });
    };
    const infos = infobulles(lignes, preuves, aspects);

    // ---------------------------------------------------------------- vue d'ensemble
    afficherCles(ev, facteurs);
    afficherBarresDimensions(C.deType(lignes, "dimension"));
    afficherCroise(lignes, fonctionsListe, infos);
    afficherLegende();
    installerFiltres(fonctionsListe.map(function (f) { return f.nom; }));

    const appliquer = function () {
      afficherListe(facteurs, fonctionsDe, infos, C.deType(lignes, "dimension"));
      filtrerCroise();
      filtrerDetail();
    };
    document.getElementById("filtres").addEventListener("change", function (evt) {
      etat[evt.target.dataset.filtre] = evt.target.value;
      appliquer();
    });
    // Clic sur une dimension (barres ou en-tête de ligne du tableau croisé) ;
    // un second clic, ou « toutes les dimensions », revient à l'ensemble.
    document.getElementById("vue").addEventListener("click", function (evt) {
      if (evt.target.closest("[data-toutes]")) { choisirDimension(""); return; }
      const b = evt.target.closest("[data-choix-dimension]");
      if (b) choisirDimension(etat.dimension === b.dataset.choixDimension ? "" : b.dataset.choixDimension);
    });
    function choisirDimension(code) {
      etat.dimension = code;
      document.querySelectorAll("[data-choix-dimension]").forEach(function (b) {
        b.setAttribute("aria-pressed", String(b.dataset.choixDimension === code));
      });
      appliquer();
    }

    // ---------------------------------------------------------------- blocs détaillés
    const ligneProfil = function (x, premiereCellule) {
      return [premiereCellule, C.barreNiveau(x.niveau) + " " + C.badge(x.niveau), badgeConfiance(x), e(x.detail || "")];
    };

    // 1. Dimensions : chaque ligne se déplie sur ses facteurs.
    C.remplirTable("t-dimensions", ["Dimension", "Niveau", "Confiance", "Couverture"],
      C.deType(lignes, "dimension").map(function (x) {
        return ligneProfil(x, "<button type=\"button\" class=\"deplier\" aria-expanded=\"false\" data-dimension=\"" +
          e(x.code) + "\">" + e(x.code + " " + x.intitule) + "</button>");
      }));
    document.getElementById("t-dimensions").addEventListener("click", function (evt) {
      const bouton = evt.target.closest("button.deplier");
      if (!bouton) return;
      basculerDimension(bouton, facteurs.filter(function (f) { return f.dimension === bouton.dataset.dimension; }), aspectsDe);
    });

    // 2. Fonctions de résilience.
    C.remplirTable("t-fonctions", ["Fonction", "Niveau", "Confiance", "Couverture", "Facteurs"],
      C.deType(lignes, "fonction").map(function (x) { return ligneProfil(x, e(x.code)).concat([e(x.intitule)]); }));

    // 3. Priorités R6.
    const priorites = facteurs.filter(function (x) { return x.priorite !== null && x.priorite !== undefined; })
      .sort(function (a, b) { return a.priorite - b.priorite || a.code.localeCompare(b.code); });
    C.remplirTable("t-priorites", ["Priorité", "Facteur", "Fonction visée", "Recommandation"],
      priorites.map(function (x) {
        return [C.badge(String(x.priorite)), e(x.intitule + " (" + x.code + ")"), e(x.fonction_recommandation || "—"),
          e(x.recommandation || "—")];
      }), "Aucun facteur émergent.");

    // 4. Mesures agrégées.
    afficherMesures(P, ev, mesures);

    // 5. Détail : facteurs, aspects (lignes « enfant »), indicateurs complémentaires.
    const attributs = function (x) {
      return "data-niveau=\"" + e(x.niveau) + "\" data-fonctions=\"" + e(fonctionsDe(x.code).join("|")) +
        "\" data-priorite=\"" + (x.priorite || "") + "\"";
    };
    const detail = [];
    facteurs.forEach(function (x) {
      detail.push({
        attributs: attributs(x),
        cellules: [e(x.intitule + " (" + x.code + ")"), C.badge(x.niveau), badgeConfiance(x), e(x.base || "—"), badgePriorite(x)]
      });
      aspectsDe(x.code).forEach(function (a) {
        detail.push({
          attributs: "class=\"enfant\"",
          cellules: ["<span class=\"retrait\">" + e(a.intitule + " (" + a.code + ", aspect)") + "</span>",
            C.badge(a.niveau), C.badge(a.confiance), e(a.base || "—"), C.badge("—")]
        });
      });
    });
    C.deType(lignes, "complementaire").forEach(function (x) {
      detail.push({
        attributs: attributs(x),
        cellules: [e(x.intitule + " (" + x.code + ", indicateur complémentaire)"), C.badge(x.niveau),
          badgeConfiance(x), e(x.base || "—"), C.badge("—")]
      });
    });
    C.remplirTable("t-facteurs", ["Facteur", "Niveau", "Confiance", "Base", "Priorité"], detail);

    appliquer();
  }

  // ---------------------------------------------------------------- infobulles des facteurs
  // « 7;1;5 » et « A;A;C » → « [7] (A), [1] (A), [5] (C) ».
  function references(sources, niveaux) {
    const s = String(sources || "").split(/[;,]\s*/).filter(Boolean);
    const n = String(niveaux || "").split(/[;,]\s*/);
    return s.map(function (x, i) { return "[" + x + "]" + (n[i] ? " (" + n[i] + ")" : ""); }).join(", ");
  }

  /*
   * Texte d'infobulle par code (facteur ou aspect) : nom en clair, niveau, confiance,
   * source. Les références renvoient à la bibliographie du mémoire ; leurs niveaux de
   * fiabilité (A à D) sont définis dans la page Méthode.
   */
  function infobulles(lignes, preuves, aspects) {
    const parCode = {};
    preuves.forEach(function (p) { parCode[String(p.facteur || p["﻿facteur"]).trim()] = p; });
    aspects.forEach(function (a) { parCode[String(a.aspect || a["﻿aspect"]).trim()] = a; });
    const infos = {};
    lignes.filter(function (x) { return x.type === "facteur" || x.type === "aspect"; }).forEach(function (x) {
      let source;
      if (/^mesure/.test(x.base || "")) {
        const m = /n=(\d+)/.exec(x.base);
        source = "mesure passive des sites publics" + (m ? ", échantillon n = " + m[1] : "");
      } else {
        const p = parCode[x.code] || {};
        const refs = references(p.sources, p.niveaux);
        if (refs) {
          source = "preuves documentaires, références du mémoire " + refs;
          if (R.estOui(p.indirecte)) source += " ; source indirecte (R3)";
          else if (String(p.convergentes || "").trim() !== "" && !R.estOui(p.convergentes)) source += " ; sources non convergentes sur le niveau attribué (R3)";
        }
        else if (R.estOui(p.absence_R2)) source = "absence de trace publique d'un dispositif public par nature (R2)";
        else source = x.niveau === R.HORS_PERIMETRE ? "non documentable en sources ouvertes" : "aucune source publique suffisamment fiable";
      }
      const simple = LIBELLES_SIMPLES[x.niveau] ? " (" + LIBELLES_SIMPLES[x.niveau] + ")" : "";
      infos[x.code] = x.code + " · " + x.intitule + (x.type === "aspect" ? " (aspect)" : "") +
        "\nNiveau : " + x.niveau + simple +
        "\nConfiance : " + (x.confiance === R.SANS_CONFIANCE ? "sans objet" : x.confiance) +
        "\nSource : " + source;
    });
    return infos;
  }

  // ---------------------------------------------------------------- chiffres clés
  function afficherCles(ev, facteurs) {
    const total = facteurs.length;
    const evaluables = facteurs.filter(function (f) { return R.estNiveau(f.niveau); });
    const hors = facteurs.filter(function (f) { return f.niveau === R.HORS_PERIMETRE; }).length;
    const nonEval = facteurs.filter(function (f) { return f.niveau === R.NON_EVALUABLE; }).length;
    const p1 = facteurs.filter(function (f) { return f.priorite === 1; });
    const parNiveau = R.NIVEAUX.map(function (n) {
      return { niveau: n, n: evaluables.filter(function (f) { return f.niveau === n; }).length };
    });

    let h = carte("Facteurs évaluables",
      C.compteur(evaluables.length) + "<small> sur " + total + "</small>",
      "facteurs de la grille ; " + nonEval + " non évaluable(s), " + hors + " hors périmètre");

    if (ev.meta) {
      h += carte("Domaines mesurés", C.compteur(ev.meta.nb_domaines),
        "mesure passive, " + C.periode(ev.meta.periode_mesure));
    } else {
      h += carte("Domaines mesurés", "—", "mesures non encore exportées");
    }

    h += carte("Priorités 1 (R6)", C.compteur(p1.length),
      p1.length ? p1.map(function (f) { return f.code; }).join(", ") : "aucune lacune de priorité 1");

    // Répartition : barre empilée des facteurs évaluables, un segment par niveau.
    const barre = "<span class=\"empile\" role=\"img\" aria-label=\"" + e(parNiveau.map(function (x) {
      return x.n + " " + x.niveau; }).join(", ")) + "\">" + parNiveau.filter(function (x) { return x.n > 0; }).map(function (x) {
        return "<span class=\"" + classeNiveau(x.niveau) + "\" style=\"flex:" + x.n + "\" data-info=\"" +
          e(x.n + " facteur(s) " + x.niveau + " (" + LIBELLES_SIMPLES[x.niveau] + ")") + "\"></span>";
      }).join("") + "</span>";
    const repartition = "<ul class=\"repartition\">" + parNiveau.map(function (x) {
      return "<li><span class=\"pastille " + classeNiveau(x.niveau) + "\" aria-hidden=\"true\"></span>" +
        C.compteur(x.n) + " " + e(x.niveau) + " <small>" + e(LIBELLES_SIMPLES[x.niveau]) + "</small></li>";
    }).join("") + "</ul>";
    h += "<div class=\"cle cle-large\"><span class=\"cle-titre\">Répartition des facteurs évaluables par niveau</span>" +
      barre + repartition + "</div>";
    document.getElementById("cles").innerHTML = h;
  }

  function carte(titre, valeurHTML, detail) {
    return "<div class=\"cle\"><span class=\"cle-titre\">" + e(titre) + "</span><strong>" + valeurHTML + "</strong>" +
      "<span class=\"cle-detail\">" + e(detail) + "</span></div>";
  }

  function classeNiveau(n) {
    return { "émergent": "b-emergent", "structuré": "b-structure", "consolidé": "b-consolide" }[n] || "b-non-evaluable";
  }

  // ---------------------------------------------------------------- niveau par dimension
  // Barre en trois crans (émergent, structuré, consolidé) : le niveau est ordinal.
  function afficherBarresDimensions(dimensions) {
    document.getElementById("barres-dimensions").innerHTML = dimensions.map(function (d) {
      const rang = R.NIVEAUX.indexOf(d.niveau) + 1;
      let crans = "";
      for (let i = 1; i <= R.NIVEAUX.length; i++) crans += "<span" + (i <= rang ? " class=\"plein\"" : "") + "></span>";
      return "<button type=\"button\" class=\"barre-dim\" data-choix-dimension=\"" + e(d.code) + "\" aria-pressed=\"false\">" +
        "<span class=\"barre-dim-nom\"><b>" + e(d.code) + "</b> " + e(d.intitule) + "</span>" +
        "<span class=\"crans\" aria-hidden=\"true\">" + crans + "</span>" +
        "<span class=\"barre-dim-infos\">" + C.badge(d.niveau) + " " + badgeConfiance(d) +
        " <small>" + e(d.detail || "") + "</small></span></button>";
    }).join("");
  }

  // ---------------------------------------------------------------- tableau croisé
  function afficherCroise(lignes, fonctionsListe, infos) {
    const dimensions = C.deType(lignes, "dimension");
    const niveauDe = {};
    lignes.forEach(function (x) { if (x.type === "facteur" || x.type === "aspect") niveauDe[x.code] = x.niveau; });
    let h = "<thead><tr><th scope=\"col\">Dimension</th>" + fonctionsListe.map(function (f) {
      return "<th scope=\"col\">" + e(f.nom) + "</th>";
    }).join("") + "</tr></thead><tbody>";
    dimensions.forEach(function (d) {
      h += "<tr><th scope=\"row\"><button type=\"button\" class=\"lien-dim\" data-choix-dimension=\"" + e(d.code) +
        "\" aria-pressed=\"false\" title=\"" + e(d.intitule) + "\">" + e(d.code) + "</button></th>";
      fonctionsListe.forEach(function (f) {
        const codes = f.codes.filter(function (c) { return R.codeFacteur(c).slice(0, 2) === d.code; });
        h += "<td>" + (codes.length ? codes.map(function (c) {
          const n = niveauDe[c] || R.NON_EVALUABLE;
          return "<span class=\"puce " + classeNiveau(n) + "\" tabindex=\"0\" data-code=\"" + e(R.codeFacteur(c)) +
            "\" data-fonction=\"" + e(f.nom) +
            "\" data-info=\"" + e(infos[c] || c) + "\">" + e(c) + "</span>";
        }).join("") : "<span class=\"vide\" aria-label=\"aucun\">·</span>") + "</td>";
      });
      h += "</tr>";
    });
    document.getElementById("croise").innerHTML = h + "</tbody>";
  }

  // Légende : chaque pastille porte son explication en infobulle.
  function afficherLegende() {
    const groupe = function (titre, valeurs) {
      return "<span class=\"groupe\"><span>" + titre + "</span>" + valeurs.map(function (v) { return C.badge(v); }).join("") + "</span>";
    };
    document.getElementById("legende-couleurs").innerHTML =
      groupe("Niveau", R.NIVEAUX.concat([R.NON_EVALUABLE, R.HORS_PERIMETRE])) +
      groupe("Confiance", R.CONFIANCES) + groupe("Priorité", ["1", "2", "3"]) +
      "<span class=\"note\">Survoler une pastille pour son explication. <strong>Niveau</strong> : maturité du dispositif. <strong>Confiance</strong> : solidité de l'appréciation, indépendante du niveau.</span>";
  }

  // ---------------------------------------------------------------- filtres et liste
  function installerFiltres(nomsFonctions) {
    const options = function (valeurs, tous) {
      return "<option value=\"\">" + tous + "</option>" + valeurs.map(function (v) {
        return "<option value=\"" + e(v.valeur) + "\">" + e(v.libelle) + "</option>";
      }).join("");
    };
    const niveaux = R.NIVEAUX.concat([R.NON_EVALUABLE, R.HORS_PERIMETRE]).map(function (n) { return { valeur: n, libelle: n }; });
    const fonctions = nomsFonctions.map(function (n) { return { valeur: n, libelle: n }; });
    const priorites = [{ valeur: "1", libelle: "priorité 1" }, { valeur: "2", libelle: "priorité 2" },
      { valeur: "3", libelle: "priorité 3" }, { valeur: "aucune", libelle: "non hiérarchisé" }];
    document.getElementById("filtres").innerHTML =
      "<label>Niveau <select data-filtre=\"niveau\">" + options(niveaux, "tous") + "</select></label>" +
      "<label>Fonction <select data-filtre=\"fonction\">" + options(fonctions, "toutes") + "</select></label>" +
      "<label>Priorité <select data-filtre=\"priorite\">" + options(priorites, "toutes") + "</select></label>" +
      "<span class=\"compte\" id=\"filtre-compte\" aria-live=\"polite\"></span>";
  }

  // Un facteur passe les filtres s'il correspond au niveau, à la fonction et à la priorité choisis.
  function passeFiltres(niveau, fonctions, priorite) {
    if (etat.niveau && niveau !== etat.niveau) return false;
    if (etat.fonction && fonctions.indexOf(etat.fonction) < 0) return false;
    if (etat.priorite === "aucune" && priorite) return false;
    if (etat.priorite && etat.priorite !== "aucune" && String(priorite) !== etat.priorite) return false;
    return true;
  }

  function afficherListe(facteurs, fonctionsDe, infos, dimensions) {
    const dim = dimensions.find(function (d) { return d.code === etat.dimension; });
    const retenus = facteurs.filter(function (f) {
      return (!etat.dimension || f.dimension === etat.dimension) && passeFiltres(f.niveau, fonctionsDe(f.code), f.priorite || "");
    });
    document.getElementById("titre-liste").innerHTML = dim
      ? "Facteurs de " + e(dim.code + " " + dim.intitule) + " <button type=\"button\" class=\"lien\" data-toutes>toutes les dimensions</button>"
      : "Facteurs, toutes dimensions";
    document.getElementById("filtre-compte").textContent = retenus.length + " facteur(s)";
    document.getElementById("liste-facteurs").innerHTML = retenus.length ? retenus.map(function (f) {
      return "<li tabindex=\"0\" data-info=\"" + e(infos[f.code] || f.code) + "\">" +
        "<span class=\"liste-code " + classeNiveau(f.niveau) + "\">" + e(f.code) + "</span>" +
        "<span class=\"liste-nom\">" + e(f.intitule) + "</span>" +
        "<span class=\"liste-badges\">" + C.badge(f.niveau) + " " + badgeConfiance(f) + " " + badgePriorite(f) + "</span></li>";
    }).join("") : "<li class=\"aucun\">Aucun facteur ne correspond à ces filtres.</li>";
  }

  // Tableau croisé : les puces qui ne passent pas les filtres sont atténuées. Une puce
  // relève de la fonction de sa colonne (D1.1 sous « anticiper », D1.1a sous « s'adapter »).
  function filtrerCroise() {
    document.querySelectorAll("#croise .puce").forEach(function (p) {
      const code = p.dataset.code;
      const ok = passeFiltres(classeVersNiveau(p), [p.dataset.fonction], prioriteDe(code)) &&
        (!etat.dimension || code.slice(0, 2) === etat.dimension);
      p.classList.toggle("attenue", !ok);
    });
  }

  // Niveau d'une puce, lu sur sa classe de couleur.
  function classeVersNiveau(el) {
    if (el.classList.contains("b-emergent")) return "émergent";
    if (el.classList.contains("b-structure")) return "structuré";
    if (el.classList.contains("b-consolide")) return "consolidé";
    return el.textContent === "D1.4" ? R.HORS_PERIMETRE : R.NON_EVALUABLE;
  }

  // Priorité d'un facteur, lue sur sa ligne du bloc 5.
  function prioriteDe(code) {
    const tr = Array.prototype.find.call(document.querySelectorAll("#t-facteurs tr[data-priorite]"), function (t) {
      return t.cells[0].textContent.indexOf("(" + code + ")") !== -1;
    });
    return tr ? tr.dataset.priorite : "";
  }

  // Bloc 5 : mêmes filtres. Les aspects suivent leur facteur.
  function filtrerDetail() {
    const table = document.getElementById("t-facteurs");
    if (!table.tBodies[0]) return;
    let parentVisible = true;
    Array.prototype.forEach.call(table.tBodies[0].rows, function (tr) {
      if (tr.classList.contains("enfant")) { tr.classList.toggle("masque", !parentVisible); return; }
      const code = tr.cells[0].textContent.split(" ")[0];
      parentVisible = passeFiltres(tr.dataset.niveau, (tr.dataset.fonctions || "").split("|"), tr.dataset.priorite) &&
        (!etat.dimension || code.slice(0, 2) === etat.dimension);
      tr.classList.toggle("masque", !parentVisible);
    });
  }

  // ---------------------------------------------------------------- bloc 1 : dimension dépliable
  function basculerDimension(bouton, facteursDim, aspectsDe) {
    const tr = bouton.closest("tr");
    const ouvert = bouton.getAttribute("aria-expanded") === "true";
    if (ouvert) {
      if (tr.nextElementSibling && tr.nextElementSibling.classList.contains("detail-dimension")) tr.nextElementSibling.remove();
      bouton.setAttribute("aria-expanded", "false");
      return;
    }
    let h = "<table><thead><tr><th scope=\"col\">Facteur</th><th scope=\"col\">Niveau</th><th scope=\"col\">Confiance</th>" +
      "<th scope=\"col\">Priorité</th></tr></thead><tbody>";
    facteursDim.forEach(function (f) {
      h += "<tr><td>" + e(f.intitule + " (" + f.code + ")") + "</td><td>" + C.badge(f.niveau) + "</td><td>" + badgeConfiance(f) +
        "</td><td>" + badgePriorite(f) + "</td></tr>";
      aspectsDe(f.code).forEach(function (a) {
        h += "<tr><td><span class=\"retrait\">" + e(a.intitule + " (" + a.code + ", aspect)") + "</span></td><td>" +
          C.badge(a.niveau) + "</td><td>" + C.badge(a.confiance) + "</td><td>" + C.badge("—") + "</td></tr>";
      });
    });
    const detail = document.createElement("tr");
    detail.className = "enfant detail-dimension";
    detail.innerHTML = "<td colspan=\"" + tr.cells.length + "\">" + h + "</tbody></table></td>";
    tr.after(detail);
    bouton.setAttribute("aria-expanded", "true");
  }

  // ---------------------------------------------------------------- bloc 4 : mesures agrégées
  function afficherMesures(P, ev, mesures) {
    const zone = document.getElementById("mesures");
    const pays = mesures && mesures.pays[ev.pays];
    if (!pays) {
      zone.innerHTML = "<p class=\"note\">Mesures non encore exportées : elles s'afficheront ici après la " +
        "commande <code>exporter</code> du moteur.</p>";
      return;
    }
    const heb = pays.hebergement;
    const national = pays.indicateurs.heberge_national;
    let h = "<div class=\"chiffres\">" +
      chiffre(C.compteur(pays.n), "domaines publics mesurés") +
      chiffre(national.pct === null ? "—" : C.compteur(national.pct, 0, " %"), "adresse IP enregistrée dans le pays (n=" + national.n + ")") +
      chiffre(C.compteur(heb.nb_operateurs), "opérateurs d'hébergement") +
      chiffre(heb.part_premier_operateur_pct === null ? "—" : C.compteur(heb.part_premier_operateur_pct, 0, " %"),
        "des domaines chez le premier opérateur") +
      "</div>";

    // D5.1 : niveau documentaire, mesure affichée à côté (décision du cahier des charges, §5.1).
    Object.keys(P.indicateurs_complementaires || {}).forEach(function (code) {
      const doc = ev.lignes.find(function (x) { return x.type === "facteur" && x.code === code; });
      const mes = ev.lignes.find(function (x) { return x.type === "complementaire" && x.code === code; });
      if (doc && mes) {
        h += "<p>" + e(code + " " + doc.intitule) + " : niveau retenu " + C.badge(doc.niveau) +
          " (preuves documentaires). Indicateur complémentaire mesuré : " + C.badge(mes.niveau) +
          " <span class=\"note\">(" + e(mes.detail) + ")</span>. La mesure ne modifie pas le niveau retenu.</p>";
      }
    });

    // Tableau : indicateurs × familles de secteurs publiées.
    const secteurs = Object.keys(pays.secteurs);
    const entetes = ["Indicateur", "Ensemble (n=" + pays.n + ")"].concat(secteurs.map(function (s) {
      return e(s) + " (n=" + pays.secteurs[s].n + ")";
    }));
    const lignesTable = Object.keys(pays.indicateurs).map(function (ind) {
      const libelle = pays.indicateurs[ind].libelle;
      const cellules = [{ c: pays.indicateurs[ind], ou: "ensemble" }].concat(secteurs.map(function (s) {
        return { c: pays.secteurs[s].indicateurs[ind], ou: s };
      }));
      return [e(libelle)].concat(cellules.map(function (x) { return cellulePct(x.c, P, libelle, x.ou); }));
    });
    h += "<div class=\"defile\"><table id=\"t-mesures\"></table></div>";
    h += "<p class=\"legende-seuils\">Couleur : niveau que donnerait le taux selon les seuils de la méthode " +
      "(moins de " + P.seuils_mesure_pct.structure + " % " + C.badge("émergent") + ", moins de " +
      P.seuils_mesure_pct.consolide + " % " + C.badge("structuré") + ", au-delà " + C.badge("consolidé") + ").</p>";
    if (pays.domaines_non_publies_par_secteur > 0) {
      h += "<p class=\"note\">" + pays.domaines_non_publies_par_secteur + " domaine(s) appartiennent à des familles de moins de " +
        P.taille_minimale_agregat + " domaines : comptés dans l'ensemble, non publiés par famille.</p>";
    }
    const paysHeb = Object.keys(heb.pays_hebergement).map(function (cc) { return cc + " : " + heb.pays_hebergement[cc]; });
    h += "<p class=\"note\">Pays d'enregistrement des adresses IP (registre régional, pas une géolocalisation) : " + e(paysHeb.join(", ") || "—") + ".</p>";
    zone.innerHTML = h;
    C.remplirTable("t-mesures", entetes, lignesTable);
  }

  function chiffre(valeurHTML, libelle) {
    return "<div class=\"chiffre\"><strong>" + valeurHTML + "</strong><span>" + e(libelle) + "</span></div>";
  }

  // Valeur d'un indicateur agrégé, colorée selon le niveau que donnent les seuils,
  // avec une infobulle : taux, effectif, seuils.
  function cellulePct(c, P, libelle, ou) {
    if (!c || c.pct === null) return "—";
    const niveau = R.niveauMesure(c.pct, P);
    const s = P.seuils_mesure_pct;
    const info = libelle + " (" + ou + ") : " + c.pct + " % des domaines conformes, n = " + c.n +
      ". Couleur « " + niveau + " » : structuré à partir de " + s.structure + " %, consolidé à partir de " + s.consolide + " %.";
    return "<span class=\"badge " + classeNiveau(niveau) + "\" data-info=\"" + e(info) + "\">" + c.pct + " %</span>";
  }

  // Impression : les blocs repliés sont ouverts, puis refermés comme avant.
  let ouvertsAvant = [];
  window.addEventListener("beforeprint", function () {
    ouvertsAvant = Array.prototype.map.call(document.querySelectorAll("details.bloc"), function (d) { return d.open; });
    document.querySelectorAll("details.bloc").forEach(function (d) { d.open = true; });
  });
  window.addEventListener("afterprint", function () {
    document.querySelectorAll("details.bloc").forEach(function (d, i) { d.open = !!ouvertsAvant[i]; });
  });
})();
