"""Convert a box seen on a contact sheet into crop fractions of the image.
usage: COLS TW TH PER env as used for the sheet; args: sheet_index_in_section cardpos x0 y0 x1 y1 iid"""
import os, sys
from PIL import Image
cols, tw, th = int(os.environ.get("COLS", 3)), int(os.environ.get("TW", 420)), int(os.environ.get("TH", 320))
pos, x0, y0, x1, y1 = map(int, sys.argv[1:6]); iid = sys.argv[6]; n = int(sys.argv[7]) if len(sys.argv) > 7 else 1
k = int(sys.argv[8]) if len(sys.argv) > 8 else 0
im = Image.open(f"content/img/{iid}.webp"); w, h = im.size
cw = (tw - 8) // n
s = min((cw - 4) / w, (th - 4) / h); dw, dh = w * s, h * s
ox, oy = (pos % cols) * tw + 4 + k * cw, (pos // cols) * (th + 26) + 26
f = [max(0, (x0 - ox) / dw), max(0, (y0 - oy) / dh), min(1, (x1 - ox) / dw), min(1, (y1 - oy) / dh)]
print(f"  {iid}: {{crop: [{', '.join(f'{v:.3f}' for v in f)}]}}")
