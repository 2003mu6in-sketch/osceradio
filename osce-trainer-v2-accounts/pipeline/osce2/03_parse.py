"""OSCE V2 step 3: split each PDF into question units.

Input : build/osce2/<subject>.layout.json (with image ids from 02_crop), sections.yaml
Output: build/osce2/<subject>.units.json  {units:[...], notes:[...], photos:[...]}

A unit is: question images + text before ANSWER (stem/prompts) + ANSWER + answer text/images.
New unit when: a "QUESTION n" row, a section `unit` row, or an image that follows
answer text (> 40 characters) of the current unit.
"""
import json, os, re, sys
import yaml

HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(os.path.dirname(HERE))
CFG = yaml.safe_load(open(os.path.join(HERE, "sections.yaml")))
B = os.path.join(ROOT, "build", "osce2")

Q_HEAD = re.compile(r"^QUESTION\s*(\d+)?\s*:?\s*$", re.I)
ANS_HEAD = re.compile(r"^\s*ANSWERS?\s*(\(.*\))?\s*:?\s*(.*)$", re.I)
REF_HEAD = re.compile(r"^Reference\(?s?\)?\s*:?\s*$", re.I)
LETTER_ROW = re.compile(r"^([A-F]\s*){1,4}$")


def new_unit(sec, sub, page, qnum=None, heading=None):
    return dict(paper=sec["paper"] + (f" {sub}" if sub else ""), section=sec["paper"], qNumber=qnum, page=page,
                heading=heading, images=[], pre=[], answer=[], answerImages=[], refs=[], _phase="q")


def starts_question(items, idx, unit_re, window=12, ans_re=None):
    """An image after answer text opens a new question when an ANSWER heading follows it
    (after at most `window` prompt rows) before any QUESTION heading or unit row."""
    rows = 0
    for it in items[idx + 1:]:
        if it["type"] == "img":
            continue
        t = it["text"].strip()
        if ANS_HEAD.match(t) or (ans_re and ans_re.match(t)): return True
        if Q_HEAD.match(t) or (unit_re and unit_re.match(t)): return False
        rows += 1
        if rows > window: return False
    return False


def parse(subj):
    cfg = CFG[subj]
    pov = ((yaml.safe_load(open(os.path.join(HERE, "overrides", f"{subj}.yaml"))) or {}).get("parse") or {})
    force_ans, force_new = set(pov.get("answerImage") or []), set(pov.get("newUnit") or [])
    pages = json.load(open(os.path.join(B, f"{subj}.layout.json")))
    stream = [dict(it, page=p["page"]) for p in pages for it in p["items"]]
    starts = []
    for s in cfg["sections"]:
        if s["start"] is None:
            i = next(k for k, it in enumerate(stream) if it["page"] == s["page"])
        else:
            i = next((k for k, it in enumerate(stream) if it["page"] == s["page"] and it["type"] == "row" and re.search(s["start"], it["text"])), None)
        if i is None: raise SystemExit(f"{subj}: section start not found {s}")
        starts.append(i)
    starts.append(len(stream))
    units, notes, photos = [], [], []
    for si, sec in enumerate(cfg["sections"]):
        items = stream[starts[si]: starts[si + 1]]
        if sec["kind"] == "skip": continue
        if sec["kind"] == "notes":
            notes.append(dict(paper=sec["paper"], page=items[0]["page"],
                              lines=[it["text"] for it in items if it["type"] == "row"],
                              images=[it["id"] for it in items if it["type"] == "img"]))
            continue
        if sec["kind"] == "photos":
            photos.append(dict(paper=sec["paper"], pages=sorted({it["page"] for it in items}),
                               images=[it["id"] for it in items if it["type"] == "img"],
                               lines=[it["text"] for it in items if it["type"] == "row"]))
            continue
        unit_re = re.compile(sec["unit"]) if sec.get("unit") else None
        sub_re = re.compile(sec["sub"]) if sec.get("sub") else None
        ans_re = re.compile(sec["answerHead"]) if sec.get("answerHead") else None
        sub, cur = None, None
        def close():
            nonlocal cur
            if cur and (cur["images"] or cur["answer"] or sum(len(t) for t in cur["pre"]) > 30):
                units.append(cur)
            cur = None
        for idx, it in enumerate(items):
            if idx == 0 and it["type"] == "row" and not sec.get("keepFirst"):
                continue      # the section heading itself
            if it["type"] == "row":
                t = it["text"].strip()
                if sub_re and sub_re.match(t):
                    close(); sub = t.rstrip(":").title(); continue
                m = Q_HEAD.match(t)
                if m:
                    close(); cur = new_unit(sec, sub, it["page"], int(m.group(1)) if m.group(1) else None, t); continue
                if unit_re and unit_re.match(t):
                    close(); cur = new_unit(sec, sub, it["page"], heading=t.rstrip(":")); continue
                if cur is None:
                    cur = new_unit(sec, sub, it["page"])
                am = ANS_HEAD.match(t)
                if (am or (ans_re and ans_re.match(t))) and cur["_phase"] == "q":
                    cur["_phase"] = "a"
                    if am and am.group(2): cur["answer"].append(am.group(2))
                    continue
                if REF_HEAD.match(t) and cur["_phase"] in ("a", "ref"):
                    cur["_phase"] = "ref"; continue
                if cur["_phase"] == "q":
                    if not LETTER_ROW.match(t): cur["pre"].append(t)
                elif cur["_phase"] == "a":
                    cur["answer"].append(t)
                else:
                    cur["refs"].append(t)
            else:   # image
                if cur is None:
                    cur = new_unit(sec, sub, it["page"])
                if it["id"] in force_new and (cur["images"] or cur["answer"]):
                    close(); cur = new_unit(sec, sub, it["page"]); cur["images"].append(it["id"])
                elif it["id"] in force_ans:
                    cur["answerImages"].append(it["id"])
                elif cur["_phase"] == "q":
                    cur["images"].append(it["id"])
                else:
                    if starts_question(items, idx, unit_re, ans_re=ans_re):
                        close(); cur = new_unit(sec, sub, it["page"]); cur["images"].append(it["id"])
                    else:
                        cur["answerImages"].append(it["id"])
        close()
    tcount = {}
    for u in units:
        u.pop("_phase", None)
        if u["images"]:
            u["key"] = u["images"][0]
        else:
            tcount[u["page"]] = tcount.get(u["page"], 0) + 1
            u["key"] = f"{cfg['code']}-p{u['page']}-t{tcount[u['page']]}"
    json.dump(dict(units=units, notes=notes, photos=photos), open(os.path.join(B, f"{subj}.units.json"), "w"), ensure_ascii=False, indent=1)
    from collections import Counter
    c = Counter(u["paper"].split(" Set")[0] for u in units)
    noimg = sum(1 for u in units if not u["images"]); noans = sum(1 for u in units if not u["answer"])
    print(f"{subj}: {len(units)} units ({noimg} without question image, {noans} without answer); notes {len(notes)}, photo blocks {len(photos)}")
    print("   ", dict(c))


if __name__ == "__main__":
    for s in sys.argv[1:] or CFG: parse(s)
