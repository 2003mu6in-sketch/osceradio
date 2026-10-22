"""Per-page text lines with colour and highlight, from the typed MCQ PDFs.

Output: build/mcq/<name>.layout.json
  {pages: [{n, w, h, kind: 'text'|'photo', lines: [{x0,y0,x1,y1,text,color,hl}]}]}
color = dominant text fill colour ('black'|'red'|'blue'|'other'); hl = 'yellow'|'cyan'|'green'|None
"""
import ctypes, json, sys, os
from collections import Counter
import pypdfium2 as pdfium, pypdfium2.raw as R

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SRC = os.path.join(ROOT, "sources")
OUT = os.path.join(ROOT, "build", "mcq"); os.makedirs(OUT, exist_ok=True)
FILES = ["RADIOLOGY_MCQs_UPDATED_2025", "ANAESTHESIA_MCQs", "ENT_MCQs", "OPHTHALMOLOGY_MCQs"]

def classify_fill(c):
    r, g, b = c
    if r > 200 and g > 200 and b < 120: return "yellow"
    if r < 120 and g > 200 and b > 200: return "cyan"
    if r < 150 and g > 180 and b < 150: return "green"
    if r > 200 and g < 200 and b > 200: return "magenta"
    return None

def classify_text(c):
    r, g, b = c
    if r < 90 and g < 90 and b < 90: return "black"
    if r > 150 and g < 90 and b < 90: return "red"
    if b > 120 and r < 90: return "blue"
    return "other"

def rects(page, H):
    out = []
    for obj in page.get_objects():
        if obj.type != R.FPDF_PAGEOBJ_PATH: continue
        r, g, b, a = (ctypes.c_uint() for _ in range(4))
        R.FPDFPageObj_GetFillColor(obj.raw, *(ctypes.byref(x) for x in (r, g, b, a)))
        kind = classify_fill((r.value, g.value, b.value))
        if not kind: continue
        L, B, Rt, T = (ctypes.c_float() for _ in range(4))
        R.FPDFPageObj_GetBounds(obj.raw, *(ctypes.byref(x) for x in (L, B, Rt, T)))
        out.append((L.value, H - T.value, Rt.value, H - B.value, kind))
    return out

def chars(page, H):
    tp = page.get_textpage()
    n = R.FPDFText_CountChars(tp.raw)
    res = []
    l, rgt, b, t = (ctypes.c_double() for _ in range(4))
    cr, cg, cb, ca = (ctypes.c_uint() for _ in range(4))
    for i in range(n):
        u = R.FPDFText_GetUnicode(tp.raw, i)
        ch = chr(u) if u else ""
        if ch in ("\r", "\n", "\x02", "￾"):
            res.append(None); continue
        R.FPDFText_GetCharBox(tp.raw, i, *(ctypes.byref(x) for x in (l, rgt, b, t)))
        R.FPDFText_GetFillColor(tp.raw, i, *(ctypes.byref(x) for x in (cr, cg, cb, ca)))
        res.append((ch, l.value, H - t.value, rgt.value, H - b.value, (cr.value, cg.value, cb.value)))
    return res

def lines_from_chars(cs):
    # pdfium emits \r\n between lines; split on those, then also split if y jumps.
    lines, cur = [], []
    def flush():
        if cur:
            lines.append(cur.copy()); cur.clear()
    prev = None
    for c in cs:
        if c is None: flush(); prev = None; continue
        if prev and c[0] != " " and prev[0] != " ":
            ymid = (c[2] + c[4]) / 2
            if not (prev[2] - 3 <= ymid <= prev[4] + 3) or c[1] < prev[1] - 30:
                flush()
        cur.append(c)
        if c[0] != " ": prev = c
    flush()
    return lines

def build(name):
    pdf = pdfium.PdfDocument(os.path.join(SRC, name + ".pdf"))
    pages = []
    for pi in range(len(pdf)):
        page = pdf[pi]; W, H = page.get_size()
        hr = rects(page, H)
        out = []
        for ln in lines_from_chars(chars(page, H)):
            vis = [c for c in ln if c[0].strip() and c[3] > c[1]]
            if not vis: continue
            text = "".join(c[0] for c in ln).strip()
            x0 = min(c[1] for c in vis); y0 = min(c[2] for c in vis)
            x1 = max(c[3] for c in vis); y1 = max(c[4] for c in vis)
            if y0 < 60 and "HUMBLE" in text.upper(): continue   # running header
            col = Counter(classify_text(c[5]) for c in vis).most_common(1)[0][0]
            # highlight: share of visible chars whose centre lies in a highlight rect
            hk = Counter()
            for c in vis:
                cx, cy = (c[1] + c[3]) / 2, (c[2] + c[4]) / 2
                for (a, b_, r_, d, k) in hr:
                    if a - 0.5 <= cx <= r_ + 0.5 and b_ - 1 <= cy <= d + 1:
                        hk[k] += 1; break
            hl = None
            if hk:
                k, cnt = hk.most_common(1)[0]
                if cnt >= 0.5 * len(vis): hl = k
            out.append(dict(x0=round(x0, 1), y0=round(y0, 1), x1=round(x1, 1), y1=round(y1, 1),
                            text=text, color=col, hl=hl))
        out.sort(key=lambda d: (round(d["y0"] / 3), d["x0"]))
        words = sum(len(d["text"].split()) for d in out)
        pages.append(dict(n=pi + 1, w=round(W), h=round(H), kind="text" if words > 40 else "photo", lines=out))
    json.dump(dict(file=name, pages=pages), open(os.path.join(OUT, name + ".layout.json"), "w"), ensure_ascii=False)
    kinds = "".join("T" if p["kind"] == "text" else "." for p in pages)
    nh = sum(1 for p in pages for l in p["lines"] if l["hl"])
    print(f"{name}: {len(pages)} pages, {nh} highlighted lines\n  {kinds}")

if __name__ == "__main__":
    for f in (sys.argv[1:] or FILES): build(f)
