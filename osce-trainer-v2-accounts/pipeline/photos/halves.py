"""Debug: split a page photo into left/right halves (with overlap) for reading. usage: halves.py SUBJ PAGE [split]"""
import sys
from PIL import Image
s, p = sys.argv[1], int(sys.argv[2]); sp = float(sys.argv[3]) if len(sys.argv) > 3 else 0.5
im = Image.open(f"build/photos/{s}/p{p:03d}.png"); W, H = im.size
L = im.crop((0, 0, int(W * (sp + 0.04)), H)); R = im.crop((int(W * (sp - 0.04)), 0, W, H))
out = Image.new("RGB", (L.width + R.width + 20, H), "white"); out.paste(L, (0, 0)); out.paste(R, (L.width + 20, 0))
out.save("build/photos/view.png"); print(out.size)
