"""Debug: review tiles = question image(s) + OCR draft + parsed prompts + answer start.
usage: review.py SUBJECT START END -> build/osce2/peek/r-<subj>-<start>.png"""
import json, sys, os, textwrap
from PIL import Image, ImageDraw, ImageFont
subj, a, b = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
d = json.load(open(f"build/osce2/{subj}.units.json"))["units"]
F = ImageFont.load_default(size=15)
tiles = []
for i in range(a, min(b, len(d))):
    u = d[i]
    ims = [Image.open(f"content/img/{x}.webp").convert("RGB") for x in u["images"][:3]]
    for im in ims: im.thumbnail((560, 420))
    iw = max([im.width for im in ims] + [200]); ih = sum(im.height + 6 for im in ims) or 60
    lines = [f"[{i}] {u['key']} | {u['paper']} p{u['page']} {u['heading'] or ''} imgs={u['images'][1:]}"]
    for x in u["images"][:2]:
        p = f"build/osce2/ocr/{x}.txt"
        if os.path.exists(p):
            t = [l for l in open(p).read().splitlines() if l.strip()][:10]
            lines += ["OCR " + x + ":"] + ["  " + l[:70] for l in t]
    lines += ["PRE:"] + ["  " + l[:70] for l in u["pre"][:6]]
    lines += ["ANS:"] + ["  " + l[:70] for l in u["answer"][:6]]
    th = 18 * len(lines) + 10
    tile = Image.new("RGB", (iw + 620, max(ih, th) + 8), "white"); dr = ImageDraw.Draw(tile)
    y = 4
    for im in ims: tile.paste(im, (4, y)); y += im.height + 6
    for k, l in enumerate(lines): dr.text((iw + 12, 4 + 18 * k), l, fill="black" if not l.startswith("OCR") else "blue", font=F)
    dr.line([(0, tile.height - 1), (tile.width, tile.height - 1)], fill="#999", width=2)
    tiles.append(tile)
W = max(t.width for t in tiles); H = sum(t.height for t in tiles)
out = Image.new("RGB", (W, H), "white"); y = 0
for t in tiles: out.paste(t, (0, y)); y += t.height
p = f"build/osce2/peek/r-{subj}-{a}.png"; out.save(p); print(p, out.size)
