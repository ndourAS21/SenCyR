/*
 * benchmark.js : comparaison des quatre pays.
 * 1. facteurs mesurés (D5.2, D5.4) et indicateur complémentaire (D5.1), lus dans
 *    data/evaluation.json ;
 * 2. taux par indicateur, lus dans data/mesures_agregees.json ;
 * 3. GCI 2024 (data/gci2024.json), affiché à part, jamais combiné aux mesures.
 * Interactions : sélection d'un indicateur et des pays affichés, infobulle sur chaque
 * barre (valeur, effectif, seuils), tri des tableaux.
 */
(function () {
  "use strict";
  const C = window.Commun;
  const e = C.echapper;

  Promise.all([
    C.chargerJSON("data/parametres.json"), C.chargerJSON("data/gci2024.json"),
    C.chargerJSON("data/evaluation.json", true), C.chargerJSON("data/mesures_agregees.json", true)
  ]).then(function (d) {
    afficher(d[0], d[1], d[2], d[3]);
  }).catch(function (err) { C.erreurChargement("source", err); });

  function afficher(P, gci, evaluation, mesures) {
    const pays = Object.keys(P.pays);   // ordre de parametres.json : SN, GH, MA, CI
    let indicateurs = [];

    if (evaluation && mesures) {
      const m = evaluation.meta;
      document.getElementById("source").innerHTML = "Mesure passive de " + m.nb_domaines + " domaines publics (" +
        e(C.periode(m.periode_mesure)) + "), moteur " + e(m.moteur) + ". Effectifs par pays indiqués (n).";
      afficherFacteurs(P, pays, evaluation);
      indicateurs = afficherIndicateurs(P, pays, mesures, m.pays_etudie);
    } else {
      document.getElementById("source").textContent =
        "Mesures non encore exportées : les parties 1 et 2 s'afficheront après la commande exporter du moteur.";
      document.getElementById("facteurs").innerHTML = "<p class=\"note\">À venir.</p>";
    }
    afficherGCI(P, pays, gci);
    installerSelection(P, pays, indicateurs);
  }

  // Facteurs mesurés et indicateurs complémentaires : niveau, confiance, effectif.
  function afficherFacteurs(P, pays, evaluation) {
    const codes = Object.keys(P.facteurs_mesures).map(function (c) { return { code: c, type: "facteur", def: P.facteurs_mesures[c] }; })
      .concat(Object.keys(P.indicateurs_complementaires || {}).map(function (c) {
        return { code: c, type: "complementaire", def: P.indicateurs_complementaires[c] };
      }));
    let h = "<div class=\"defile\"><table><thead><tr><th scope=\"col\">Facteur</th>" +
      pays.map(function (p) { return "<th scope=\"col\" data-pays=\"" + p + "\">" + e(P.pays[p]) + "</th>"; }).join("") + "</tr></thead><tbody>";
    codes.forEach(function (c) {
      const titre = c.code + " " + c.def.intitule + (c.type === "complementaire" ? " (indicateur complémentaire)" : "");
      h += "<tr><th scope=\"row\">" + e(titre) + "</th>" + pays.map(function (p) {
        const x = (evaluation.pays[p] || []).find(function (l) {
          return l.code === c.code && l.type === c.type && /^mesure/.test(l.base || "");
        });
        if (!x) return "<td data-pays=\"" + p + "\">—</td>";
        return "<td data-pays=\"" + p + "\">" + C.badge(x.niveau) + " " + C.badge(x.confiance, C.CONFIANCE_MESURE) +
          "<br><span class=\"note\">échantillon " + e(effectif(x.base)) + "</span></td>";
      }).join("") + "</tr>";
    });
    h += "</tbody></table></div><p class=\"note\">Niveau : indicateur le moins avancé du facteur ; confiance selon la " +
      "taille de l'échantillon (voir Méthode). Pour le Sénégal, le niveau retenu de D5.1 reste celui des preuves " +
      "documentaires ; la mesure est un indicateur complémentaire.</p>";
    document.getElementById("facteurs").innerHTML = h;
  }

  // « mesure (n=12), indicateur complémentaire » → « n = 12 ».
  function effectif(base) {
    const m = /n=(\d+)/.exec(base || "");
    return m ? "n = " + m[1] : "";
  }

  // Un graphique par indicateur : quatre barres verticales groupées, une par pays, en
  // pourcentage de sites conformes ; sous chaque barre, le pays et l'effectif mesuré (n).
  // Les traits pointillés marquent les seuils de niveau de parametres.json.
  // Renvoie la liste des indicateurs affichés (pour la sélection).
  function afficherIndicateurs(P, pays, mesures, etudie) {
    const s = P.seuils_mesure_pct;
    document.getElementById("legende").innerHTML = "Hauteur des barres : part des sites conformes. Traits pointillés " +
      "<span class=\"trait-h\"></span> : seuils de niveau (" + s.structure + " % et " + s.consolide + " %). " +
      "Survoler une barre pour le détail.";
    let indicateurs = [];
    [P.facteurs_mesures, P.indicateurs_complementaires || {}].forEach(function (groupe) {
      Object.keys(groupe).forEach(function (code) {
        groupe[code].indicateurs.forEach(function (ind) { indicateurs.push({ ind: ind, code: code }); });
      });
    });
    indicateurs = indicateurs.concat([{ ind: "spf", code: "" }, { ind: "heberge_national", code: "" }]);
    const exemple = pays.map(function (p) { return mesures.pays[p]; }).find(Boolean);
    let h = "";
    indicateurs.forEach(function (i) {
      i.libelle = exemple ? exemple.indicateurs[i.ind].libelle : i.ind;
      h += "<figure class=\"carte graphe\" data-indicateur=\"" + e(i.ind) + "\"><figcaption><h3>" + e(i.libelle) +
        (i.code ? " <small class=\"note\">(" + e(i.code) + ")</small>" : "") + "</h3></figcaption><div class=\"colonnes\">";
      pays.forEach(function (p) {
        const v = mesures.pays[p] && mesures.pays[p].indicateurs[i.ind];
        const mesure = v && v.pct !== null;
        h += "<div class=\"colonne" + (p === etudie ? " etudie" : "") + "\" data-pays=\"" + p + "\">" +
          "<span class=\"valeur-col\">" + (mesure ? C.compteur(v.pct, 0, " %") : "—") + "</span>" +
          "<span class=\"tige\"" + (mesure ? " tabindex=\"0\" role=\"img\" aria-label=\"" + e(infoBarre(P, P.pays[p], i.libelle, v)) +
            "\" data-info=\"" + e(infoBarre(P, P.pays[p], i.libelle, v)) + "\"" : "") + ">" +
            (mesure ? "<span class=\"remplissage-v\" style=\"height:" + v.pct + "%\"></span>" : "") +
            "<span class=\"seuil-h\" style=\"bottom:" + s.structure + "%\"></span>" +
            "<span class=\"seuil-h\" style=\"bottom:" + s.consolide + "%\"></span></span>" +
          "<span class=\"pays-col\">" + e(P.pays[p]) + "</span>" +
          "<span class=\"n-col\">" + (v && v.n ? "n\u00a0=\u00a0" + v.n : "non mesuré") + "</span></div>";
      });
      h += "</div></figure>";
    });
    document.getElementById("indicateurs").innerHTML = h;
    return indicateurs;
  }

  // Texte de l'infobulle d'une barre : valeur, effectif, niveau et seuils.
  function infoBarre(P, nomPays, libelle, v) {
    const s = P.seuils_mesure_pct;
    return nomPays + " · " + libelle + " : " + v.pct + " % des domaines conformes (n = " + v.n + "). " +
      "Niveau selon les seuils : " + window.SenCyR.niveauMesure(v.pct, P) + " (structuré à partir de " +
      s.structure + " %, consolidé à partir de " + s.consolide + " %).";
  }

  function afficherGCI(P, pays, gci) {
    const parPays = {};
    gci.forEach(function (l) { parPays[l.pays] = l; });
    const lignes = pays.filter(function (p) { return parPays[p]; }).map(function (p) {
      const l = parPays[p];
      const score = Number(l.score_global);
      return {
        attributs: "data-pays=\"" + p + "\"",
        cellules: [e(P.pays[p]),
          "<span class=\"pct\" role=\"img\" aria-label=\"" + C.nombre(score, 2) + " sur 100\" tabindex=\"0\" data-info=\"" +
            e(P.pays[p] + " · score global GCI 2024 : " + C.nombre(score, 2) + " sur 100 (référence publiée, non recalculée).") +
            "\"><span class=\"remplissage\" style=\"width:" + score + "%\"></span></span> " + C.compteur(score, 2)]
          .concat(["juridique", "technique", "organisationnel", "capacites", "cooperation"].map(function (k) {
            return C.nombre(l[k], 2);
          }))
      };
    });
    C.remplirTable("t-gci", ["Pays", "Score global /100", "Juridique /20", "Technique /20", "Organisationnel /20",
      "Capacités /20", "Coopération /20"], lignes);
  }

  // Sélection : un indicateur (ou tous) et les pays affichés, appliquée aux trois parties.
  function installerSelection(P, pays, indicateurs) {
    const zone = document.getElementById("selection");
    let h = "";
    if (indicateurs.length) {
      h += "<label>Indicateur <select id=\"choix-indicateur\"><option value=\"\">tous</option>" +
        indicateurs.map(function (i) { return "<option value=\"" + e(i.ind) + "\">" + e(i.libelle) + "</option>"; }).join("") +
        "</select></label>";
    }
    h += "<span>Pays : " + pays.map(function (p) {
      return "<label><input type=\"checkbox\" value=\"" + p + "\" checked> " + e(P.pays[p]) + "</label>";
    }).join(" ") + "</span>";
    zone.innerHTML = h;
    zone.addEventListener("change", function () {
      const choix = document.getElementById("choix-indicateur");
      const indicateur = choix ? choix.value : "";
      const coches = Array.prototype.filter.call(zone.querySelectorAll("input[type=checkbox]"), function (c) { return c.checked; })
        .map(function (c) { return c.value; });
      document.querySelectorAll(".graphe[data-indicateur]").forEach(function (carte) {
        carte.classList.toggle("masque", !!indicateur && carte.dataset.indicateur !== indicateur);
      });
      document.querySelectorAll("main [data-pays]").forEach(function (el) {
        el.classList.toggle("masque", coches.indexOf(el.dataset.pays) < 0);
      });
    });
  }
})();
