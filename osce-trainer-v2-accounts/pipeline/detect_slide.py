"""Suggest crop fractions for the bright 'slide' rectangle inside a screenshot/photo.
usage: python3 pipeline/detect_slide.py p72-1 p73-1 ...  -> prints yaml lines"""
import sys, cv2, numpy as np
from PIL import Image
for iid in sys.argv[1:]:
    g = np.array(Image.open(f"content/img/{iid}.webp").convert("L"))
    h, w = g.shape
    m = (g > 185).astype(np.uint8) * 255
    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((25, 25), np.uint8))
    cs, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    x, y, bw, bh = cv2.boundingRect(max(cs, key=cv2.contourArea))
    f = [round(x / w, 3), round(y / h, 3), round((x + bw) / w, 3), round((y + bh) / h, 3)]
    print(f"  {iid}: {{crop: {f}}}   # area {bw*bh/(w*h):.2f}")
