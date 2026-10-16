/*
 * methode.js : complète la page Méthode avec les valeurs de data/parametres.json
 * (seuils, échantillons, rattachement des indicateurs, protocole, diffusion).
 * Aucune valeur n'est écrite dans la page elle-même.
 */
(function () {
  "use strict";
  const C = window.Commun;

  // Intitulés des indicateurs (mêmes libellés que le moteur).
  const LIBELLES = {
    cert_valide: "Certificat valide", tls_moderne: "TLS 1.2 ou 1.3", redir_https: "Redirection HTTP vers HTTPS",
    hsts: "En-tête HSTS", entetes_3plus: "Au moins 3 en-têtes de sécurité", dnssec: "Zone signée DNSSEC",
    dmarc_applique: "DMARC appliqué (quarantine/reject)"
  };

  C.chargerJSON("data/parametres.json").then(function (P) {
    const s = P.seuils_mesure_pct, c = P.confiance_mesure, m = P.mesure_passive;
    const remplir = function (cle, texte) {
      document.querySelectorAll("[data-param=\"" + cle + "\"]").forEach(function (el) { el.textContent = texte; });
    };
    remplir("seuils", "moins de " + s.structure + " % : émergent ; de " + s.structure + " % à moins de " + s.consolide +
      " % : structuré ; " + s.consolide + " % et plus : consolidé");
    remplir("echantillon", c.niveau_confiance_pct + " %");
    remplir("seuil_structure", s.structure + " %");
    remplir("seuil_consolide", s.consolide + " %");
    remplir("delai", m.delai_entre_domaines_s + " s");
    remplir("timeout", m.timeout_s + " s");
    remplir("minimum", String(P.taille_minimale_agregat));

    const lignes = [];
    [[P.facteurs_mesures, "Niveau du facteur"], [P.indicateurs_complementaires || {}, "Indicateur complémentaire"]]
      .forEach(function (groupe) {
        Object.keys(groupe[0]).forEach(function (code) {
          const f = groupe[0][code];
          lignes.push([C.echapper(code + " " + f.intitule), C.echapper(groupe[1]),
            C.echapper(f.indicateurs.map(function (i) { return LIBELLES[i] || i; }).join(" ; "))]);
        });
      });
    C.remplirTable("t-mesures", ["Facteur", "Usage de la mesure", "Indicateurs"], lignes);
  }).catch(function (e) { C.erreurChargement("seuils", e); });
})();
