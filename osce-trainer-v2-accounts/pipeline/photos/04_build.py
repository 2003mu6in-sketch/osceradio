"""Phase V2-3 step 4: hand transcriptions + answer keys -> MCQ drafts; photo blocks -> photo cards.

Output:
  build/mcq/<subject>.photos.draft.json  (same question format as 02_parse drafts; merged by mcq/03_build.py)
  build/mcq/<subject>.photocards.json    (paper-photo cards)
  content/img/<id>.webp (+thumb)          (photo crops and question images such as ECG strips)
"""
import json, os, re, sys, importlib.util
import yaml
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(os.path.dirname(HERE))
PB = os.path.join(ROOT, "build", "photos"); MB = os.path.join(ROOT, "build", "mcq")
IMG = os.path.join(ROOT, "content", "img"); os.makedirs(IMG + "/thumb", exist_ok=True)
spec = importlib.util.spec_from_file_location("tr", os.path.join(HERE, "03_transcripts.py"))
tr = importlib.util.module_from_spec(spec); spec.loader.exec_module(tr)
CODE = {"radiology": "RAD", "anaesthesia": "ANA", "ent": "ENT", "ophthalmology": "OPH"}

# transcript file -> (subject, paper label, key paper in build/mcq/<subject>.draft.json keys, key page, red-key meaning)
FILES = {
    "anaesthesia-2025.txt": ("anaesthesia", "2025", "2025"),
    "anaesthesia-2016.txt": ("anaesthesia", "2016", "2016"),
    "ent-2025.txt": ("ent", "2025", "2025"),
    "ent-2023.txt": ("ent", "2023 recall", None),
    "ent-2016.txt": ("ent", "2016", "2016"),
    "ophthalmology-2025.txt": ("ophthalmology", "2025", "2025"),
    "ophthalmology-2018-2016.txt": ("ophthalmology", "2018 & 2016", "2018 & 2016"),
    "radiology-2023-photos.txt": ("radiology", "2023", "2023"),
    "radiology-2020.txt": ("radiology", "2020", "2020"),
}
# Answers printed in red in a key (PDF gives no explanation): shown to students as "marked in red in the key".
RED_KEY = {("anaesthesia", "2016"): {21, 22, 51, 64, 89},
           ("ent", "2016"): {18, 21, 22, 38, 48, 78, 84, 87, 89}}


def slug(p): return re.sub(r"[^A-Za-z0-9]", "", p.replace(" & ", "-").replace("recall", "R"))


def col_box(subj, page, col):
    d = json.load(open(os.path.join(PB, subj, f"p{page:03d}.ocr.json")))
    W = d["w"]
    if col == "F" or len(d["cols"]) == 1:
        if col == "R": return W // 2, W
        if col == "L": return 0, W // 2
        return 0, W
    c = d["cols"][0 if col == "L" else 1]
    return int(c["x0"]), int(c["x1"])


def crop(subj, parts, out_id):
    pieces = []
    for page, col, top, bottom in parts:
        im = Image.open(os.path.join(PB, subj, f"p{page:03d}.png")).convert("RGB")
        x0, x1 = col_box(subj, page, col)
        pieces.append(im.crop((x0, int(top * im.height), x1, int(bottom * im.height))))
    W = max(p.width for p in pieces); H = sum(p.height for p in pieces)
    out = Image.new("RGB", (W, H), "white"); y = 0
    for p in pieces: out.paste(p, (0, y)); y += p.height
    for path, edge in ((f"{IMG}/{out_id}.webp", 1600), (f"{IMG}/thumb/{out_id}.webp", 420)):
        o = out.copy(); o.thumbnail((edge, edge), Image.LANCZOS); o.save(path, "WEBP", quality=80, method=6)
    o = out.copy(); o.thumbnail((1600, 1600))
    return dict(w=o.width, h=o.height)


def main():
    drafts = {s: [] for s in CODE}; images = {s: {} for s in CODE}; report = []
    keys = {s: json.load(open(os.path.join(MB, f"{s}.draft.json")))["keys"] for s in CODE}
    for fn, (subj, paper, keypaper) in FILES.items():
        qs = tr.parse_file(os.path.join(HERE, "transcripts", fn))
        key = {int(k): v for k, v in (keys[subj].get(keypaper) or {}).items()} if keypaper else {}
        nk = 0
        for q in qs:
            n, suf = q["n"], q["suffix"]
            qid = f"{CODE[subj]}-MCQ-{slug(paper)}-{n:03d}{suf}"
            notes, correct, alt = [], [], []
            if keypaper:
                a = key.get(n)
                if a and a in [o["key"] for o in q["options"]]:
                    correct = [a]
                    if n in RED_KEY.get((subj, keypaper), set()):
                        notes.append("This answer is printed in red in the source's answer key (the PDF does not say why), so treat it with some caution.")
                elif a:
                    notes.append(f"The answer key gives {a}, which is not one of the options.")
            else:
                correct = q.get("marked", [])
                if correct: notes.append("Recalled paper: the answer is the one ticked by the students who recalled it.")
            if not correct: nk += 1
            imgs = []
            for k, im in enumerate(q["images"], 1):
                iid = f"{qid}-img{k}"
                images[subj][iid] = crop(subj, [[im["page"], im["col"], im["top"], im["bottom"]]], iid)
                imgs.append(iid)
            drafts[subj].append(dict(
                id=qid, subject=subj, paper=paper, qNumber=n, page=q["pages"][0], stem=q["stem"],
                options=[dict(o, hl=None, color="black") for o in q["options"]],
                correct=correct, alt=alt, notes=notes, leadIn=q.get("lead"), ansText=[],
                type="mcq", answerFrom="key" if keypaper else "recall-tick", source="transcribed", images=imgs))
        report.append(f"{fn}: {len(qs)} transcribed, {nk} without an answer")
    # photo cards
    blocks = yaml.safe_load(open(os.path.join(HERE, "photo_blocks.yaml")))
    photocards = {s: [] for s in CODE}
    for subj, groups in blocks.items():
        for g in groups:
            key = {int(k): v for k, v in (keys[subj].get(g["paper"]) or {}).items()}
            for b in g["blocks"]:
                cid = f"{CODE[subj]}-PH-{slug(g['paper'])}-{b['q'].replace('–', '-')}"
                images[subj][cid] = crop(subj, b["parts"], cid)
                ak = key.get(b["key"]) if b.get("key") else None
                photocards[subj].append(dict(
                    id=cid, subject=subj, kind="paper-photo", paper=g["paper"], qLabel=b["q"],
                    qNumber=b.get("key"), images=[cid], answerKey=ak, note=g["note"],
                    page=b["parts"][0][0], appearsIn=[f"{g['paper']} Q{b['q']}"]))
        report.append(f"{subj} photo cards: {len(photocards[subj])}")
    for s in CODE:
        json.dump(dict(questions=drafts[s], images=images[s]), open(os.path.join(MB, f"{s}.photos.draft.json"), "w"), ensure_ascii=False, indent=0)
        json.dump(dict(cards=photocards[s]), open(os.path.join(MB, f"{s}.photocards.json"), "w"), ensure_ascii=False, indent=0)
    print("\n".join(report))


if __name__ == "__main__":
    main()
