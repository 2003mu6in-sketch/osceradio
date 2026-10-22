"""Step 2: render pages and crop every content image to WebP (full + thumbnail).

Writes content/img/p{page}-{k}.webp, content/img/thumb/p{page}-{k}.webp and
build/images.json with box, size and a 64-bit difference hash for dedupe.
Crops can be refined per image via pipeline/overrides.yaml -> images.<id>.crop
(fractions of the original crop: [left, top, right, bottom]).
"""
import json, os, subprocess, sys
import numpy as np
from PIL import Image
import yaml

SRC = "build/source.pdf"
DPI = 200
SCALE = DPI / 72
RENDER_DIR = "build/render"
OUT_DIR = "content/img"
LONG_EDGE, THUMB_EDGE, QUALITY = 1600, 420, 80

os.makedirs(RENDER_DIR, exist_ok=True)
os.makedirs(OUT_DIR + "/thumb", exist_ok=True)
pages = json.load(open("build/layout.json"))
sys.path.insert(0, "pipeline")
import ov as _ov
img_ov = _ov.load()["images"]


def render(pno):
    path = f"{RENDER_DIR}/p{pno:03d}.png"
    if not os.path.exists(path):
        subprocess.run(["pdftoppm", "-r", str(DPI), "-png", "-singlefile", "-f", str(pno), "-l", str(pno),
                        SRC, path[:-4]], check=True)
    return Image.open(path).convert("RGB")


def dhash(im, size=8):
    g = np.asarray(im.convert("L").resize((size + 1, size), Image.LANCZOS), dtype=np.int16)
    bits = (g[:, 1:] > g[:, :-1]).flatten()
    return "".join("1" if b else "0" for b in bits)


def save(im, path, edge):
    im = im.copy()
    im.thumbnail((edge, edge), Image.LANCZOS)
    im.save(path, "WEBP", quality=QUALITY, method=6)
    return im.size


def main():
    only = set(sys.argv[1:])
    meta = {}
    for p in pages:
        imgs = [it for it in p["items"] if it["type"] == "img" and not it["small"]]
        if not imgs:
            continue
        page_im = None
        for k, it in enumerate(imgs, 1):
            iid = f"p{p['page']}-{k}"
            it["id"] = iid
            if only and iid not in only:
                continue
            if page_im is None:
                page_im = render(p["page"])
            W, H = page_im.size
            box = [max(0, it["x0"] * SCALE), max(0, it["y0"] * SCALE),
                   min(W, it["x1"] * SCALE), min(H, it["y1"] * SCALE)]
            crop = page_im.crop(tuple(int(round(v)) for v in box))
            fr = (img_ov.get(iid) or {}).get("crop")
            if fr:
                cw, ch = crop.size
                crop = crop.crop((int(fr[0] * cw), int(fr[1] * ch), int(fr[2] * cw), int(fr[3] * ch)))
            w, h = save(crop, f"{OUT_DIR}/{iid}.webp", LONG_EDGE)
            save(crop, f"{OUT_DIR}/thumb/{iid}.webp", THUMB_EDGE)
            meta[iid] = {"page": p["page"], "w": w, "h": h, "hash": dhash(crop),
                         "box": [it["x0"], it["y0"], it["x1"], it["y1"]]}
    # derived images: {new_id: {from: base_id, crop: [l,t,r,b]}} (e.g. split side-by-side pictures)
    base_items = {it.get("id"): (p["page"], it) for p in pages for it in p["items"] if it.get("id")}
    for nid, spec in img_ov.items():
        if "from" not in spec or (only and nid not in only):
            continue
        pno, it = base_items[spec["from"]]
        page_im = render(pno)
        W, H = page_im.size
        box = [max(0, it["x0"] * SCALE), max(0, it["y0"] * SCALE), min(W, it["x1"] * SCALE), min(H, it["y1"] * SCALE)]
        crop = page_im.crop(tuple(int(round(v)) for v in box))
        fr = spec["crop"]; cw, ch = crop.size
        crop = crop.crop((int(fr[0] * cw), int(fr[1] * ch), int(fr[2] * cw), int(fr[3] * ch)))
        w, h = save(crop, f"{OUT_DIR}/{nid}.webp", LONG_EDGE)
        save(crop, f"{OUT_DIR}/thumb/{nid}.webp", THUMB_EDGE)
        meta[nid] = {"page": pno, "w": w, "h": h, "hash": dhash(crop), "box": None, "derivedFrom": spec["from"]}
    if only:
        old = json.load(open("build/images.json"))
        old.update(meta)
        meta = old
    json.dump(meta, open("build/images.json", "w"), indent=1)
    json.dump(pages, open("build/layout.json", "w"), indent=1)   # now carries image ids
    total = sum(os.path.getsize(f"{OUT_DIR}/{f}") for f in os.listdir(OUT_DIR) if f.endswith(".webp"))
    print(f"{len(meta)} images, {total/1e6:.1f} MB full-size")


if __name__ == "__main__":
    main()
