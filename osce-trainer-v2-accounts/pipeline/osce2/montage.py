"""Debug: montage of units' images with labels for visual review.
usage: montage.py SUBJECT START END [width]  -> build/osce2/peek/<subj>-<start>.png"""
import json, sys, os
from PIL import Image, ImageDraw, ImageFont
subj, a, b = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]); W = int(sys.argv[4]) if len(sys.argv) > 4 else 520
d = json.load(open(f"build/osce2/{subj}.units.json"))["units"]
font = ImageFont.load_default(size=16) if hasattr(ImageFont, "load_default") else None
tiles = []
for i in range(a, min(b, len(d))):
    u = d[i]
    ims = [Image.open(f"content/img/{x}.webp").convert("RGB") for x in u["images"][:4]]
    ans = [Image.open(f"content/img/{x}.webp").convert("RGB") for x in u["answerImages"][:3]]
    row = []
    for im in ims + ans:
        im.thumbnail((W, W)); row.append(im)
    h = max([im.height for im in row] + [40]) + 30
    tile = Image.new("RGB", (max(W, sum(im.width for im in row) + 10 * len(row)), h), "white")
    dr = ImageDraw.Draw(tile)
    lab = f"[{i}] {u['paper']} p{u['page']} {u['heading'] or ''} | Q:{len(ims)} A:{len(ans)} | {(u['answer'][0] if u['answer'] else '-')[:60]}"
    dr.text((4, 4), lab, fill="black", font=font)
    x = 0
    for k, im in enumerate(row):
        tile.paste(im, (x, 28)); 
        if k >= len(ims): dr.rectangle([x, 28, x + im.width - 1, 28 + im.height - 1], outline="red", width=4)
        x += im.width + 10
    tiles.append(tile)
cols = 2
colw = max(t.width for t in tiles)
rows = [tiles[i:i + cols] for i in range(0, len(tiles), cols)]
H = sum(max(t.height for t in r) for r in rows)
out = Image.new("RGB", (colw * cols, H), "#ddd"); y = 0
for r in rows:
    for k, t in enumerate(r): out.paste(t, (k * colw, y))
    y += max(t.height for t in r)
os.makedirs("build/osce2/peek", exist_ok=True)
p = f"build/osce2/peek/{subj}-{a}.png"; out.save(p); print(p, out.size)
