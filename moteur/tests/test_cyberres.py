# -*- coding: utf-8 -*-
"""
Tests du moteur SenCyR (bibliothèque standard uniquement).
Lancement, depuis la racine du dépôt :  python -m unittest discover -s moteur/tests -v

Mêmes attendus que tests/regles.test.js (§7 du cahier des charges), plus :
  - la parité avec docs/js/regles.js (si Node est installé) ;
  - l'export : aucun nom d'institution ni de domaine, petits secteurs masqués.
Les mesures utilisées ici sont fictives (domaines en .test), générées par le test.
"""
import argparse, copy, json, shutil, subprocess, sys, tempfile, unittest
from pathlib import Path

RACINE = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(RACINE / "moteur"))
import cyberres as M  # noqa: E402

DONNEES = RACINE / "donnees"
P = M.charger_parametres(DONNEES / "parametres.json")
PREUVES = M.lire(DONNEES / "preuves.csv")
ASPECTS = M.lire(DONNEES / "aspects.csv")
FONCTIONS = M.lire_fonctions(DONNEES / "fonctions.csv")


def evaluation_sans_mesure():
    return M.evaluer_pays("SN", [], PREUVES, ASPECTS, FONCTIONS, P, etudie=True)


def par_type(ev, t):
    return {e["facteur"]: e for e in ev if e["type"] == t}


def mesures_fictives():
    """Mesures inventées : 12 domaines SN (secteur A : 4, secteur B : 6, secteur C : 2), 10 GH."""
    rows = []
    for pays, secteurs in (("SN", ["Secteur A"] * 4 + ["Secteur B"] * 6 + ["Secteur C"] * 2),
                           ("GH", ["Secteur A"] * 10)):
        for i, s in enumerate(secteurs):
            r = {c: "" for c in M.COLS}
            ok = int(i % 2 == 0)
            r.update(date_mesure="2026-10-11 10:00 UTC", pays=pays, institution=f"Institution fictive {pays}{i:02d}",
                     secteur=s, domaine=f"exemple-{pays.lower()}{i:02d}.test", zone_dns=f"exemple-{pays.lower()}{i:02d}.test",
                     resolu=1, https_ok=1, cert_valide=1, tls_moderne=1, redir_https=ok, hsts=ok, entetes_3plus=0,
                     spf=1, dmarc=1, dmarc_applique=ok, dnssec=0, asn_nom="OPERATEUR-FICTIF" if i < 5 else f"AS-{i}",
                     pays_hebergement=pays, heberge_national=1)
            rows.append(r)
    return rows


class R3(unittest.TestCase):
    def test_cas(self):
        cas = [((["A", "A"], False, True, True), "faible"),
               (([], True, False, True), "moyenne"),
               (([], False, False, True), "—"),
               ((["A", "C"], False, False, True), "élevée"),
               ((["A", "A"], True, False, True), "moyenne"),
               ((["C"], False, False, True), "faible"),
               ((["C", "C", "C"], False, False, True), "moyenne"),
               ((["A"], False, False, True), "moyenne"),
               ((["B"], False, False, True), "moyenne"),
               ((["A", "A"], False, False, False), "moyenne"),
               ((["A", "C"], False, False, False), "moyenne"),
               ((["C", "C"], False, False, False), "faible"),
               ((["D", "D"], False, False, True), "—")]
        for args, attendu in cas:
            self.assertEqual(M.confiance_R3(*args), attendu, args)


class R5R6(unittest.TestCase):
    def e(self, a, c):
        return dict(appreciation=a, confiance=c)

    def test_egalite_niveau_inferieur(self):
        self.assertEqual(M.agreger_R5([self.e("structuré", "élevée"), self.e("émergent", "moyenne")])["appreciation"], "émergent")

    def test_confiance_plus_faible(self):
        r = M.agreger_R5([self.e("émergent", "élevée"), self.e("émergent", "moyenne"), self.e("structuré", "faible")])
        self.assertEqual(r["confiance"], "moyenne")

    def test_hors_perimetre(self):
        r = M.agreger_R5([self.e("émergent", "moyenne"), self.e("non évaluable", "—"), self.e("hors périmètre", "—")])
        self.assertEqual((r["evaluables"], r["total"]), (1, 2))

    def test_aspects(self):
        self.assertEqual(M.niveau_par_aspects(["structuré", "émergent", "non évaluable"]), "émergent")

    def test_R6(self):
        self.assertEqual([M.priorite_R6("émergent", *c) for c in
                          [(1, 1, 1), (0, 1, 1), (0, 1, 0), (0, 0, 0)]], ["1", "2", "3", "3"])
        self.assertEqual(M.priorite_R6("structuré", 1, 1, 1), "—")


class Seuils(unittest.TestCase):
    def test_lus_dans_parametres(self):
        s = P["seuils_mesure_pct"]
        self.assertEqual([M.niveau_pct(x, P) for x in (s["structure"] - 1, s["structure"], s["consolide"] - 1, s["consolide"])],
                         ["émergent", "structuré", "structuré", "consolidé"])
        autres = copy.deepcopy(P)
        autres["seuils_mesure_pct"]["structure"] = s["structure"] + 10
        self.assertEqual(M.niveau_pct(s["structure"] + 5, autres), "émergent")

    def test_wilson_cas_limites(self):
        for k, n in ((0, 1), (1, 1), (0, 40), (40, 40), (20, 40)):
            bas, haut = M.wilson(k, n)
            self.assertTrue(0 <= bas <= haut <= 100)
        bas, haut = M.wilson(20, 40)
        self.assertAlmostEqual(bas, 35.2, delta=0.2)
        self.assertAlmostEqual(haut, 64.8, delta=0.2)

    def test_confiance_wilson(self):
        # n=1 : l'intervalle couvre les trois bandes ; n grand et part nette : élevée ;
        # part proche d'un seuil : moyenne
        self.assertEqual(M.confiance_mesure(1, 1, P), "faible")
        self.assertEqual(M.confiance_mesure(0, 1, P), "moyenne")  # [0 ; 79] % : deux zones
        self.assertEqual(M.confiance_mesure(5, 100, P), "élevée")
        self.assertEqual(M.confiance_mesure(62, 100, P), "moyenne")
        self.assertEqual(M.confiance_mesure(100, 100, P), "élevée")
        autres = copy.deepcopy(P)
        autres["confiance_mesure"]["niveau_confiance_pct"] = 99
        self.assertIn(M.confiance_mesure(62, 100, autres), ("moyenne", "faible"))

    def test_confiance_facteur_indicateurs_fixants(self):
        rows = [dict(domaine=f"a{i}.sn", zone_dns=f"z{i}", hsts="0", dmarc_applique="1" if i < 2 else "0") for i in range(3)]
        rows += [dict(domaine=f"b{i}.sn", zone_dns=f"y{i}", hsts="0", dmarc_applique="0") for i in range(97)]
        niv, conf, det, n = M.facteur_mesure(rows, ["hsts", "dmarc_applique"], P)
        self.assertEqual((niv, n), ("émergent", 100))
        self.assertEqual(conf, "élevée")

    def test_D51_hors_facteurs_mesures(self):
        self.assertNotIn("D5.1", P["facteurs_mesures"])
        self.assertIn("D5.1", P["indicateurs_complementaires"])


class Attendus7(unittest.TestCase):
    """§7 du cahier des charges : Sénégal, preuves.csv, sans mesure."""
    @classmethod
    def setUpClass(cls):
        cls.ev = evaluation_sans_mesure()
        cls.f, cls.d = par_type(cls.ev, "facteur"), par_type(cls.ev, "dimension")

    def test_dimensions(self):
        attendu = {"D1": ("émergent", "moyenne", "3 facteurs évaluables sur 3"),
                   "D2": ("émergent", "faible", "3 facteurs évaluables sur 5"),
                   "D3": ("émergent", "moyenne", "4 facteurs évaluables sur 4"),
                   "D4": ("structuré", "moyenne", "4 facteurs évaluables sur 4"),
                   "D5": ("émergent", "moyenne", "2 facteurs évaluables sur 6")}
        for k, v in attendu.items():
            self.assertEqual((self.d[k]["appreciation"], self.d[k]["confiance"], self.d[k]["detail"]), v, k)

    def test_priorites(self):
        prio = lambda p: sorted(k for k, e in self.f.items() if e["priorite"] == p)
        self.assertEqual(prio("1"), ["D1.1", "D1.2"])
        self.assertEqual(prio("2"), ["D1.3", "D5.1"])
        self.assertEqual(prio("3"), ["D2.1", "D2.2", "D3.1", "D3.3", "D3.4", "D5.6"])

    def test_concordance_23_sur_23(self):
        conc = [e for e in self.f.values() if e["concordance"]]
        self.assertEqual((len(conc), [e["facteur"] for e in conc if e["concordance"] != "oui"]), (23, []))

    def test_aspects_D11(self):
        a = par_type(self.ev, "aspect")
        self.assertEqual([(k, a[k]["appreciation"], a[k]["confiance"]) for k in sorted(a)],
                         [("D1.1a", "émergent", "moyenne"), ("D1.1b", "émergent", "élevée"), ("D1.1c", "non évaluable", "—")])

    def test_portee_tableau_21(self):
        for p in PREUVES:
            if p["portee"]:
                self.assertEqual(M.portee_R6(p["facteur"], FONCTIONS), M.oui(p["portee"]), p["facteur"])

    def test_fonctions(self):
        fn = par_type(self.ev, "fonction")
        attendu = {"Anticiper": ("émergent", "moyenne"), "Résister": ("émergent", "moyenne"),
                   "Répondre et se rétablir": ("structuré", "moyenne"), "S'adapter": ("émergent", "moyenne"),
                   "Contribution transversale": ("structuré", "élevée")}
        self.assertEqual({k: (v["appreciation"], v["confiance"]) for k, v in fn.items()}, attendu)


@unittest.skipUnless(shutil.which("node"), "Node absent : parité Python/JavaScript non vérifiée")
class Parite(unittest.TestCase):
    """Le moteur et docs/js/regles.js donnent les mêmes résultats sur preuves.csv."""
    def test_memes_resultats(self):
        script = (
            "const R=require(process.argv[1]);let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{"
            "const x=JSON.parse(s);const r=R.evaluer(x.preuves.map(l=>R.declarationDepuisPreuve(l,x.aspects)),"
            "R.lireFonctions(x.fonctions));const o={};"
            "r.facteurs.forEach(f=>{o[f.facteur]=[f.niveau,f.confiance,f.priorite===null?'—':String(f.priorite)];"
            "f.aspects.forEach(a=>o[a.aspect]=[a.niveau,a.confiance,'—'])});"
            "r.dimensions.forEach(d=>o[d.dimension]=[d.niveau,d.confiance,d.evaluables+'/'+d.total]);"
            "r.fonctions.forEach(f=>o[f.fonction]=[f.niveau,f.confiance,f.evaluables+'/'+f.total]);"
            "console.log(JSON.stringify(o))})")
        entree = json.dumps(dict(preuves=PREUVES, aspects=ASPECTS, fonctions=M.lire(DONNEES / "fonctions.csv")))
        js = json.loads(subprocess.run(["node", "-e", script, str(RACINE / "docs" / "js" / "regles.js")],
                                       input=entree, capture_output=True, text=True, encoding="utf-8", check=True).stdout)
        py = {}
        for e in evaluation_sans_mesure():
            if e["type"] in ("facteur", "aspect"):
                py[e["facteur"]] = [e["appreciation"], e["confiance"], e["priorite"]]
            elif e["type"] in ("dimension", "fonction"):
                n = e["detail"].split()
                py[e["facteur"]] = [e["appreciation"], e["confiance"], f"{n[0]}/{n[-1]}"]
        self.assertEqual(py, js)

    def test_wilson_memes_resultats(self):
        """Confiance de Wilson : mêmes résultats en Python et en JavaScript pour n de 1 à 60 et n = 115."""
        script = ("const R=require(process.argv[1]);const P=JSON.parse(require('fs').readFileSync(process.argv[2],'utf8'));"
                  "const o=[];for(const n of [...Array(60).keys()].map(x=>x+1).concat([115]))"
                  "for(let k=0;k<=n;k++)o.push(R.confianceMesure(k,n,P));console.log(JSON.stringify(o))")
        js = json.loads(subprocess.run(["node", "-e", script, str(RACINE / "docs" / "js" / "regles.js"),
                                        str(DONNEES / "parametres.json")],
                                       capture_output=True, text=True, encoding="utf-8", check=True).stdout)
        py = [M.confiance_mesure(k, n, P) for n in list(range(1, 61)) + [115] for k in range(n + 1)]
        self.assertEqual(py, js)


class Export(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = Path(tempfile.mkdtemp())
        mesures = mesures_fictives()
        M.ecrire(cls.tmp / "mesures.csv", mesures, M.COLS)
        cls.journal_avant = M.JOURNAL
        M.JOURNAL = cls.tmp / "journal.jsonl"
        a = argparse.Namespace(mesures=str(cls.tmp / "mesures.csv"), preuves=str(DONNEES / "preuves.csv"),
                               aspects=None, fonctions=None, gci=None, pays="SN", o=str(cls.tmp / "data"),
                               parametres=str(DONNEES / "parametres.json"))
        M.cmd_exporter(a, P)
        cls.data = cls.tmp / "data"
        cls.mesures = mesures

    @classmethod
    def tearDownClass(cls):
        M.JOURNAL = cls.journal_avant
        shutil.rmtree(cls.tmp)

    def test_fichiers(self):
        for nom in ("evaluation", "mesures_agregees", "preuves", "aspects", "fonctions", "gci2024", "parametres"):
            self.assertTrue((self.data / f"{nom}.json").exists(), nom)

    def test_aucune_institution_ni_domaine(self):
        texte = "".join((self.data / f).read_text(encoding="utf-8") for f in ("evaluation.json", "mesures_agregees.json"))
        for m in self.mesures:
            self.assertNotIn(m["institution"], texte)
            self.assertNotIn(m["domaine"], texte)

    def test_petits_secteurs_et_operateurs_masques(self):
        sn = json.loads((self.data / "mesures_agregees.json").read_text(encoding="utf-8"))["pays"]["SN"]
        self.assertEqual(sorted(sn["secteurs"]), ["Secteur A", "Secteur B"])     # C : 2 domaines < 3
        self.assertEqual(sn["domaines_non_publies_par_secteur"], 2)
        self.assertEqual(sn["hebergement"], dict(n=12, nb_operateurs=8, part_premier_operateur_pct=42,
                                                 pays_hebergement={"SN": 12}))

    def test_aucun_operateur_nomme(self):
        texte = (self.data / "mesures_agregees.json").read_text(encoding="utf-8")
        self.assertNotIn("OPERATEUR-FICTIF", texte)
        self.assertNotIn("AS-5", texte)

    def test_D51_documentaire_D52_mesure(self):
        sn = {e["code"] + e["type"]: e for e in json.loads((self.data / "evaluation.json").read_text(encoding="utf-8"))["pays"]["SN"]}
        self.assertEqual(sn["D5.1facteur"]["base"], "documentaire")
        self.assertTrue(sn["D5.1complementaire"]["base"].startswith("mesure"))
        self.assertTrue(sn["D5.2facteur"]["base"].startswith("mesure"))

    def test_journal(self):
        ligne = json.loads(M.JOURNAL.read_text(encoding="utf-8").splitlines()[-1])
        self.assertEqual((ligne["commande"], ligne["version"], ligne["nb_domaines"]), ("exporter", M.VERSION, 22))
        self.assertEqual(ligne["parametres"]["seuils_mesure_pct"], P["seuils_mesure_pct"])


if __name__ == "__main__":
    unittest.main()
