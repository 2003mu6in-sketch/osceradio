"""Phase V2-3 step 1: OCR photographed exam pages, column by column.

Input : build/photos/<subject>/p<NNN>.png (full-res photos from pdfimages)
Output: build/photos/<subject>/p<NNN>.ocr.json  {w,h, cols:[{x0,x1, lines:[{text,x0,y0,x1,y1,conf}]}]}
"""
import json, os, subprocess, sys, glob, csv, io
import numpy as np
from PIL import Image, ImageOps, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(os.path.dirname(HERE))

def columns(g):
    """Find a vertical gutter near the middle: the column with the least dark ink."""
    a = np.asarray(g, dtype=np.int16)
    dark = (a < 110).mean(axis=0)
    w = a.shape[1]
    lo, hi = int(w * 0.38), int(w * 0.62)
    k = 9
    sm = np.convolve(dark, np.ones(k) / k, mode="same")
    x = lo + int(np.argmin(sm[lo:hi]))
    if sm[x] > 0.02:     # no clear gutter → single column
        return [(0, w)]
    return [(0, x), (x, w)]

def ocr(img):
    out = subprocess.run(["tesseract", "stdin", "stdout", "--psm", "4", "-l", "eng", "tsv"],
                         input=img, capture_output=True).stdout.decode("utf-8", "ignore")
    rows = list(csv.DictReader(io.StringIO(out), delimiter="\t", quoting=csv.QUOTE_NONE))
    lines = {}
    for r in rows:
        if r["level"] != "5" or not r["text"].strip(): continue
        key = (r["block_num"], r["par_num"], r["line_num"])
        L = lines.setdefault(key, dict(words=[], x0=1e9, y0=1e9, x1=0, y1=0, conf=[]))
        x, y, w, h = (int(r[k]) for k in ("left", "top", "width", "height"))
        L["words"].append(r["text"]); L["conf"].append(float(r["conf"]))
        L["x0"] = min(L["x0"], x); L["y0"] = min(L["y0"], y); L["x1"] = max(L["x1"], x + w); L["y1"] = max(L["y1"], y + h)
    res = [dict(text=" ".join(L["words"]), x0=L["x0"], y0=L["y0"], x1=L["x1"], y1=L["y1"],
                conf=round(sum(L["conf"]) / len(L["conf"]), 1)) for L in lines.values()]
    return sorted(res, key=lambda l: l["y0"])

def run(path):
    im = Image.open(path).convert("L")
    W, H = im.size
    S = 2.2
    big = im.resize((int(W * S), int(H * S)), Image.LANCZOS)
    big = ImageOps.autocontrast(big, cutoff=1).filter(ImageFilter.UnsharpMask(radius=2, percent=120))
    cols = []
    for (a, b) in columns(im):
        crop = big.crop((int(a * S), 0, int(b * S), big.height))
        buf = io.BytesIO(); crop.save(buf, "PNG")
        lines = ocr(buf.getvalue())
        for l in lines:
            for k in ("x0", "x1"): l[k] = round(l[k] / S + a, 1)
            for k in ("y0", "y1"): l[k] = round(l[k] / S, 1)
        cols.append(dict(x0=a, x1=b, lines=lines))
    json.dump(dict(w=W, h=H, cols=cols), open(path.replace(".png", ".ocr.json"), "w"), ensure_ascii=False, indent=0)
    return len(cols), sum(len(c["lines"]) for c in cols)

if __name__ == "__main__":
    from concurrent.futures import ProcessPoolExecutor
    paths = sorted(glob.glob(os.path.join(ROOT, "build", "photos", sys.argv[1] if len(sys.argv) > 1 else "*", "p*.png")))
    with ProcessPoolExecutor(8) as ex:
        for p, r in zip(paths, ex.map(run, paths)):
            print(os.path.relpath(p, ROOT), r)
