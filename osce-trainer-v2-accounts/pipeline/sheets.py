"""Contact sheets for visual QA: build/sheets/<SEC>-<n>.png"""
import json, os, sys
from PIL import Image, ImageDraw, ImageFont
d = json.load(open(sys.argv[1] if len(sys.argv) > 1 else "build/cards_draft.json"))
secs = sys.argv[2].split(",") if len(sys.argv) > 2 else None
cols, tw, th, per = int(os.environ.get("COLS", 3)), int(os.environ.get("TW", 420)), int(os.environ.get("TH", 320)), int(os.environ.get("PER", 12))
os.makedirs("build/sheets", exist_ok=True)
font = ImageFont.load_default(size=18)
by = {}
for c in d["cards"]:
    if c["images"] and (not secs or c["section"] in secs):
        by.setdefault(c["section"], []).append(c)
for sec, cards in by.items():
    for s in range(0, len(cards), per):
        chunk = cards[s:s + per]
        rows = (len(chunk) + cols - 1) // cols
        sheet = Image.new("RGB", (cols * tw, rows * (th + 26)), "white")
        dr = ImageDraw.Draw(sheet)
        for k, c in enumerate(chunk):
            x, y = (k % cols) * tw, (k // cols) * (th + 26)
            dr.text((x + 4, y + 3), c["id"], fill="red", font=font)
            ims = [Image.open(f"content/img/{i}.webp") for i in dict.fromkeys(c["images"])]
            w = (tw - 8) // len(ims)
            for j, im in enumerate(ims):
                im.thumbnail((w - 4, th - 4))
                sheet.paste(im, (x + 4 + j * w, y + 26))
        sheet.save(f"build/sheets/{sec}-{s // per + 1:02d}.png")
print(sorted(os.listdir("build/sheets")))
