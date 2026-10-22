"""Suggest crop fractions for the radiograph inside a projector photo of a slide:
largest connected region that is NOT bright slide background."""
import sys, cv2, numpy as np
from PIL import Image
for iid in sys.argv[1:]:
    rgb = np.array(Image.open(f"content/img/{iid}.webp").convert("RGB")).astype(int)
    h, w, _ = rgb.shape
    g = rgb.mean(2)
    bg = np.median(g[g > np.percentile(g, 40)])          # slide background brightness
    m = (g < bg - 28).astype(np.uint8) * 255
    m = cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((9, 9), np.uint8))
    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((31, 31), np.uint8))
    n, lab, st, _ = cv2.connectedComponentsWithStats(m)
    cand = [i for i in range(1, n) if st[i, 4] > 0.03 * h * w]
    if not cand:
        print(f"  {iid}: none"); continue
    # prefer the most rectangular big blob (fill ratio) – text blocks are sparse
    i = max(cand, key=lambda i: st[i, 4] * (st[i, 4] / (st[i, 2] * st[i, 3])) ** 2)
    x, y, bw, bh = st[i, :4]
    pad = 4
    f = [max(0, (x - pad) / w), max(0, (y - pad) / h), min(1, (x + bw + pad) / w), min(1, (y + bh + pad) / h)]
    print(f"  {iid}: {{crop: [{', '.join(f'{v:.3f}' for v in f)}]}}")
