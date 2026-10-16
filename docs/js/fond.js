/*
 * fond.js : choix du fond de page (clair, sable, sombre), mémorisé dans le navigateur.
 * Chargé dans <head> pour appliquer le fond avant l'affichage. Le stockage local peut
 * être indisponible (navigation privée, stockage bloqué) : le site reste alors utilisable
 * avec le fond clair, et le choix vaut pour la page en cours.
 */
(function () {
  "use strict";
  const CLE = "sencyr-fond";
  const FONDS = [
    { id: "clair", nom: "Fond clair" },
    { id: "sable", nom: "Fond sable" },
    { id: "sombre", nom: "Fond sombre" }
  ];
  const DEFAUT = "clair";

  function lire() {
    try {
      const v = window.localStorage.getItem(CLE);
      return FONDS.some(function (f) { return f.id === v; }) ? v : DEFAUT;
    } catch (e) {
      return DEFAUT;
    }
  }

  function enregistrer(v) {
    try { window.localStorage.setItem(CLE, v); } catch (e) { /* stockage indisponible : choix non mémorisé */ }
  }

  function appliquer(v) {
    if (v === DEFAUT) document.documentElement.removeAttribute("data-fond");
    else document.documentElement.setAttribute("data-fond", v);
    document.querySelectorAll(".fonds button").forEach(function (b) {
      b.setAttribute("aria-pressed", String(b.dataset.fond === v));
    });
  }

  appliquer(lire());

  // Boutons à l'extrême droite de l'en-tête, une fois la page construite.
  document.addEventListener("DOMContentLoaded", function () {
    const entete = document.querySelector(".entete-barre");
    if (!entete) return;
    const groupe = document.createElement("div");
    groupe.className = "fonds";
    groupe.setAttribute("role", "group");
    groupe.setAttribute("aria-label", "Fond de la page");
    FONDS.forEach(function (f) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "f-" + f.id;
      b.dataset.fond = f.id;
      b.title = f.nom;
      b.setAttribute("aria-label", f.nom);
      b.addEventListener("click", function () { enregistrer(f.id); appliquer(f.id); });
      groupe.appendChild(b);
    });
    entete.appendChild(groupe);
    appliquer(lire());
  });
})();
