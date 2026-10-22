"""OSCE V2 step 4: units + overrides -> content/osce/<subject>.json

- prompts: transcribed overrides win; otherwise split from the text printed before ANSWER;
  otherwise a generic prompt.
- repeats: cards whose first question image is the same photo (dHash distance <= 6) and whose
  prompts match are merged; the 2020 anaesthesia slides are merged by hand (dup2020).
- manned stations: "Questions asked by examiner" pairs become short-answer cards.
- revision notes (station lists, tips) are kept separately as `notes`, not quizzed.
"""
import json, os, re, sys
from collections import Counter
import yaml

HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(os.path.dirname(HERE))
B = os.path.join(ROOT, "build", "osce2")
OUT = os.path.join(ROOT, "content", "osce"); os.makedirs(OUT, exist_ok=True)
CFG = yaml.safe_load(open(os.path.join(HERE, "sections.yaml")))
SUBJECT_NAME = {"anaesthesia": "Anaesthesia", "ent": "ENT", "ophthalmology": "Ophthalmology"}
GENERIC = {
    "ophthalmology": ["Describe the findings in this image.", "What is your impression / most likely diagnosis?"],
    "default": ["Identify what is shown.", "Answer as you would at the station."],
}

PUA = re.compile(r"[-•▪●➢✓✔]")
MARKER = re.compile(r"^(\(?[ivxIVX]{1,4}\)|\(?[a-hA-H][.)]|\(?\d{1,2}[.)]|•|-|–|[A-H]\s*[-=:]\s|NB:|Note:|NOTE:|[A-Z][A-Za-z /()'’-]{2,40}:)")


def clean_line(t):
    t = PUA.sub("•", t)
    t = re.sub(r"•\s*", "• ", t)
    return re.sub(r"[ \t]+", " ", t).strip()


def unwrap(lines):
    """Join PDF-wrapped lines into logical lines; keep list items and headings separate."""
    out = []
    for raw in lines:
        t = clean_line(raw)
        if not t: continue
        if out:
            prev = out[-1]
            starts_item = bool(MARKER.match(t))
            prev_closed = prev.endswith(":") or len(prev) < 38
            if not starts_item and not prev_closed:
                out[-1] = (prev[:-1] if prev.endswith("-") and not prev.endswith(" -") else prev + " ") + t
                continue
        out.append(t)
    return out


def split_pre(pre):
    """Text printed before ANSWER -> (stem, prompts)."""
    lines = unwrap(pre)
    stem, prompts = [], []
    for t in lines:
        if re.match(r"^\(?(\d{1,2}|[a-hA-H])[.)]\s*", t) or prompts:
            if re.match(r"^\(?(\d{1,2}|[a-hA-H])[.)]\s*", t) or not prompts:
                prompts.append(re.sub(r"^\(?(\d{1,2}|[a-hA-H])[.)]\s*", "", t))
            else:
                prompts[-1] += " " + t
        else:
            stem.append(t)
    return (" ".join(stem) or None), prompts


def hamming(a, b):
    return sum(x != y for x, y in zip(a, b))


def short_title(answer):
    for t in answer:
        t2 = re.sub(r"^(\(?[a-hA-H0-9ivx]{1,3}[.)]\s*)+", "", t).strip(" :")
        t2 = re.sub(r"^(Instrument|Device|Structure|Diagnosis|Dx)\s*[-:]\s*", "", t2, flags=re.I)
        if 3 <= len(t2) <= 70 and not t2.endswith(":"):
            return t2
    return None


def slug(paper):
    s = paper.replace("Trial Set ", "T").replace(" & ", "-").replace("Picture OSCE models", "MODEL")
    s = s.replace("Manned", "M").replace("BSc", "BSC").replace("Lecture case", "L")
    return re.sub(r"[^A-Za-z0-9-]", "", s).upper()


def examiner_cards(u, code, paper):
    """Manned station text -> one station card + one card per examiner question."""
    text = unwrap(u["pre"] + u["answer"])
    try:
        k = next(i for i, t in enumerate(text) if t.lower().startswith("questions asked by examiner"))
    except StopIteration:
        return None
    head, qa, notes = text[:k], text[k + 1:], []
    cards, q, a = [], None, []
    for t in qa:
        if re.match(r"^Note of the following|^NOTE", t, re.I):
            if q: cards.append((q, a))
            q = None; notes.append(t); continue
        if notes:
            notes.append(t); continue
        m = re.match(r"^(\d+)\.\s*(.*)$", t)
        if m and not t.lower().startswith("ans"):
            if q: cards.append((q, a))
            q, a = m.group(2), []
        elif t.lower().startswith("ans"):
            a.append(re.sub(r"^ans\s*:\s*", "", t, flags=re.I))
        elif q:
            a.append(t)
    if q: cards.append((q, a))
    return head, cards, notes


def build(subj):
    cfg = CFG[subj]; code = cfg["code"]
    data = json.load(open(os.path.join(B, f"{subj}.units.json")))
    ov_all = yaml.safe_load(open(os.path.join(HERE, "overrides", f"{subj}.yaml"))) or {}
    ov = ov_all.get("cards") or {}
    dup2020 = ov_all.get("dup2020") or {}
    imeta = json.load(open(os.path.join(B, f"{subj}.images.json")))
    cards, dropped, report = [], [], []
    seq = Counter()

    def new_card(u, **kw):
        seq[u["paper"]] += 1
        n = u["qNumber"] or seq[u["paper"]]
        c = dict(id=f"{code}-{slug(u['paper'])}-{n:02d}", subject=subj, kind="osce", section=u["section"],
                 paper=u["paper"], qNumber=u["qNumber"], images=u["images"], answerImages=u["answerImages"],
                 stem=None, prompts=[], promptSource="pdf", answer=[], refs=[], notes=[], diagnosis=None,
                 appearsIn=[f"{u['paper']}" + (f" Q{u['qNumber']}" if u["qNumber"] else "")], page=u["page"],
                 textOnly=not u["images"], noAnswer=False, key=u["key"])
        c.update(kw)
        return c

    for u in data["units"]:
        o = ov.get(u["key"], {})
        if u["key"] in dup2020 or (subj == "anaesthesia" and u["paper"] == "2020"):
            continue   # merged below
        if o.get("drop"):
            dropped.append((u["key"], o["dropReason"])); continue
        # manned stations
        if u["section"].endswith("Manned"):
            ex = examiner_cards(u, code, u["paper"])
            if ex:
                head, qas, notes = ex
                station = re.sub(r"\s*\(.*$", "", u["heading"] or "Station").title()
                stem, prompts = split_pre(head)
                if "prompts" in o: prompts = o["prompts"]
                if o.get("stem"): stem = o["stem"]
                c = new_card(u, stem=stem, prompts=prompts, noAnswer=True,
                             notes=["No model answer in the source: refer to Humble's Notes on Anaesthesia or another resource."] + notes,
                             diagnosis=station)
                cards.append(c)
                for q, a in qas:
                    cc = new_card(u, stem=o.get("examinerStem") or f"{station} – examiner's question", prompts=[q],
                                  answer=unwrap(a) or [], noAnswer=not a, diagnosis=None)
                    cards.append(cc)
                continue
        if not u["images"] and not u["answer"] and not u["answerImages"]:
            dropped.append((u["key"], "text without a question or answer: " + " ".join(u["pre"])[:60])); continue
        answer = list(u["answer"])
        pre = list(u["pre"])
        if o.get("answerFromPre"):
            answer, pre = pre + answer, []
        refs, notes = [], []
        mode = "refs"
        for t in u["refs"]:
            if re.match(r"^NOTE\b", t, re.I): mode = "notes"
            (notes if mode == "notes" else refs).append(t)
        answer = unwrap(answer) + list(o.get("answerAppend") or [])
        if "prompts" in o:
            stem, prompts, src = o.get("stem"), o["prompts"], "transcribed"
        else:
            stem, prompts = split_pre(pre)
            if o.get("stem"): stem = o["stem"]
            src = "pdf"
            if not prompts and not stem:
                prompts, src = GENERIC.get(subj, GENERIC["default"]), "generic"
            elif not prompts and stem:
                prompts, stem = [stem], None
        c = new_card(u, stem=stem, prompts=prompts, promptSource=src, answer=answer, refs=unwrap(refs),
                     notes=unwrap(notes) + ([o["note"]] if o.get("note") else []),
                     noAnswer=not answer and not u["answerImages"])
        if u["paper"] == "Picture OSCE models":
            c["stem"] = c["stem"] or (u["heading"].title() if u["heading"] else None)
        ident = prompts and re.match(r"^(identify|what is (this|the name|the diagnosis|the most likely)|name (the|this)|what condition|what (sign|test|structure|instrument)|which|describe what you see|what is your (diagnosis|impression)|what is the diagnosis)", prompts[0], re.I)
        c["diagnosis"] = o.get("diagnosis") or (short_title(answer) if ident else None)
        cards.append(c)

    # merge repeats: same photo (first image) + same prompts
    merged = 0
    keep = []
    for c in cards:
        dup = None
        if c["images"]:
            h = imeta[c["images"][0]]["hash"]
            for k in keep:
                if k["images"] and hamming(imeta[k["images"][0]]["hash"], h) <= 6 and \
                        [p.lower() for p in k["prompts"]] == [p.lower() for p in c["prompts"]]:
                    dup = k; break
        if dup:
            dup["appearsIn"] += c["appearsIn"]
            if not dup["answer"] and c["answer"]: dup["answer"] = c["answer"]
            elif c["answer"] and c["answer"] != dup["answer"]:
                dup.setdefault("altAnswers", []).append(dict(source=c["appearsIn"][0], lines=c["answer"]))
            merged += 1
        else:
            keep.append(c)
    cards = keep
    by_key = {c["key"]: c for c in cards}
    for img, (target, label) in dup2020.items():
        by_key[target]["appearsIn"].append(label)
    for c in cards:
        c.setdefault("altAnswers", [])
        c.pop("key")

    ids = Counter(c["id"] for c in cards)
    assert all(v == 1 for v in ids.values()), [k for k, v in ids.items() if v > 1]
    used = {i for c in cards for i in c["images"] + c["answerImages"]}
    images = {i: dict(w=imeta[i]["w"], h=imeta[i]["h"]) for i in sorted(used)}
    notes = [dict(id=f"{code}-NOTES-{slug(n['paper'])}", subject=subj, title=f"{SUBJECT_NAME[subj]} {n['paper']}",
                  lines=unwrap(n["lines"][1:] if n["lines"] and n["lines"][0].strip() == n["paper"] else n["lines"]),
                  images=n["images"]) for n in data["notes"]]
    for n in notes:
        for i in n["images"]: images[i] = dict(w=imeta[i]["w"], h=imeta[i]["h"])
    # handwritten / photographed revision pages: kept as picture notes (tag "Handwritten"), not quizzed
    for p in data["photos"]:
        notes.append(dict(id=f"{code}-NOTES-{slug(p['paper'])}", subject=subj, title=f"{SUBJECT_NAME[subj]} {p['paper']}",
                          lines=[], images=p["images"], handwritten=True,
                          pages=p["pages"]))
        for i in p["images"]: images[i] = dict(w=imeta[i]["w"], h=imeta[i]["h"])
    photos = []
    json.dump(dict(subject=subj, cards=cards, notes=notes, images=images, deferredPhotos=photos),
              open(os.path.join(OUT, f"{subj}.json"), "w"), ensure_ascii=False, separators=(",", ":"))
    papers = Counter(c["paper"].split(" Set")[0] for c in cards)
    print(f"{subj}: {len(cards)} cards ({merged} repeats merged, {len(dropped)} dropped), "
          f"{sum(c['promptSource']=='transcribed' for c in cards)} transcribed, {sum(c['noAnswer'] for c in cards)} no answer, "
          f"{sum(c['textOnly'] for c in cards)} text-only; {len(images)} images; notes {len(notes)}")
    print("   ", dict(papers))
    for k, r in dropped: print("    dropped", k, r)
    missing = [c["id"] for c in cards if c["images"] and c["promptSource"] == "pdf" and not c["prompts"]]
    if missing: print("    NO PROMPTS:", missing)
    return cards


if __name__ == "__main__":
    for s in sys.argv[1:] or ["anaesthesia", "ent", "ophthalmology"]:
        build(s)
