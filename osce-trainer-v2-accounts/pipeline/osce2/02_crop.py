"""OSCE V2 step 2: render pages @200 dpi and crop every image to WebP (full + thumb).

usage: 02_crop.py SUBJECT [image ids…]
Image ids: <CODE>-p<page>-<k>, e.g. ANA-p12-1. Writes content/img/<id>.webp and
content/img/thumb/<id>.webp, and build/osce2/<subject>.images.json.
Overrides: pipeline/osce2/overrides/<subject>.yaml → images.<id>: {crop:[l,t,r,b]} or {from: id, crop: […]}.
"""
import json, os, subprocess, sys
import numpy as np
from PIL import Image
import yaml

HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(os.path.dirname(HERE))
FILES = {"anaesthesia": "OSCE_ANAESTHESIA_UPDATED", "ent": "OSCE_ENT_UPDATED", "ophthalmology": "OSCE_OPHTHALMOLOGY_UPDATED"}
CODE = {"anaesthesia": "ANA", "ent": "ENT", "ophthalmology": "OPH"}
DPI = 200; SCALE = DPI / 72
LONG, THUMB, Q = 1600, 420, 80
OUT = os.path.join(ROOT, "content", "img"); os.makedirs(OUT + "/thumb", exist_ok=True)

def dhash(im, size=8):
    g = np.asarray(im.convert("L").resize((size + 1, size), Image.LANCZOS), dtype=np.int16)
    return "".join("1" if b else "0" for b in (g[:, 1:] > g[:, :-1]).flatten())

def save(im, path, edge):
    im = im.copy(); im.thumbnail((edge, edge), Image.LANCZOS); im.save(path, "WEBP", quality=Q, method=6); return im.size

def main(subj, only):
    src = os.path.join(ROOT, "sources", FILES[subj] + ".pdf")
    rdir = os.path.join(ROOT, "build", "osce2", "render", subj); os.makedirs(rdir, exist_ok=True)
    lay_path = os.path.join(ROOT, "build", "osce2", f"{subj}.layout.json")
    pages = json.load(open(lay_path))
    ov = (yaml.safe_load(open(os.path.join(HERE, "overrides", f"{subj}.yaml"))) or {}).get("images") or {}
    meta_path = os.path.join(ROOT, "build", "osce2", f"{subj}.images.json")
    meta = json.load(open(meta_path)) if only and os.path.exists(meta_path) else {}
    cache = {}
    def render(pno):
        if pno not in cache:
            path = f"{rdir}/p{pno:03d}.png"
            if not os.path.exists(path):
                subprocess.run(["pdftoppm", "-r", str(DPI), "-png", "-singlefile", "-f", str(pno), "-l", str(pno), src, path[:-4]], check=True)
            cache.clear(); cache[pno] = Image.open(path).convert("RGB")
        return cache[pno]
    def crop_of(pno, it, fr):
        im = render(pno); W, H = im.size
        box = [max(0, it["x0"] * SCALE), max(0, it["y0"] * SCALE), min(W, it["x1"] * SCALE), min(H, it["y1"] * SCALE)]
        c = im.crop(tuple(int(round(v)) for v in box))
        if fr:
            cw, ch = c.size; c = c.crop((int(fr[0] * cw), int(fr[1] * ch), int(fr[2] * cw), int(fr[3] * ch)))
        return c
    items = {}
    for p in pages:
        k = 0
        for it in p["items"]:
            if it["type"] != "img": continue
            k += 1; iid = f"{CODE[subj]}-p{p['page']}-{k}"; it["id"] = iid; items[iid] = (p["page"], it)
    for iid, (pno, it) in items.items():
        if only and iid not in only: continue
        c = crop_of(pno, it, (ov.get(iid) or {}).get("crop"))
        w, h = save(c, f"{OUT}/{iid}.webp", LONG); save(c, f"{OUT}/thumb/{iid}.webp", THUMB)
        meta[iid] = dict(page=pno, w=w, h=h, hash=dhash(c), box=[it["x0"], it["y0"], it["x1"], it["y1"]])
    for nid, spec in ov.items():
        if "from" not in spec or (only and nid not in only): continue
        pno, it = items[spec["from"]]
        c = crop_of(pno, it, spec["crop"])
        w, h = save(c, f"{OUT}/{nid}.webp", LONG); save(c, f"{OUT}/thumb/{nid}.webp", THUMB)
        meta[nid] = dict(page=pno, w=w, h=h, hash=dhash(c), box=None, derivedFrom=spec["from"])
    json.dump(meta, open(meta_path, "w"), indent=0)
    json.dump(pages, open(lay_path, "w"), ensure_ascii=False, indent=0)
    size = sum(os.path.getsize(f"{OUT}/{i}.webp") for i in meta)
    print(f"{subj}: {len(meta)} images, {size/1e6:.1f} MB")

if __name__ == "__main__":
    main(sys.argv[1], set(sys.argv[2:]))
