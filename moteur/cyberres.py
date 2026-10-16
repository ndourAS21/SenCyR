#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
SenCyR, moteur : évaluation de la cyber-résilience nationale fondée sur le CMM 2021.

Commandes :
  mesure    collecte passive d'indicateurs techniques sur une liste de domaines publics
  evaluer   applique la grille du mémoire (échelle, R3, R5, R6) aux preuves documentaires
            et aux mesures : niveau, confiance et priorité par facteur, dimension, fonction
  rapport   tableau de bord HTML local (détail par domaine : à ne pas publier)
  exporter  fichiers JSON agrégés pour la plateforme (docs/data), sans aucune institution

Exemples (depuis la racine du dépôt) :
  set SENCYR_CONTACT=adresse@exemple.sn          (Windows ; export SENCYR_CONTACT=... ailleurs)
  python moteur/cyberres.py mesure   donnees/domaines.csv -o mesures.csv
  python moteur/cyberres.py evaluer  mesures.csv donnees/preuves.csv -o evaluation.csv
  python moteur/cyberres.py rapport  mesures.csv evaluation.csv -o rapport.html
  python moteur/cyberres.py exporter mesures.csv donnees/preuves.csv -o docs/data

Paramètres (seuils, échantillons, facteurs mesurés) : donnees/parametres.json, ou --parametres.
Chaque exécution ajoute une ligne à journal_executions.jsonl (date, version, paramètres,
nombre de domaines).

Périmètre éthique et légal (ne pas modifier) : uniquement ce qu'effectue un navigateur ou
un résolveur DNS ordinaire. Aucun scan de ports, aucune recherche de vulnérabilité, aucune
tentative d'authentification. Une requête par service et par domaine (une seconde tentative
sans vérification si le certificat est refusé), délai entre domaines.
"""
import argparse, csv, datetime as dt, html, json, math, os, re, shutil, socket, ssl, sys, time, warnings
from pathlib import Path

VERSION = "1.1.0"
RACINE = Path(__file__).resolve().parent.parent
PARAMETRES_DEFAUT = RACINE / "donnees" / "parametres.json"
JOURNAL = RACINE / "journal_executions.jsonl"

# Échelle (tableau 2.2) et confiance (R3), du moins au plus avancé.
NIVEAUX = ["émergent", "structuré", "consolidé"]
CONF = ["faible", "moyenne", "élevée"]
NON_EVALUABLE, HORS_PERIMETRE, SANS_CONF = "non évaluable", "hors périmètre", "—"

DIMENSIONS = {"D1": "Politique et stratégie", "D2": "Culture et société",
              "D3": "Connaissances et capacités", "D4": "Cadres juridiques et réglementaires",
              "D5": "Normes et technologies"}

ENTETES = ["strict-transport-security", "content-security-policy", "x-frame-options",
           "x-content-type-options", "referrer-policy"]

LIBELLES = {
    "resolu": "Domaine résolu", "https_ok": "Site accessible en HTTPS",
    "cert_valide": "Certificat valide", "tls_moderne": "TLS 1.2 ou 1.3",
    "redir_https": "Redirection HTTP vers HTTPS", "hsts": "En-tête HSTS",
    "entetes_3plus": "Au moins 3 en-têtes de sécurité", "spf": "Enregistrement SPF",
    "dmarc": "Enregistrement DMARC", "dmarc_applique": "DMARC appliqué (quarantine/reject)",
    "dnssec": "Zone signée DNSSEC", "heberge_national": "Adresse IP enregistrée dans le pays",
}

COLS = ["date_mesure", "pays", "institution", "secteur", "domaine", "hote_web", "ip", "resolu",
        "https_ok", "tls_version", "tls_moderne", "cert_valide", "cert_jours_restants",
        "cert_emetteur", "redir_https", *ENTETES, "hsts", "entetes_3plus", "spf", "dmarc",
        "dmarc_politique", "dmarc_applique", "zone_dns", "dnssec", "asn", "asn_nom",
        "pays_hebergement", "heberge_national", "remarques"]

# Valeurs de la mesure passive, fixées par parametres.json au lancement de « mesure ».
TIMEOUT, DELAI, UA = 8, 2.0, ""
warnings.filterwarnings("ignore")


# ------------------------------------------------------------------ utilitaires
def lire(path):
    with open(path, encoding="utf-8-sig") as f:
        return list(csv.DictReader(f))


def ecrire(path, rows, cols):
    with open(path, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=cols, extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)


def ecrire_json(path, donnees):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(donnees, f, ensure_ascii=False, indent=1)


def charger_parametres(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def maintenant():
    return dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")


def journaliser(commande, P, chemin_parametres, nb_domaines, entrees, sortie):
    """Trace de chaque exécution : date, version, paramètres utilisés, nombre de domaines."""
    ligne = dict(date=maintenant(), version=VERSION, commande=commande,
                 fichier_parametres=str(chemin_parametres), parametres=P,
                 nb_domaines=nb_domaines, entrees=[str(e) for e in entrees], sortie=str(sortie))
    with open(JOURNAL, "a", encoding="utf-8") as f:
        f.write(json.dumps(ligne, ensure_ascii=False) + "\n")


def oui(v):
    return str(v or "").strip().lower().startswith("oui")


def convergent(v):
    """Colonne « convergentes » : vide ou absente → oui (valeur par défaut)."""
    return True if str(v or "").strip() == "" else oui(v)


# ------------------------------------------------------------------ module 1 : mesure
def resolveur():
    import dns.resolver
    r = dns.resolver.Resolver()
    r.lifetime = TIMEOUT
    return r


def txt(name):
    try:
        return [b"".join(r.strings).decode(errors="ignore") for r in RES.resolve(name, "TXT")]
    except Exception:
        return []


def existe(name, rtype):
    try:
        RES.resolve(name, rtype)
        return True
    except Exception:
        return False


def resoudre(host):
    try:
        return RES.resolve(host, "A")[0].to_text()
    except Exception:
        return None


def zone_dns(name):
    """Zone DNS qui contient le nom (premier ancêtre portant un SOA)."""
    labels = name.strip(".").split(".")
    for i in range(len(labels) - 1):
        z = ".".join(labels[i:])
        if existe(z, "SOA"):
            return z
    return name


def tls_info(h, rem):
    d = dict(tls_version="", tls_moderne=0, cert_valide=0, cert_jours_restants="", cert_emetteur="")
    for verifier in (True, False):
        ctx = ssl.create_default_context()
        if not verifier:
            ctx.check_hostname, ctx.verify_mode = False, ssl.CERT_NONE
        try:
            with socket.create_connection((h, 443), timeout=TIMEOUT) as s, \
                    ctx.wrap_socket(s, server_hostname=h) as ss:
                d["tls_version"] = ss.version() or ""
                d["tls_moderne"] = int(d["tls_version"] in ("TLSv1.2", "TLSv1.3"))
                if verifier:
                    c = ss.getpeercert()
                    d["cert_valide"] = 1
                    fin = dt.datetime.strptime(c["notAfter"], "%b %d %H:%M:%S %Y %Z")
                    d["cert_jours_restants"] = (fin - dt.datetime.utcnow()).days
                    d["cert_emetteur"] = dict(x[0] for x in c.get("issuer", ())).get("organizationName", "")
                return d
        except ssl.SSLCertVerificationError as e:
            rem.append("certificat refusé : " + str(e.verify_message))
        except Exception as e:
            rem.append("HTTPS indisponible : " + type(e).__name__)
            return d
    return d


def http_info(h):
    import requests
    d = {k: 0 for k in ["https_ok", "redir_https", "hsts", "entetes_3plus", *ENTETES]}
    hdr = {"User-Agent": UA}
    try:
        r = requests.get(f"http://{h}/", headers=hdr, timeout=TIMEOUT, allow_redirects=False)
        loc = r.headers.get("Location", "")
        d["redir_https"] = int(r.status_code in (301, 302, 303, 307, 308) and loc.lower().startswith("https://"))
    except Exception:
        pass
    for verify in (True, False):
        try:
            r = requests.get(f"https://{h}/", headers=hdr, timeout=TIMEOUT, verify=verify)
            d["https_ok"] = int(r.status_code < 500)
            presents = {k.lower() for k in r.headers}
            for e in ENTETES:
                d[e] = int(e in presents)
            d["hsts"] = d["strict-transport-security"]
            d["entetes_3plus"] = int(sum(d[e] for e in ENTETES) >= 3)
            break
        except requests.exceptions.SSLError:
            continue
        except Exception:
            break
    return d


def hebergement(ip):
    """ASN et pays d'enregistrement du bloc d'adresses (registre régional), via le service DNS
    public de Team Cymru. Ce n'est pas une géolocalisation."""
    try:
        rev = ".".join(reversed(ip.split(".")))
        champs = txt(f"{rev}.origin.asn.cymru.com")[0].split("|")
        asn, cc = champs[0].strip().split()[0], champs[2].strip()
        nom = txt(f"AS{asn}.asn.cymru.com")[0].split("|")[-1].strip()
        return asn, nom, cc
    except Exception:
        return "", "", ""


def mesurer_domaine(pays, dom):
    r = {c: "" for c in COLS}
    r.update(date_mesure=maintenant(), pays=pays, domaine=dom)
    rem = []
    hote, ip = dom, resoudre(dom)
    if not ip:
        hote = "www." + dom
        ip = resoudre(hote)
    r.update(hote_web=hote, ip=ip or "", resolu=int(bool(ip)))
    if ip:
        r.update(tls_info(hote, rem))
        r.update(http_info(hote))
        asn, nom, cc = hebergement(ip)
        r.update(asn=asn, asn_nom=nom, pays_hebergement=cc,
                 heberge_national=int(cc.upper() == pays.upper()) if cc else "")
    spf = [t for t in txt(dom) if t.lower().startswith("v=spf1")]
    dm = [t for t in txt("_dmarc." + dom) if t.lower().startswith("v=dmarc1")]
    pol = ""
    if dm:
        m = re.search(r"\bp\s*=\s*(\w+)", dm[0], re.I)
        pol = m.group(1).lower() if m else ""
    r.update(spf=int(bool(spf)), dmarc=int(bool(dm)), dmarc_politique=pol,
             dmarc_applique=int(pol in ("quarantine", "reject")))
    z = zone_dns(dom)
    r.update(zone_dns=z, dnssec=int(existe(z, "DS")), remarques="; ".join(rem))
    return r


def cmd_mesure(a, P):
    global TIMEOUT, DELAI, UA, RES
    contact = os.environ.get("SENCYR_CONTACT", "").strip()
    if not contact:
        sys.exit("Variable SENCYR_CONTACT absente : renseignez l'adresse de contact transmise dans "
                 "l'en-tête User-Agent (Windows : set SENCYR_CONTACT=adresse@exemple.sn).")
    TIMEOUT = P["mesure_passive"]["timeout_s"]
    DELAI = P["mesure_passive"]["delai_entre_domaines_s"]
    UA = f"SenCyR/{VERSION} (recherche academique, Master SSI, ESP Dakar; contact: {contact})"
    RES = resolveur()
    lignes = lire(a.domaines)
    out = []
    for i, l in enumerate(lignes, 1):
        dom = re.sub(r"^https?://", "", l["domaine"].strip().lower()).strip("/")
        print(f"[{i}/{len(lignes)}] {l['pays']} {dom}", flush=True)
        r = mesurer_domaine(l["pays"].strip().upper(), dom)
        r.update(institution=l.get("institution", ""), secteur=l.get("secteur", ""))
        out.append(r)
        ecrire(a.o, out, COLS)          # sauvegarde au fil de l'eau
        if i < len(lignes):
            time.sleep(DELAI)
    journaliser("mesure", P, a.parametres, len(out), [a.domaines], a.o)
    print(f"{len(out)} domaines mesurés -> {a.o}")


# ------------------------------------------------------------------ module 2 : règles
def comptes(rows, champ):
    """(k, n) : domaines conformes et domaines mesurés pour un indicateur (DNSSEC : par zone)."""
    rows = [r for r in rows if str(r.get(champ, "")).strip() != ""]
    if champ == "dnssec":                      # DNSSEC se mesure par zone : une zone compte une fois
        rows = list({r.get("zone_dns") or r["domaine"]: r for r in rows}.values())
    v = [int(r[champ]) for r in rows]
    return sum(v), len(v)


def taux(rows, champ):
    k, n = comptes(rows, champ)
    return (round(100 * k / n), n) if n else (None, 0)


def niveau_pct(p, P):
    """Niveau d'un indicateur selon le taux de domaines conformes (seuils de parametres.json)."""
    s = P["seuils_mesure_pct"]
    return NIVEAUX[0] if p < s["structure"] else NIVEAUX[1] if p < s["consolide"] else NIVEAUX[2]


Z_WILSON = {90: 1.645, 95: 1.96, 99: 2.576}


def wilson(k, n, niveau_pct=95):
    """Intervalle de Wilson (en %) de la part k/n, au niveau de confiance donné (90, 95 ou 99)."""
    z = Z_WILSON[int(niveau_pct)]
    p = k / n
    d = 1 + z * z / n
    centre = (p + z * z / (2 * n)) / d
    demi = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return max(0.0, centre - demi) * 100, min(1.0, centre + demi) * 100


def bande(pct, P):
    s = P["seuils_mesure_pct"]
    return 0 if pct < s["structure"] else 1 if pct < s["consolide"] else 2


def confiance_mesure(k, n, P):
    """Confiance d'un indicateur mesuré : élevée si l'intervalle de Wilson reste dans la bande du
    niveau, moyenne s'il déborde sur une bande voisine, faible s'il couvre les trois bandes.
    (Ce n'est pas R3 : écart E7.)"""
    bas, haut = wilson(k, n, P["confiance_mesure"]["niveau_confiance_pct"])
    couvertes = bande(haut, P) - bande(bas, P) + 1
    return CONF[3 - couvertes]


def norm_app(s):
    s = (s or "").strip().lower()
    for cle, val in (("émerg", "émergent"), ("emerg", "émergent"), ("struct", "structuré"),
                     ("consol", "consolidé"), ("non", NON_EVALUABLE), ("hors", HORS_PERIMETRE)):
        if s.startswith(cle):
            return val
    return s or NON_EVALUABLE


def norm_conf(s):
    s = (s or "").strip().lower()
    for cle, val in (("faib", "faible"), ("moy", "moyenne"), ("élev", "élevée"), ("elev", "élevée")):
        if s.startswith(cle):
            return val
    return SANS_CONF


def confiance_R3(niveaux, absence_R2, indirecte=False, convergentes=True):
    """R3 (tableau 2.3). La confiance porte sur la justesse du niveau, non sur la maturité.
    - source indirecte → faible ;
    - aucune source A, B ou C : moyenne si le niveau repose sur l'absence de trace (R2), sinon « — » ;
    - convergence = les sources concordent sur le niveau attribué, pas seulement sur l'existence
      d'un dispositif ou d'une intention ;
    - sources non convergentes (aucune ne recoupe les autres) : le niveau repose sur une source
      non recoupée → moyenne s'il y a une source A ou B, faible si seulement des sources C ;
    - sources convergentes : au moins deux dont une A → élevée ; une seule source C → faible ;
      sinon (une A ou une B seule, plusieurs B ou C sans A) → moyenne ;
    - plafond : avec R2, élevée devient moyenne. Les sources D ne comptent pas."""
    if indirecte:
        return "faible"
    n = [x.strip().upper() for x in niveaux if x.strip().upper() in ("A", "B", "C")]
    if not n:
        return "moyenne" if absence_R2 else SANS_CONF
    if not convergentes:
        c = "moyenne" if ("A" in n or "B" in n) else "faible"
    else:
        c = "élevée" if len(n) >= 2 and "A" in n else "faible" if n == ["C"] else "moyenne"
    return "moyenne" if absence_R2 and c == "élevée" else c


def niveau_par_aspects(niveaux):
    """R5 : un facteur décomposé en aspects prend le niveau de son aspect évaluable le moins
    avancé ; aucun aspect évaluable → non évaluable."""
    ev = [n for n in niveaux if n in NIVEAUX]
    return min(ev, key=NIVEAUX.index) if ev else NON_EVALUABLE


def agreger_R5(elements):
    """R5 (tableau 2.3), pour une dimension ou une fonction de résilience :
    niveau le plus fréquent parmi les éléments évaluables, le plus bas en cas d'égalité ;
    confiance la plus faible parmi ceux qui ont ce niveau ; « n évaluables sur m », m sans
    les éléments hors périmètre. Aucun élément évaluable → non évaluable."""
    pris = [e for e in elements if e["appreciation"] != HORS_PERIMETRE]
    ev = [e for e in pris if e["appreciation"] in NIVEAUX]
    if not ev:
        return dict(appreciation=NON_EVALUABLE, confiance=SANS_CONF, evaluables=0, total=len(pris))
    freq = {n: sum(e["appreciation"] == n for e in ev) for n in NIVEAUX}
    app = max(NIVEAUX, key=lambda n: (freq[n], -NIVEAUX.index(n)))
    confs = [e["confiance"] for e in ev if e["appreciation"] == app and e["confiance"] in CONF]
    conf = min(confs, key=CONF.index) if confs else SANS_CONF
    return dict(appreciation=app, confiance=conf, evaluables=len(ev), total=len(pris))


def priorite_R6(app, portee, exposition, faisabilite):
    """R6 : seuls les facteurs émergents sont hiérarchisés. Trois critères réunis → 1 ;
    deux → 2 ; un ou aucun → 3. Facteur non émergent → « — »."""
    if app != "émergent":
        return "—"
    k = sum(bool(x) for x in (portee, exposition, faisabilite))
    return "1" if k == 3 else "2" if k == 2 else "3"


def code_facteur(code):
    """« D1.1a » (aspect) → « D1.1 » (facteur)."""
    return re.sub(r"[a-z]$", "", code.strip())


def lire_fonctions(path):
    return [(l["fonction"].strip(), [c for c in re.split(r"[;,\s]+", l["facteurs"]) if c])
            for l in lire(path)]


def portee_R6(facteur, fonctions):
    """Critère de portée de R6, déduit du tableau 2.1 : le facteur conditionne « répondre et se
    rétablir » ou au moins deux des quatre fonctions ; la contribution transversale ne compte pas."""
    concernees = [nom for nom, codes in fonctions if not nom.lower().startswith("contribution")
                  and facteur in (code_facteur(c) for c in codes)]
    return any(nom.lower().startswith("répondre") for nom in concernees) or len(concernees) >= 2


def facteur_mesure(rows, indicateurs, P):
    """Facteur mesuré : chaque indicateur donne un niveau ; le facteur prend le moins avancé.
    Confiance du facteur : la plus faible des indicateurs qui fixent son niveau (Wilson, DNSSEC par zone).
    n retenu : le plus grand parmi les indicateurs."""
    detail, niveaux, confs, n = [], [], [], 0
    for ind in indicateurs:
        k, m = comptes(rows, ind)
        if not m:
            continue
        bas, haut = wilson(k, m, P["confiance_mesure"]["niveau_confiance_pct"])
        detail.append(dict(indicateur=ind, libelle=LIBELLES.get(ind, ind), pct=round(100 * k / m), n=m, k=k,
                           ic_bas=round(bas), ic_haut=round(haut)))
        niveaux.append(niveau_pct(round(100 * k / m), P))
        confs.append(confiance_mesure(k, m, P))
        n = max(n, m)
    if not niveaux:
        return NON_EVALUABLE, SANS_CONF, detail, 0
    niveau = niveau_par_aspects(niveaux)
    # confiance du facteur : la plus faible parmi les indicateurs qui fixent son niveau
    fixants = [c for nv, c in zip(niveaux, confs) if nv == niveau]
    return niveau, min(fixants, key=CONF.index), detail, n


def texte_detail(detail):
    return " ; ".join(f"{d['libelle']} {d['pct']} % (IC {d['ic_bas']}-{d['ic_haut']} %)" for d in detail)


EVAL_COLS = ["pays", "type", "facteur", "intitule", "dimension", "appreciation", "confiance", "base",
             "detail", "priorite", "fonction", "recommandation", "appreciation_memoire",
             "confiance_memoire", "concordance"]


def evaluer_pays(pays, rows, preuves, aspects, fonctions, P, etudie):
    """Évaluation d'un pays.
    Pays étudié : preuves documentaires pour tous les facteurs ; les facteurs de
    « facteurs_mesures » sont remplacés par la mesure quand des mesures existent ;
    les « indicateurs_complementaires » sont affichés à côté sans changer le niveau ;
    puis R5 par dimension et par fonction.
    Autres pays : facteurs mesurés et indicateurs complémentaires seulement (benchmark)."""
    mesures = P.get("facteurs_mesures", {})
    complementaires = P.get("indicateurs_complementaires", {})
    out = []
    if etudie:
        for p in preuves:
            f = p["facteur"].strip()
            e = dict(pays=pays, type="facteur", facteur=f, intitule=p.get("intitule", ""),
                     dimension=p.get("dimension", f[:2]), fonction=p.get("fonction", ""),
                     recommandation=p.get("recommandation", ""),
                     appreciation_memoire=norm_app(p.get("appreciation")),
                     confiance_memoire=norm_conf(p.get("confiance_memoire")))
            if f in mesures and rows:
                app, conf, det, n = facteur_mesure(rows, mesures[f]["indicateurs"], P)
                e.update(appreciation=app, confiance=conf, base=f"mesure (n={n})", detail=texte_detail(det))
            else:
                asp = []
                for a in [x for x in aspects if x["facteur"].strip() == f]:
                    a_app = norm_app(a.get("appreciation"))
                    a_conf = SANS_CONF if a_app not in NIVEAUX else confiance_R3(
                        [x for x in re.split(r"[;,\s]+", a.get("niveaux", "")) if x],
                        oui(a.get("absence_R2")), oui(a.get("indirecte")), convergent(a.get("convergentes")))
                    asp.append(dict(pays=pays, type="aspect", facteur=a["aspect"].strip(), intitule=a.get("intitule", ""),
                                    dimension=e["dimension"], appreciation=a_app, confiance=a_conf,
                                    base="documentaire", detail="sources " + a.get("sources", ""), priorite="—",
                                    appreciation_memoire=a_app, confiance_memoire=norm_conf(a.get("confiance_memoire"))))
                app = niveau_par_aspects([x["appreciation"] for x in asp]) if asp else norm_app(p.get("appreciation"))
                niv = [x for x in re.split(r"[;,\s]+", p.get("niveaux", "")) if x]
                conf = SANS_CONF if app not in NIVEAUX else confiance_R3(
                    niv, oui(p.get("absence_R2")), oui(p.get("indirecte")), convergent(p.get("convergentes")))
                e.update(appreciation=app, confiance=conf, base="documentaire",
                         detail="sources " + p.get("sources", ""), aspects=asp)
            e["priorite"] = priorite_R6(e["appreciation"], portee_R6(f, fonctions),
                                        oui(p.get("exposition")), oui(p.get("faisabilite")))
            e["concordance"] = "" if e["base"] != "documentaire" else \
                ("oui" if (e["appreciation"], e["confiance"]) == (e["appreciation_memoire"], e["confiance_memoire"]) else "non")
            out.append(e)
            out.extend(e.get("aspects", []))
    else:
        for f, m in mesures.items():
            app, conf, det, n = facteur_mesure(rows, m["indicateurs"], P)
            out.append(dict(pays=pays, type="facteur", facteur=f, intitule=m["intitule"], dimension=f[:2],
                            appreciation=app, confiance=conf, base=f"mesure (n={n})",
                            detail=texte_detail(det), priorite="—"))
    for f, m in complementaires.items():
        app, conf, det, n = facteur_mesure(rows, m["indicateurs"], P)
        out.append(dict(pays=pays, type="complementaire", facteur=f, intitule=m["intitule"], dimension=f[:2],
                        appreciation=app, confiance=conf, base=f"mesure (n={n}), indicateur complémentaire",
                        detail=texte_detail(det), priorite="—"))
    if etudie:
        fs = [e for e in out if e["type"] == "facteur"]
        for dim in sorted({e["dimension"] for e in fs}):
            r = agreger_R5([e for e in fs if e["dimension"] == dim])
            out.append(dict(pays=pays, type="dimension", facteur=dim, intitule=DIMENSIONS.get(dim, ""),
                            dimension=dim, appreciation=r["appreciation"], confiance=r["confiance"],
                            detail=f"{r['evaluables']} facteurs évaluables sur {r['total']}"))
        # Le tableau 2.1 cite des facteurs (D1.1) et des aspects (D1.1a).
        par_code = {e["facteur"]: e for e in out if e["type"] in ("facteur", "aspect")}
        for nom, codes in fonctions:
            elems = [par_code.get(c, dict(appreciation=NON_EVALUABLE, confiance=SANS_CONF)) for c in codes]
            r = agreger_R5(elems)
            out.append(dict(pays=pays, type="fonction", facteur=nom, intitule=", ".join(codes),
                            appreciation=r["appreciation"], confiance=r["confiance"],
                            detail=f"{r['evaluables']} facteurs évaluables sur {r['total']}"))
    return out


def chemins_donnees(a):
    """aspects.csv et fonctions.csv : par défaut, dans le dossier de preuves.csv."""
    dossier = Path(a.preuves).parent
    return (Path(a.aspects) if a.aspects else dossier / "aspects.csv",
            Path(a.fonctions) if a.fonctions else dossier / "fonctions.csv")


def evaluer_tout(mesures, preuves, aspects, fonctions, P, pays_etudie):
    pays_list = sorted({m["pays"] for m in mesures} | {pays_etudie})
    out = []
    for pays in pays_list:
        rows = [m for m in mesures if m["pays"] == pays]
        out.extend(evaluer_pays(pays, rows, preuves, aspects, fonctions, P, pays == pays_etudie))
    return out


def cmd_evaluer(a, P):
    p_aspects, p_fonctions = chemins_donnees(a)
    mesures = lire(a.mesures)
    out = evaluer_tout(mesures, lire(a.preuves), lire(p_aspects), lire_fonctions(p_fonctions), P, a.pays)
    ecrire(a.o, out, EVAL_COLS)
    conc = [e for e in out if e.get("concordance")]
    if conc:
        ok = sum(e["concordance"] == "oui" for e in conc)
        print(f"Concordance avec l'évaluation manuelle du mémoire : {ok}/{len(conc)} facteurs documentaires")
    journaliser("evaluer", P, a.parametres, len(mesures), [a.mesures, a.preuves, p_aspects, p_fonctions], a.o)
    print(f"{len(out)} lignes -> {a.o}")


# ------------------------------------------------------------------ module 3 : rapport (local)
# Couleurs des cellules, identiques à celles du site : niveaux en jaune, vert, bleu ;
# confiance en trois intensités de violet ; statuts hors échelle en gris.
COUL = {"émergent": "#FEF3C7", "structuré": "#DCFCE7", "consolidé": "#DBEAFE", "non évaluable": "#E6E6E6",
        "hors périmètre": "#E6E6E6", "faible": "#F1EBFB", "moyenne": "#DCCEF7", "élevée": "#BBA3EE",
        "1": "#FECACA", "2": "#FEF3C7", "3": "#DBEAFE"}


def td(v, coul=None):
    st = f' style="background:{coul}"' if coul else ""
    return f"<td{st}>{html.escape(str(v))}</td>"


def cmd_rapport(a, P):
    mesures, ev = lire(a.mesures), lire(a.evaluation)
    pays = sorted({m["pays"] for m in mesures}, key=lambda p: (p != a.pays, p))
    h = []
    # 1. benchmark mesuré
    h.append("<h2>1. Benchmark mesuré</h2><table><tr><th>Indicateur</th>"
             + "".join(f"<th>{p} (n={len([m for m in mesures if m['pays'] == p])})</th>" for p in pays) + "</tr>")
    for ind, lib in LIBELLES.items():
        cells = ""
        for p in pays:
            v, n = taux([m for m in mesures if m["pays"] == p], ind)
            cells += td("—") if v is None else td(f"{v} %", COUL[niveau_pct(v, P)])
        h.append(f"<tr><td>{lib}</td>{cells}</tr>")
    h.append("</table>")
    # 2. profil du pays étudié
    dims = [e for e in ev if e["pays"] == a.pays and e["type"] == "dimension"]
    fns = [e for e in ev if e["pays"] == a.pays and e["type"] == "fonction"]
    fac = [e for e in ev if e["pays"] == a.pays and e["type"] in ("facteur", "aspect", "complementaire")]
    h.append(f"<h2>2. Profil CMM : {a.pays}</h2><table><tr><th>Dimension</th><th>Appréciation</th>"
             "<th>Confiance</th><th>Couverture</th></tr>")
    for e in dims:
        h.append("<tr>" + td(e["facteur"] + " " + e["intitule"]) + td(e["appreciation"], COUL.get(e["appreciation"]))
                 + td(e["confiance"], COUL.get(e["confiance"])) + td(e["detail"]) + "</tr>")
    h.append("</table><h3>Fonctions de résilience</h3><table><tr><th>Fonction</th><th>Appréciation</th>"
             "<th>Confiance</th><th>Couverture</th><th>Facteurs</th></tr>")
    for e in fns:
        h.append("<tr>" + td(e["facteur"]) + td(e["appreciation"], COUL.get(e["appreciation"]))
                 + td(e["confiance"], COUL.get(e["confiance"])) + td(e["detail"]) + td(e["intitule"]) + "</tr>")
    h.append("</table><h3>Détail par facteur</h3><table><tr><th>Facteur</th><th>Intitulé</th>"
             "<th>Appréciation</th><th>Confiance</th><th>Base</th><th>Détail</th><th>Priorité R6</th></tr>")
    for e in fac:
        h.append("<tr>" + td(e["facteur"]) + td(e["intitule"]) + td(e["appreciation"], COUL.get(e["appreciation"]))
                 + td(e["confiance"], COUL.get(e["confiance"])) + td(e["base"]) + td(e["detail"])
                 + td(e["priorite"], COUL.get(e["priorite"])) + "</tr>")
    h.append("</table>")
    # 3. priorités et recommandations
    pr = sorted([e for e in fac if e["priorite"] in ("1", "2", "3")], key=lambda e: (e["priorite"], e["facteur"]))
    h.append("<h2>3. Priorités (règle R6) et recommandations</h2><table><tr><th>Priorité</th><th>Facteur</th>"
             "<th>Fonction</th><th>Recommandation</th></tr>")
    for e in pr:
        h.append("<tr>" + td(e["priorite"], COUL.get(e["priorite"])) + td(e["facteur"] + " " + e["intitule"])
                 + td(e["fonction"] or "—") + td(e["recommandation"] or "—") + "</tr>")
    h.append("</table>")
    # 4. hébergement
    h.append("<h2>4. Hébergement des sites publics</h2><table><tr><th>Pays</th><th>Adresse IP enregistrée dans le pays</th>"
             "<th>Principaux opérateurs</th></tr>")
    for p in pays:
        rows = [m for m in mesures if m["pays"] == p]
        v, n = taux(rows, "heberge_national")
        ops = {}
        for m in rows:
            if m["asn_nom"]:
                cle = f"{m['asn_nom']} ({m['pays_hebergement']})"
                ops[cle] = ops.get(cle, 0) + 1
        top = ", ".join(f"{k} : {c}" for k, c in sorted(ops.items(), key=lambda x: -x[1])[:4])
        h.append("<tr>" + td(p) + td("—" if v is None else f"{v} % (n={n})") + td(top) + "</tr>")
    h.append("</table>")
    # 5. détail par domaine (usage local seulement)
    cles = ["https_ok", "cert_valide", "tls_moderne", "redir_https", "hsts", "entetes_3plus",
            "spf", "dmarc_applique", "dnssec", "heberge_national"]
    h.append(f"<h2>5. Détail par domaine : {a.pays} (document local, à ne pas publier)</h2><table><tr>"
             "<th>Institution</th><th>Domaine</th>" + "".join(f"<th>{LIBELLES[c]}</th>" for c in cles) + "</tr>")
    for m in [m for m in mesures if m["pays"] == a.pays]:
        h.append("<tr>" + td(m["institution"]) + td(m["domaine"]) + "".join(
            td("✓", "#DCFCE7") if m[c] == "1" else td("✗", "#FEE2E2") if m[c] == "0" else td("—") for c in cles) + "</tr>")
    h.append("</table>")
    date = max((m["date_mesure"] for m in mesures), default="")
    s = P["seuils_mesure_pct"]
    page = f"""<!doctype html><html lang="fr"><head><meta charset="utf-8">
<title>SenCyR, rapport local</title><style>
body{{font-family:"Times New Roman",serif;margin:2rem auto;max-width:1150px;color:#222;padding:0 1rem}}
h1,h2,h3{{color:#1A3A6B}} table{{border-collapse:collapse;width:100%;margin:.6rem 0 1.4rem;font-size:.9rem}}
th{{background:#1A3A6B;color:#fff;text-align:left}} th,td{{border:1px solid #8A8F98;padding:4px 6px;vertical-align:top}}
.note{{font-size:.85rem;color:#555}}</style></head><body>
<h1>SenCyR : rapport local de cyber-résilience</h1>
<p class="note">Moteur {VERSION}. Dernière mesure : {html.escape(date)}. Mesure strictement passive. Seuils de niveau :
émergent &lt; {s['structure']} %, structuré &lt; {s['consolide']} %, consolidé au-delà.</p>
{''.join(h)}</body></html>"""
    with open(a.o, "w", encoding="utf-8") as f:
        f.write(page)
    journaliser("rapport", P, a.parametres, len(mesures), [a.mesures, a.evaluation], a.o)
    print(f"Tableau de bord -> {a.o}")


# ------------------------------------------------------------------ module 4 : export pour la plateforme
INDICATEURS_EXPORT = ["resolu", "https_ok", "cert_valide", "tls_moderne", "redir_https", "hsts",
                      "entetes_3plus", "spf", "dmarc", "dmarc_applique", "dnssec", "heberge_national"]


def indicateurs_agreges(rows):
    out = {}
    for ind in INDICATEURS_EXPORT:
        p, n = taux(rows, ind)
        out[ind] = dict(libelle=LIBELLES[ind], pct=p, n=n)
    return out


def agreger_mesures(mesures, P):
    """Agrégats par pays et par secteur. Aucun nom d'institution, de domaine ni d'opérateur
    d'hébergement (un opérateur public serait une institution nommée) : pour l'hébergement,
    seuls le nombre d'opérateurs, la part du premier et les pays d'hébergement sont publiés.
    Un secteur qui compte moins de domaines que « taille_minimale_agregat » n'est pas
    publié : il désignerait une institution."""
    k = P["taille_minimale_agregat"]
    resultat = {}
    for pays in sorted({m["pays"] for m in mesures}):
        rows = [m for m in mesures if m["pays"] == pays]
        secteurs, masques = {}, 0
        for s in sorted({m["secteur"] for m in rows}):
            rs = [m for m in rows if m["secteur"] == s]
            if len(rs) >= k:
                secteurs[s] = dict(n=len(rs), indicateurs=indicateurs_agreges(rs))
            else:
                masques += len(rs)
        ops, pays_heb = {}, {}
        for m in rows:
            if m.get("asn_nom"):
                ops[m["asn_nom"]] = ops.get(m["asn_nom"], 0) + 1
            if m.get("pays_hebergement"):
                pays_heb[m["pays_hebergement"]] = pays_heb.get(m["pays_hebergement"], 0) + 1
        n_heb = sum(ops.values())
        hebergement_ = dict(n=n_heb, nb_operateurs=len(ops),
                            part_premier_operateur_pct=round(100 * max(ops.values()) / n_heb) if n_heb else None,
                            pays_hebergement=dict(sorted(pays_heb.items(), key=lambda x: -x[1])))
        resultat[pays] = dict(nom=P["pays"].get(pays, pays), n=len(rows), indicateurs=indicateurs_agreges(rows),
                              secteurs=secteurs, domaines_non_publies_par_secteur=masques,
                              hebergement=hebergement_)
    return resultat


def vers_plateforme(e):
    """Ligne d'évaluation → objet JSON aux noms de champs de regles.js."""
    o = dict(type=e["type"], code=e["facteur"], intitule=e.get("intitule", ""), dimension=e.get("dimension", ""),
             niveau=e["appreciation"], confiance=e["confiance"], base=e.get("base", ""), detail=e.get("detail", ""))
    if e["type"] in ("facteur", "aspect"):
        pr = e.get("priorite", "—")
        o.update(priorite=int(pr) if pr in ("1", "2", "3") else None,
                 recommandation=e.get("recommandation", ""), fonction_recommandation=e.get("fonction", ""))
    return o


def cmd_exporter(a, P):
    p_aspects, p_fonctions = chemins_donnees(a)
    dossier_donnees = Path(a.preuves).parent
    p_gci = Path(a.gci) if a.gci else dossier_donnees / "gci2024.csv"
    mesures = lire(a.mesures)
    preuves, aspects, fonctions = lire(a.preuves), lire(p_aspects), lire_fonctions(p_fonctions)
    ev = evaluer_tout(mesures, preuves, aspects, fonctions, P, a.pays)
    dates = sorted(m["date_mesure"] for m in mesures if m.get("date_mesure"))
    meta = dict(moteur=f"SenCyR {VERSION}", date_export=maintenant(), pays_etudie=a.pays,
                nb_domaines=len(mesures), periode_mesure=[dates[0], dates[-1]] if dates else [],
                parametres=P)
    sortie = Path(a.o)
    sortie.mkdir(parents=True, exist_ok=True)
    evaluation = dict(meta=meta, pays={})
    for pays in sorted({e["pays"] for e in ev}):
        evaluation["pays"][pays] = [vers_plateforme(e) for e in ev if e["pays"] == pays]
    ecrire_json(sortie / "evaluation.json", evaluation)
    ecrire_json(sortie / "mesures_agregees.json", dict(meta=meta, pays=agreger_mesures(mesures, P)))
    # Données de référence : copies exactes des CSV, lues par l'auto-diagnostic.
    ecrire_json(sortie / "preuves.json", preuves)
    ecrire_json(sortie / "aspects.json", aspects)
    ecrire_json(sortie / "fonctions.json", lire(p_fonctions))
    ecrire_json(sortie / "gci2024.json", lire(p_gci))
    shutil.copyfile(a.parametres, sortie / "parametres.json")
    journaliser("exporter", P, a.parametres, len(mesures),
                [a.mesures, a.preuves, p_aspects, p_fonctions, p_gci], sortie)
    print(f"Export de {len(mesures)} domaines mesurés (agrégés) -> {sortie}")


# ------------------------------------------------------------------ interface
def main():
    ap = argparse.ArgumentParser(description=f"SenCyR {VERSION} : évaluation de la cyber-résilience nationale")
    ap.add_argument("--parametres", default=str(PARAMETRES_DEFAUT), help="fichier parametres.json")
    sp = ap.add_subparsers(dest="cmd", required=True)
    m = sp.add_parser("mesure"); m.add_argument("domaines"); m.add_argument("-o", default="mesures.csv")
    for nom in ("evaluer", "exporter"):
        e = sp.add_parser(nom); e.add_argument("mesures"); e.add_argument("preuves")
        e.add_argument("--aspects"); e.add_argument("--fonctions"); e.add_argument("--pays", default="SN")
        if nom == "evaluer":
            e.add_argument("-o", default="evaluation.csv")
        else:
            e.add_argument("--gci"); e.add_argument("-o", default=str(RACINE / "docs" / "data"))
    r = sp.add_parser("rapport"); r.add_argument("mesures"); r.add_argument("evaluation")
    r.add_argument("-o", default="rapport.html"); r.add_argument("--pays", default="SN")
    a = ap.parse_args()
    P = charger_parametres(a.parametres)
    {"mesure": cmd_mesure, "evaluer": cmd_evaluer, "rapport": cmd_rapport, "exporter": cmd_exporter}[a.cmd](a, P)


if __name__ == "__main__":
    main()
