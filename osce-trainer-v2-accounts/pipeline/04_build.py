"""Step 4: draft cards + overrides -> content/cards.json (the app's single source of truth).

- applies per-card overrides (prompts, stem, answer, diagnosis, modality, images, drop, dupOf, ...)
- fills generic prompts for descriptive cards
- merges duplicates into a canonical card (appearsIn + alternative answers)
- tags a normalised modality
- validates and prints a QA report
"""
import difflib, json, os, re, sys
sys.path.insert(0, "pipeline")
import ov as _ov

draft = json.load(open("build/cards_draft.json"))
images_meta = json.load(open("build/images.json"))
OV = _ov.load()
cov = OV["cards"]

SECTION_NAMES = {
    "70W": "70 Ways to Akorli Kingdom", "30R": "30 Roads to Akorli Kingdom", "2025": "2025 OSCE",
    "TIPS": "2025 OSCE – Final tips", "2023": "2023 OSCE", "2021": "2021 OSCE", "2019": "2019 OSCE",
    "2018": "2018 OSCE", "2017": "2017 OSCE", "2016": "2016 OSCE", "2015": "2015 OSCE", "2014": "2014 OSCE",
}
GENERIC = ["Identify the imaging modality.", "Describe the findings.", "What is the diagnosis?"]
FIELDS = {"prompts", "stem", "answer", "diagnosis", "modality", "images", "notes", "noAnswer", "title"}

MODALITY_RULES = [  # first match wins; checked against modality-ish text
    ("MRI", r"\bMRI\b|\bT[12][ -]?weighted|\bT2 sequence|\bmagnetic"),
    ("Mammography", r"mammogra"),
    ("HSG", r"hysterosalping|\bHSG\b"),
    ("RUG / MCUG / Cystogram", r"urethrogra|\bRUG\b|\bMCUG\b|\bVCUG\b|cystourethr|cystogra|cystogeam|micturat"),
    ("IVU", r"\bIVU\b|urogra|intravenous uro|intravenous ureth"),
    ("Barium study", r"barium|swallow|\bmeal\b|enema|upper GI contrast"),
    ("Angiography", r"angiogra"),
    ("CT", r"\bCT\b|computed tomograph|\bct\b"),
    ("Ultrasound", r"ultraso|\bUSG\b|\bUS\b|sonograph|\bFAST\b|obstetric scan|transcranial|endovaginal|\bscan at \d+ weeks|pelvic scan"),
    ("X-ray", r"x[- ]?ray|radiograph|\bKUB\b|xray|chest|plain film"),
]


def label(sec, q, pic=None):
    s = SECTION_NAMES.get(sec, sec)
    return f"{s} · Q{q}" + (f" (picture {pic})" if pic else "") if q is not None else s


def clean_marks(s):
    s = re.sub(r"\s*[-–]?\s*\(?\d+(?:[./\\]\d+)?\s*(?:marks?|maks|mak|pts?)\b[^)]*\)?", "", s, flags=re.I)
    s = re.sub(r"\s*\(\d[^)]*mark[^)]*\)", "", s, flags=re.I)
    s = re.sub(r"\(\s*\d\s*[\\/]\s*\d\s*(each)?\)", "", s)
    return s.strip(" .;,-")


def classify(card):
    text_first = " ".join(card["answer"][:3] + card["prompts"][:1] + [card.get("diagnosis") or ""])
    for name, rx in MODALITY_RULES:
        if re.search(rx, text_first, re.I):
            return name
    text_all = " ".join(card["answer"] + card["prompts"])
    for name, rx in MODALITY_RULES:
        if re.search(rx, text_all, re.I):
            return name
    return "Other"


def norm_text(lines):
    return re.sub(r"[^a-z0-9 ]", "", " ".join(lines).lower())


def main():
    cards = {}
    order = []
    for c in draft["cards"]:
        cards[c["id"]] = {
            "id": c["id"], "section": c["section"], "qNumber": c["qNumber"], "picture": c["picture"],
            "images": list(dict.fromkeys(c["images"])), "stem": None, "prompts": c["prompts"],
            "answer": c["answerLines"], "diagnosis": c["diagnosis"], "notes": [], "refs": c["refs"],
            "flags": c["flags"], "page": c["page"], "promptSource": "pdf",
        }
        order.append(c["id"])

    # ---- overrides
    unknown = []
    for cid, o in cov.items():
        o = o or {}
        if cid not in cards:
            if "section" not in o:
                unknown.append(cid)
                continue
            cards[cid] = {"id": cid, "section": o["section"], "qNumber": o.get("qNumber"), "picture": o.get("picture"),
                          "images": [], "stem": None, "prompts": [], "answer": [], "diagnosis": None, "notes": [],
                          "refs": [], "flags": [], "page": None, "promptSource": "pdf"}
            after = o.get("after")
            order.insert(order.index(after) + 1 if after in order else len(order), cid)
        c = cards[cid]
        for k in FIELDS & o.keys():
            c[k] = o[k]
        if "prompts" in o:
            c["promptSource"] = o.get("promptSource", "transcribed")
        for k in ("drop", "dupOf", "appearsIn", "keepAlt", "dropAlt"):
            if k in o:
                c[k] = o[k]
    if unknown:
        raise SystemExit(f"overrides for unknown cards: {unknown}")

    # ---- defaults & cleanup
    for c in cards.values():
        if not c["prompts"] and c["images"] and c["answer"] and not c.get("noAnswer"):
            c["prompts"] = list(GENERIC)
            c["promptSource"] = "generic"
        c["answer"] = [a for a in c["answer"] if a.strip() and a.strip() != (c.get("stem") or "").strip()
                       and not (c.get("stem") and a.strip().rstrip(".").lower() in c["stem"].lower())]
        if c["diagnosis"]:
            c["diagnosis"] = clean_marks(c["diagnosis"])
        if not c["answer"]:
            c["noAnswer"] = True
        c["modality"] = c.get("modality") or classify(c)

    # ---- dedupe
    def root(cid, seen=()):
        d = cards[cid].get("dupOf")
        if not d:
            return cid
        if d not in cards:
            raise SystemExit(f"{cid}: dupOf unknown card {d}")
        if d in seen:
            raise SystemExit(f"dupOf cycle at {cid}")
        return root(d, seen + (cid,))

    for c in cards.values():
        c["appearsIn"] = [label(c["section"], c["qNumber"], c["picture"])] + list(c.get("appearsIn") or [])
        c["inSections"] = [c["section"]] + [s for s in SECTION_NAMES if any(
            a.startswith(SECTION_NAMES[s] + " ·") for a in (c.get("appearsIn") or [])) and s != c["section"]]
        c["altAnswers"] = []
    for cid in order:
        c = cards[cid]
        if c.get("drop") or not c.get("dupOf"):
            continue
        r = cards[root(cid)]
        r["appearsIn"].extend(x for x in c["appearsIn"] if x not in r["appearsIn"])
        r["inSections"].extend(x for x in c["inSections"] if x not in r["inSections"])
        copied = c["section"] in ("TIPS", "2025") and not c.get("keepAlt")   # answered by copying an older paper
        if c["answer"] and not c.get("dropAlt") and not copied:
            known = [r["answer"]] + [a["lines"] for a in r["altAnswers"]]
            ratio = max(difflib.SequenceMatcher(None, norm_text(c["answer"]), norm_text(k)).ratio() for k in known)
            if c.get("keepAlt") or ratio < 0.8:
                r["altAnswers"].append({"source": label(c["section"], c["qNumber"], c["picture"]), "lines": c["answer"]})
        if r.get("noAnswer") and c["answer"]:
            r["answer"], r["noAnswer"] = c["answer"], False
        if not r["diagnosis"] and c["diagnosis"]:
            r["diagnosis"] = c["diagnosis"]

    final = [cards[cid] for cid in order if not cards[cid].get("drop") and not cards[cid].get("dupOf")]

    # ---- validation
    problems = []
    used_imgs = set()
    for c in final:
        for i in c["images"]:
            if not os.path.exists(f"content/img/{i}.webp"):
                problems.append(f"{c['id']}: missing image {i}")
            used_imgs.add(i)
        if not c["prompts"]:
            problems.append(f"{c['id']}: no prompts")
        if not c["answer"] and not c.get("noAnswer"):
            problems.append(f"{c['id']}: no answer")
    ids = [c["id"] for c in final]
    assert len(ids) == len(set(ids))

    # unhandled exact-duplicate images (hash distance <= 2) between surviving cards
    owner = {i: c["id"] for c in final for i in c["images"]}
    hs = [(i, images_meta[i]["hash"]) for i in owner]
    dup_warn = []
    for a in range(len(hs)):
        for b in range(a + 1, len(hs)):
            if owner[hs[a][0]] != owner[hs[b][0]] and sum(x != y for x, y in zip(hs[a][1], hs[b][1])) <= 2:
                dup_warn.append(f"{owner[hs[a][0]]} ~ {owner[hs[b][0]]}")

    out_cards = []
    for c in final:
        out_cards.append({k: c[k] for k in ("id", "section", "qNumber", "picture", "images", "stem", "prompts",
                                             "promptSource", "answer", "altAnswers", "diagnosis", "notes",
                                             "modality", "appearsIn", "inSections", "page") if k in c} |
                         {"textOnly": not c["images"], "noAnswer": bool(c.get("noAnswer"))})
    img_out = {i: {"w": images_meta[i]["w"], "h": images_meta[i]["h"]} for i in sorted(used_imgs)}
    secs = [{"id": s, "name": SECTION_NAMES[s]} for s in SECTION_NAMES]
    json.dump({"version": 1, "source": "MASTERPIECE – OSCE RADIOLOGY (UPDATED)", "sections": secs,
               "images": img_out, "cards": out_cards}, open("content/cards.json", "w"), indent=1, ensure_ascii=False)

    rec = ["| PDF item | Page | Outcome |", "|---|---|---|"]
    for cid in order:
        c = cards[cid]
        lab = label(c["section"], c["qNumber"], c["picture"]) if c["qNumber"] is not None else f"{SECTION_NAMES[c['section']]} · {cid}"
        if c.get("drop"):
            out = "dropped – " + (cov.get(cid, {}).get("dropReason") or "no usable content (see overrides)")
        elif c.get("dupOf"):
            out = f"merged into **{root(cid)}**"
        else:
            out = f"card **{cid}**"
        rec.append(f"| {lab} | {c['page'] or '–'} | {out} |")
    open("build/reconciliation.md", "w").write("\n".join(rec) + "\n")

    from collections import Counter
    print(f"{len(final)} cards ({sum(1 for c in final if c['images'])} with images) from {len(order)} drafts; "
          f"{len(used_imgs)} images used")
    print("by section:", dict(Counter(c["section"] for c in final)))
    print("by modality:", dict(Counter(c["modality"] for c in final)))
    print("prompt source:", dict(Counter(c["promptSource"] for c in final)))
    print("no answer:", [c["id"] for c in final if c.get("noAnswer")])
    print("no diagnosis:", len([c for c in final if not c["diagnosis"]]))
    print("alt answers:", sum(len(c["altAnswers"]) for c in final))
    for p in problems:
        print("PROBLEM", p)
    for w in dup_warn:
        print("DUP?", w)


if __name__ == "__main__":
    main()
