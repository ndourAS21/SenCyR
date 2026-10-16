/*
 * animations.js : apparition des sections au défilement, compteurs qui s'incrémentent,
 * barres qui se remplissent quand elles deviennent visibles.
 * Rien n'est animé si l'utilisateur a demandé moins de mouvement (prefers-reduced-motion),
 * ni à l'impression. Sans JavaScript, le contenu s'affiche directement : les valeurs
 * finales sont déjà dans la page, ce script ne fait que les rejouer.
 */
(function () {
  "use strict";
  const reduit = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduit || !("IntersectionObserver" in window)) return;

  document.documentElement.classList.add("anim");

  function formater(v, decimales) {
    return v.toLocaleString("fr-FR", { minimumFractionDigits: decimales, maximumFractionDigits: decimales });
  }

  // Valeur finale d'un compteur, sans animation (impression, fin d'animation).
  function terminer(el) {
    el.dataset.fait = "1";
    el.textContent = formater(Number(el.dataset.compteur), Number(el.dataset.decimales || 0)) + (el.dataset.suffixe || "");
  }

  // Compteur : de 0 à la valeur finale en 0,9 s, avec un ralenti en fin de course.
  function animer(el) {
    if (el.dataset.fait) return;
    el.dataset.fait = "1";
    const fin = Number(el.dataset.compteur), decimales = Number(el.dataset.decimales || 0), suffixe = el.dataset.suffixe || "";
    const debut = performance.now(), duree = 900;
    function pas(t) {
      const p = Math.min(1, (t - debut) / duree);
      const ralenti = 1 - Math.pow(1 - p, 3);
      el.textContent = formater(fin * ralenti, decimales) + suffixe;
      if (p < 1) requestAnimationFrame(pas);
    }
    requestAnimationFrame(pas);
  }

  const observateurSections = new IntersectionObserver(function (entrees) {
    entrees.forEach(function (e) {
      if (e.isIntersecting) { e.target.classList.add("visible"); observateurSections.unobserve(e.target); }
    });
  }, { threshold: 0.08 });

  const observateurCompteurs = new IntersectionObserver(function (entrees) {
    entrees.forEach(function (e) {
      if (e.isIntersecting) { animer(e.target); observateurCompteurs.unobserve(e.target); }
    });
  }, { threshold: 0.5 });

  function surveillerCompteurs(racine) {
    racine.querySelectorAll("[data-compteur]:not([data-fait])").forEach(function (el) { observateurCompteurs.observe(el); });
  }

  document.addEventListener("DOMContentLoaded", function () {
    const main = document.querySelector("main");
    if (!main) return;
    // Chaque bloc de premier niveau apparaît quand il entre dans la fenêtre.
    Array.prototype.forEach.call(main.children, function (el) {
      el.classList.add("revele");
      observateurSections.observe(el);
    });
    surveillerCompteurs(main);
    // Les tableaux et chiffres sont ajoutés après le chargement des données.
    new MutationObserver(function () { surveillerCompteurs(main); }).observe(main, { childList: true, subtree: true });
  });

  // Impression : tout est affiché, valeurs finales.
  window.addEventListener("beforeprint", function () {
    document.querySelectorAll(".revele").forEach(function (el) { el.classList.add("visible"); });
    document.querySelectorAll("[data-compteur]").forEach(terminer);
  });
})();
