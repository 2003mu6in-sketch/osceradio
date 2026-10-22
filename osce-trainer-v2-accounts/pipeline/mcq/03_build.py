"""Apply overrides, clean text, merge repeats and write the MCQ bank.

Input : build/mcq/<subject>.draft.json, pipeline/mcq/overrides.yaml
Output: content/mcq/<subject>.json, build/mcq/report.md
"""
import json, os, re, difflib
from collections import Counter, defaultdict
import yaml

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
BUILD = os.path.join(ROOT, "build", "mcq")
OUT = os.path.join(ROOT, "content", "mcq"); os.makedirs(OUT, exist_ok=True)
SUBJECTS = ["radiology", "anaesthesia", "ophthalmology", "ent"]
OV = yaml.safe_load(open(os.path.join(HERE, "overrides.yaml"))) or {}

# Newer papers first when choosing the canonical copy of a repeated question
def paper_rank(p):
    m = re.match(r"(\d{4})", p)
    return (0, -int(m.group(1))) if m else (1, 0)


FIXES = [
    (r"(\w)- (?=[a-z])", r"\1-"),                  # line-wrap hyphen "intra- articular"
    (r"\bkg/m 2\b", "kg/m²"), (r"\bin m 2\b", "in m²"), (r"\bm 2\b(?= ?\))", "m²"),
    (r"\b1 3 the depth", "⅓ the depth"),
    (r"\bV ([1-6])\b", r"V\1"),
    (r"\s+([,;:?])", r"\1"),
    (r"[ \t]{2,}", " "),
]

def unwrap(t):
    """Join wrapped PDF lines; keep breaks before list items (I., ii), •) and after short lines."""
    if not t: return t
    out = []
    for line in t.split("\n"):
        line = line.strip()
        if out and not re.match(r"^([IVX]+[.)]|\(?[ivx]+\)|[•\-–]|\d+[.)])\s", line) and len(out[-1]) > 45:
            out[-1] += " " + line
        else:
            out.append(line)
    return "\n".join(out)


def clean(t):
    if t is None: return t
    t = unwrap(t)
    t = re.sub(r"([+\-−]\d)\. (\d{1,2})\b", r"\1.\2", t)
    for a, b in FIXES:
        t = re.sub(a, b, t)
    return t.strip()


def norm(t):
    t = t.lower()
    t = re.sub(r"[^a-z0-9 ]+", " ", t)
    return re.sub(r"\s+", " ", t).strip()


STOP = set("the a an of is are be in on at to for with which what one following that this these those can will seen".split())
SYN = {"ff": "following", "chief": "main", "two": "2", "three": "3", "sure": "best", "more": "most",
       "anesthetic": "anaesthetic", "anesthesia": "anaesthesia", "form": "from"}
POLARITY = set("""except not false true no never always least most extra intra inter hyper hypo increase increased
  decrease decreased right left directly inversely maximum minimum contraindication contraindications indication
  indications advantage advantages disadvantage disadvantages unilateral bilateral anterior posterior superior
  inferior upper lower medial lateral early late acute chronic primary secondary mild severe adult adults child
  children infant infants male female first last before after""".split())

def canon(t):
    t = re.sub(r"(\d+)\s*(?:years?|yrs?|yr)\s*old", r"\1yo", t)
    t = re.sub(r"\bnot true\b", "false", t)
    t = re.sub(r"\b(false)( \1)+\b", r"\1", t)
    return [SYN.get(w, w) for w in t.split()]

def material_diff(a, b):
    """True when two near-identical stems differ by a meaningful word (extra/intra, right/left, true/except…)."""
    ta, tb = canon(a), canon(b)
    sm = difflib.SequenceMatcher(None, ta, tb)
    for op, i1, i2, j1, j2 in sm.get_opcodes():
        if op == "equal": continue
        wa = [w for w in ta[i1:i2] if w not in STOP]
        wb = [w for w in tb[j1:j2] if w not in STOP]
        if op == "replace" and wa and wb:
            sa, sb = " ".join(wa), " ".join(wb)
            if sorted(sa) == sorted(sb): continue                      # transposed letters
            if difflib.SequenceMatcher(None, sa, sb).ratio() >= 0.8 and not (set(wa + wb) & POLARITY) \
               and sa[:5] not in ("intra", "extra", "inter") and sb[:5] not in ("intra", "extra", "inter"):
                continue                                                # spelling variant
            if sa.replace(" ", "") == sb.replace(" ", ""): continue    # split word
            return True
        if set(wa + wb) & POLARITY:
            return True
        if any(re.fullmatch(r"\d+(yo)?", w) for w in wa + wb):
            return True
    return False


def placeholder(o):
    return not re.sub(r"[.…\s\-_]", "", o["text"])


def build_subject(subj, report):
    d = json.load(open(os.path.join(BUILD, f"{subj}.draft.json")))
    ph_path = os.path.join(BUILD, f"{subj}.photos.draft.json")
    ph = json.load(open(ph_path)) if os.path.exists(ph_path) else dict(questions=[], images={})
    n_typed = len(d["questions"])
    d["questions"] = d["questions"] + ph["questions"]
    pc_path = os.path.join(BUILD, f"{subj}.photocards.json")
    photocards = json.load(open(pc_path))["cards"] if os.path.exists(pc_path) else []
    qs, dropped = [], []
    for q in d["questions"]:
        ov = OV.get(q["id"], {})
        if ov.get("drop"):
            dropped.append((q, ov["dropReason"])); continue
        if "options" in ov:
            q["options"] = [dict(key=chr(65 + i), text=t) for i, t in enumerate(ov["options"])]
        for k in ("correct", "alt", "stem", "leadIn", "notes"):
            if k in ov: q[k] = ov[k]
        q["stem"] = clean(q["stem"])
        q["leadIn"] = clean(q["leadIn"]) if q.get("leadIn") else None
        for o in q["options"]: o["text"] = clean(o["text"])
        q["notes"] = [clean(n) for n in q["notes"] if n and n.strip(" :")]
        real = [o for o in q["options"] if not placeholder(o)]
        if q["type"] == "no-options" or (q["type"] == "mcq" and len(real) < 2):
            dropped.append((q, "fewer than two usable options in source")); continue
        qs.append(q)

    # ---- merge repeats -------------------------------------------------
    keyed = [(q, norm(q["stem"]), sorted(norm(o["text"]) for o in q["options"])) for q in qs]
    parent = {}
    def find(i):
        while parent.get(i, i) != i: i = parent[i]
        return i
    for i in range(len(keyed)):
        qi, si, oi = keyed[i]
        for j in range(i):
            qj, sj, oj = keyed[j]
            if find(i) == find(j) or qi["paper"] == qj["paper"]: continue
            sm = difflib.SequenceMatcher(None, si, sj)
            if sm.real_quick_ratio() < 0.85 or sm.quick_ratio() < 0.85 or sm.ratio() < 0.85: continue
            ov_ = len(set(oi) & set(oj)) / max(1, min(len(oi), len(oj)))
            if ov_ < 0.6 and not (not oi and not oj): continue
            if material_diff(si, sj): continue
            parent[find(i)] = find(j)
    groups = defaultdict(list)
    for i, (q, _, _) in enumerate(keyed): groups[find(i)].append(q)

    cards, merges, disputes = [], 0, []
    for g in groups.values():
        g.sort(key=lambda q: (0 if q["correct"] else 1, 0 if q.get("source", "typed") == "typed" else 1, paper_rank(q["paper"])))
        c = g[0]
        appears = [f"{q['paper']} Q{q['qNumber']}" for q in sorted(g, key=lambda q: paper_rank(q["paper"]))]
        alt = list(c.get("alt") or [])
        reason = "second-highlight" if alt else None
        ctext = {norm(o["text"]) for o in c["options"] if o["key"] in c["correct"]}
        for q in g[1:]:
            merges += 1
            otext = {norm(o["text"]) for o in q["options"] if o["key"] in q["correct"]}
            if q["correct"] and c["correct"] and otext and otext != ctext:
                for o in c["options"]:
                    if norm(o["text"]) in otext and o["key"] not in c["correct"] and o["key"] not in alt:
                        alt.append(o["key"]); reason = "key-differs"
                if reason == "key-differs":
                    disputes.append((c["id"], q["id"]))
            for n in q["notes"]:
                if n not in c["notes"]: c["notes"].append(n)
        multi = len(c["correct"]) > 1
        card = dict(
            id=c["id"], subject=subj, kind="mcq", paper=c["paper"], qNumber=c["qNumber"],
            topic=c.get("topic"), leadIn=c.get("leadIn"), stem=c["stem"],
            options=[dict(key=o["key"], text=o["text"]) for o in c["options"]],
            correct=c["correct"], accepted=sorted(set(c["correct"]) | set(alt)) if alt else c["correct"],
            disputed=dict(alt=alt, reason=reason) if alt else None,
            multiMarked=multi, noKey=(c["type"] == "mcq" and not c["correct"]),
            answerText=[clean(t) for t in c.get("ansText", []) if t.strip()] or None,
            type=c["type"], notes=c["notes"], appearsIn=appears, page=c["page"],
            source=c.get("source", "typed"), images=c.get("images") or [],
        )
        cards.append(card)

    cards.sort(key=lambda c: (paper_rank(c["paper"]), c["paper"], c["qNumber"]))
    used = {i for c in cards for i in c["images"]} | {i for c in photocards for i in c["images"]}
    imgs = {i: v for i, v in ph["images"].items() if i in used}
    json.dump(dict(subject=subj, cards=cards, photoCards=photocards, images=imgs), open(os.path.join(OUT, f"{subj}.json"), "w"),
              ensure_ascii=False, separators=(",", ":"))

    t = Counter(c["type"] for c in cards)
    report.append(f"## {subj.title()}\n")
    report.append(f"| Typed | Transcribed from photos | Dropped | Repeats merged | Unique MCQ cards | Short-answer | No answer in source | Several marked | Disputed | Photo cards |")
    report.append("|---|---|---|---|---|---|---|---|---|---|")
    report.append(f"| {n_typed} | {len(ph['questions'])} | {len(dropped)} | {merges} | {t['mcq']} | {t['recall']} | "
                  f"{sum(c['noKey'] for c in cards)} | {sum(c['multiMarked'] for c in cards)} | {sum(bool(c['disputed']) for c in cards)} | {len(photocards)} |\n")
    papers = Counter(c["paper"].split(" SET")[0] for c in cards)
    report.append("Per paper (canonical cards): " + ", ".join(f"{k} {v}" for k, v in papers.items()) + "\n")
    keys = {k: v for k, v in d["keys"].items() if v}
    if keys:
        report.append("Answer keys found for photographed papers (used in phase V2-3): " +
                      ", ".join(f"{k} ({len(v)} answers)" for k, v in keys.items()) + "\n")
    if dropped:
        report.append("Dropped:\n")
        for q, r in dropped: report.append(f"- `{q['id']}` p.{q['page']}: {r}")
        report.append("")
    nk = [c for c in cards if c["noKey"]]
    if nk:
        report.append("No answer marked in source (app shows options, then asks the student to self-mark):\n")
        for c in nk: report.append(f"- `{c['id']}` p.{c['page']}: {c['stem'][:90]}")
        report.append("")
    if disputes:
        report.append("Repeats with different answers (both accepted, shown as disputed):\n")
        for a, b in disputes: report.append(f"- `{a}` vs `{b}`")
        report.append("")
    fl = [f for f in d["flags"] if "no answer" not in f["msg"]]
    if fl:
        report.append("Parser notes:\n")
        for f in fl: report.append(f"- `{f['id']}` p.{f['page']}: {f['msg']}")
        report.append("")
    return cards


def main():
    report = ["# MCQ bank – build report\n", "Typed papers plus the photographed papers transcribed by hand (phase V2-3).\n"]
    total = 0
    for s in SUBJECTS:
        total += len(build_subject(s, report))
    report.insert(2, f"**{total} unique questions** across {len(SUBJECTS)} subjects.\n")
    open(os.path.join(BUILD, "report.md"), "w").write("\n".join(report))
    print("\n".join(l for l in report if l.startswith("|") or l.startswith("#") or l.startswith("**")))


if __name__ == "__main__":
    main()
