# SenCyR

Plateforme d'évaluation de la cyber-résilience nationale fondée sur le CMM 2021.
Elle met en œuvre la grille du mémoire : échelle émergent / structuré / consolidé,
statut « non évaluable », règles R3 (confiance), R5 (niveau) et R6 (priorité),
et la lecture par fonction de résilience (fonctions de résilience).

Deux couches :
- `moteur/cyberres.py` : mesure passive des domaines, évaluation, export des données agrégées ;
- `docs/` : site statique (HTML, CSS, JavaScript sans framework) publié par GitHub Pages.
  Les règles y sont codées une fois, dans `docs/js/regles.js`.

## Installation

    pip install dnspython requests

Python 3.9 ou plus (dnspython et requests ne servent qu'à la commande `mesure`).
Node.js, facultatif, pour les tests de `regles.js`.

## Utilisation (depuis la racine du dépôt)

Avant la première mesure, renseignez l'adresse de contact transmise dans l'en-tête User-Agent :

    set SENCYR_CONTACT=votre.adresse@exemple.sn        (Windows, invite de commandes)
    $env:SENCYR_CONTACT="votre.adresse@exemple.sn"     (Windows, PowerShell)
    export SENCYR_CONTACT=votre.adresse@exemple.sn     (Linux, macOS)

Puis :

    python moteur/cyberres.py mesure   donnees/domaines.csv -o mesures.csv
    python moteur/cyberres.py evaluer  mesures.csv donnees/preuves.csv -o evaluation.csv
    python moteur/cyberres.py rapport  mesures.csv evaluation.csv -o rapport.html
    python moteur/cyberres.py exporter mesures.csv donnees/preuves.csv -o docs/data

`rapport.html` contient le détail par domaine : document local, à ne pas publier.
`exporter` écrit dans `docs/data` les seules données publiées : agrégats par pays et par
famille de secteurs, sans nom d'institution, de domaine ni d'opérateur d'hébergement. Une
famille de moins de `taille_minimale_agregat` domaines n'est pas publiée.

Chaque exécution ajoute une ligne à `journal_executions.jsonl` : date, version du moteur,
paramètres utilisés, nombre de domaines, fichiers lus et écrits.

Un autre fichier de paramètres se passe avant la commande :

    python moteur/cyberres.py --parametres autres.json evaluer mesures.csv donnees/preuves.csv

## Site en local

    python -m http.server 8000 --directory docs

puis http://localhost:8000 (un serveur est nécessaire : le navigateur
refuse de lire les fichiers JSON d'une page ouverte par double-clic).

Pages : accueil, auto-diagnostic, tableau de bord, benchmark, méthode. Le tableau de bord et
le benchmark lisent `data/evaluation.json` et `data/mesures_agregees.json` ; tant qu'ils
n'existent pas, ils affichent l'évaluation documentaire seule et signalent l'absence de mesure.

## Tests

    node tests/regles.test.js
    python -m unittest discover -s moteur/tests -v

Les deux suites vérifient les attendus du cahier des charges (§7) sur `donnees/preuves.csv`.
La suite Python vérifie aussi que le moteur et `regles.js` donnent les mêmes résultats
(si Node est installé) et que l'export ne contient ni institution ni domaine.

## Fichiers de données (`donnees/`)

- `domaines.csv` : `pays,institution,secteur,secteur_detail,domaine`. Code pays ISO (SN, GH, MA, CI).
  `secteur` : famille de secteurs, utilisée pour les agrégats publiés ; `secteur_detail` : secteur
  d'origine, usage local.
  La liste complète (115 domaines : SN 40, GH 25, MA 25, CI 25) reste en local et n'est pas
  publiée.
- `preuves.csv` : base de preuves documentaires, extraite de l'annexe A du mémoire
  (facteur, appréciation, références, niveaux de fiabilité A à D, absence de trace R2,
  source indirecte, convergence des sources, critères R6, recommandation).
- `aspects.csv` : aspects des facteurs décomposés (D1.1 a, b, c).
- `fonctions.csv` : tableau 2.1 (facteurs ou aspects qui conditionnent chaque fonction).
- `gci2024.csv` : scores GCI 2024 des quatre pays (référence du benchmark).
- `parametres.json` : seuils de niveau, méthode de confiance (Wilson), facteurs mesurés (D5.2, D5.4),
  indicateur complémentaire (D5.1), taille minimale d'un agrégat publié.

## Ce que l'outil mesure (passif)

Certificat et version TLS, redirection HTTPS, en-têtes de sécurité (HSTS, CSP,
X-Frame-Options, X-Content-Type-Options, Referrer-Policy), SPF, DMARC, signature DNSSEC
de la zone, opérateur et pays d'hébergement (service DNS public Team Cymru).

## Périmètre éthique

Uniquement ce que fait un navigateur ou un résolveur DNS ordinaire. Aucun scan de ports,
aucune recherche de vulnérabilité, aucune tentative d'authentification. Une requête par
service et par domaine (renouvelée une fois sans vérification si le certificat est refusé),
2 secondes entre deux domaines, User-Agent identifiant la recherche.

## Paramètres réglés par questionnaire

`seuils_mesure_pct` (60 % / 80 %), `confiance_mesure` (intervalle de Wilson à 95 %) et le
rattachement des indicateurs aux facteurs (`facteurs_mesures`, `indicateurs_complementaires`).

## Concordance avec l'évaluation manuelle du mémoire

Sur `preuves.csv`, sans mesure : niveau et confiance identiques pour les 23 facteurs.
Les écarts de méthode entre l'outil et le mémoire sont consignés dans
`ecarts_outil_memoire.md`.
