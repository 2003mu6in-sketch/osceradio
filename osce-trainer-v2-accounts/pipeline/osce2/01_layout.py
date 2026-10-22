"""OSCE V2 step 1: per-page stream of text rows (with colour) and merged image boxes.

usage: 01_layout.py [subject ...]   subjects: anaesthesia ent ophthalmology
Output: build/osce2/<subject>.layout.json  [{page, w, h, items:[{type:'row'|'img', ...}]}]
"""
import json, os, sys, importlib.util
import pypdfium2 as pdfium, pypdfium2.raw as R

HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(os.path.dirname(HERE))
FILES = {"anaesthesia": "OSCE_ANAESTHESIA_UPDATED", "ent": "OSCE_ENT_UPDATED", "ophthalmology": "OSCE_OPHTHALMOLOGY_UPDATED"}
OUT = os.path.join(ROOT, "build", "osce2"); os.makedirs(OUT, exist_ok=True)

def _load(path, name):
    spec = importlib.util.spec_from_file_location(name, path); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m); return m
mlay = _load(os.path.join(ROOT, "pipeline", "mcq", "01_layout.py"), "mlay")
mparse = _load(os.path.join(ROOT, "pipeline", "mcq", "02_parse.py"), "mparse")

MIN_W, MIN_H, GAP = 60, 45, 4

def merge(boxes):
    boxes = [list(b) for b in boxes]
    changed = True
    while changed:
        changed = False
        for i in range(len(boxes)):
            for j in range(i + 1, len(boxes)):
                a, b = boxes[i], boxes[j]
                if a[0] - GAP <= b[2] and b[0] - GAP <= a[2] and a[1] - GAP <= b[3] and b[1] - GAP <= a[3]:
                    boxes[i] = [min(a[0], b[0]), min(a[1], b[1]), max(a[2], b[2]), max(a[3], b[3])]
                    boxes.pop(j); changed = True; break
            if changed: break
    return boxes

def build(subj):
    src = os.path.join(ROOT, "sources", FILES[subj] + ".pdf")
    pdf = pdfium.PdfDocument(src)
    pages = []
    for pi in range(len(pdf)):
        page = pdf[pi]; W, H = page.get_size()
        hr = mlay.rects(page, H)
        lines = []
        for ln in mlay.lines_from_chars(mlay.chars(page, H)):
            vis = [c for c in ln if c[0].strip() and c[3] > c[1]]
            if not vis: continue
            text = "".join(c[0] for c in ln).strip()
            x0 = min(c[1] for c in vis); y0 = min(c[2] for c in vis); x1 = max(c[3] for c in vis); y1 = max(c[4] for c in vis)
            if y0 < 60 and "HUMBLE" in text.upper(): continue
            from collections import Counter
            col = Counter(mlay.classify_text(c[5]) for c in vis).most_common(1)[0][0]
            lines.append(dict(x0=x0, y0=y0, x1=x1, y1=y1, text=text, color=col, hl=None, n=pi + 1))
        rows = mparse.rows_of(dict(n=pi + 1, lines=lines))
        items = [dict(type="row", text=r["text"], x0=round(r["x0"], 1), y0=round(r["y0"], 1), color=r["color"]) for r in rows]
        boxes = []
        for o in page.get_objects(filter=[R.FPDF_PAGEOBJ_IMAGE], max_depth=5):
            l, b, r, t = o.get_bounds(); boxes.append((l, H - t, r, H - b))
        for b in merge(boxes):
            w, h = b[2] - b[0], b[3] - b[1]
            if w < MIN_W or h < MIN_H or b[1] < 40: continue
            items.append(dict(type="img", x0=round(b[0], 1), y0=round(b[1], 1), x1=round(b[2], 1), y1=round(b[3], 1)))
        items.sort(key=lambda it: (it["y0"], it["x0"]))
        pages.append(dict(page=pi + 1, w=round(W), h=round(H), items=items))
    json.dump(pages, open(os.path.join(OUT, f"{subj}.layout.json"), "w"), ensure_ascii=False, indent=0)
    n = sum(1 for p in pages for it in p["items"] if it["type"] == "img")
    print(f"{subj}: {len(pages)} pages, {n} images")

if __name__ == "__main__":
    for s in sys.argv[1:] or FILES: build(s)
