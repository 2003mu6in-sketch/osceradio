"""Phase V2-3 step 0: crop the photographed exam pages, upright, from rendered PDF pages (220 dpi).
Output: build/photos/<subject>/p<NNN>.png"""
import os, subprocess, sys
import pypdfium2 as pdfium, pypdfium2.raw as R
from PIL import Image
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(os.path.dirname(HERE))
SPEC = {"radiology": ("RADIOLOGY_MCQs_UPDATED_2025", [39, 40] + list(range(57, 69))),
        "anaesthesia": ("ANAESTHESIA_MCQs", list(range(1, 10)) + list(range(70, 82))),
        "ent": ("ENT_MCQs", list(range(1, 9)) + [10, 11] + list(range(48, 70))),
        "ophthalmology": ("OPHTHALMOLOGY_MCQs", list(range(1, 10)) + list(range(51, 71)))}
DPI = 220
def main(subj):
    f, pages = SPEC[subj]
    pdf = pdfium.PdfDocument(os.path.join(ROOT, "sources", f + ".pdf"))
    d = os.path.join(ROOT, "build", "photos", subj); os.makedirs(d, exist_ok=True)
    for p in pages:
        page = pdf[p - 1]; H = page.get_height()
        boxes = []
        for o in page.get_objects(filter=[R.FPDF_PAGEOBJ_IMAGE], max_depth=5):
            l, b, r, t = o.get_bounds(); boxes.append(((r - l) * (t - b), l, H - t, r, H - b))
        _, l, t, r, b = max(boxes)
        bmp = page.render(scale=DPI / 72).to_pil()
        s = DPI / 72
        bmp.crop((int(l * s), int(t * s), int(r * s), int(b * s))).convert("RGB").save(os.path.join(d, f"p{p:03d}.png"))
    print(subj, len(pages))
if __name__ == "__main__":
    for s in sys.argv[1:] or SPEC: main(s)
