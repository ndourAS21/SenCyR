/*
 * entete.js : la barre de menu reste fixe en haut ; dès que la page défile, elle
 * prend la classe « reduite » (hauteur un peu plus faible, ombre légère).
 * Le corps de page est décalé en CSS (--decalage) : le contenu ne passe pas dessous.
 */
(function () {
  "use strict";
  document.addEventListener("DOMContentLoaded", function () {
    const entete = document.querySelector(".entete");
    if (!entete) return;
    let attente = false;
    function mettreAJour() {
      attente = false;
      entete.classList.toggle("reduite", window.scrollY > 8);
    }
    window.addEventListener("scroll", function () {
      if (!attente) { attente = true; window.requestAnimationFrame(mettreAJour); }
    }, { passive: true });
    mettreAJour();

    // Mobile : la ligne de liens défile horizontalement ; le lien de la page courante
    // est ramené au centre de cette ligne.
    const nav = entete.querySelector("nav");
    const courant = nav && nav.querySelector("[aria-current=\"page\"]");
    if (courant && nav.scrollWidth > nav.clientWidth) {
      nav.scrollLeft = courant.offsetLeft - (nav.clientWidth - courant.offsetWidth) / 2;
    }
  });
})();
