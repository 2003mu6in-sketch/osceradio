"""Step 1: per-page layout stream (text lines + image boxes), top-origin PDF points.

Text lines come from poppler `pdftotext -bbox-layout`; image placements from pdfium.
Tiny images (header logos, text rendered as image strips) are kept but flagged so
later steps can ignore them. Adjacent image fragments are merged into one box.
"""
import json, subprocess, sys, re
import xml.etree.ElementTree as ET
import pypdfium2 as pdfium
import pypdfium2.raw as raw

SRC = sys.argv[1] if len(sys.argv) > 1 else "build/source.pdf"
OUT = "build/layout.json"

MIN_W, MIN_H = 60, 45          # points; smaller images are decoration / text strips
MERGE_GAP = 4                  # merge boxes whose edges are within this many points


def text_lines():
    xml = subprocess.run(["pdftotext", "-bbox-layout", SRC, "-"], capture_output=True, text=True).stdout
    xml = re.sub(r'\sxmlns="[^"]+"', "", xml, count=1)
    root = ET.fromstring(xml)
    pages = []
    for page in root.iter("page"):
        lines = []
        for line in page.iter("line"):
            words = [w.text or "" for w in line.iter("word")]
            t = " ".join(words).strip()
            if not t:
                continue
            lines.append({"type": "line", "text": t,
                          "x0": float(line.get("xMin")), "y0": float(line.get("yMin")),
                          "x1": float(line.get("xMax")), "y1": float(line.get("yMax"))})
        pages.append(lines)
    return pages


def merge(boxes):
    boxes = [list(b) for b in boxes]
    changed = True
    while changed:
        changed = False
        for i in range(len(boxes)):
            for j in range(i + 1, len(boxes)):
                a, b = boxes[i], boxes[j]
                if (a[0] - MERGE_GAP <= b[2] and b[0] - MERGE_GAP <= a[2] and
                        a[1] - MERGE_GAP <= b[3] and b[1] - MERGE_GAP <= a[3]):
                    boxes[i] = [min(a[0], b[0]), min(a[1], b[1]), max(a[2], b[2]), max(a[3], b[3])]
                    boxes.pop(j)
                    changed = True
                    break
            if changed:
                break
    return boxes


def images():
    pdf = pdfium.PdfDocument(SRC)
    out = []
    for p in pdf:
        H = p.get_size()[1]
        boxes = []
        for o in p.get_objects(filter=[raw.FPDF_PAGEOBJ_IMAGE], max_depth=5):
            l, b, r, t = o.get_bounds()
            boxes.append((l, H - t, r, H - b))
        out.append(merge(boxes))
    return out


def main():
    tl = text_lines()
    im = images()
    assert len(tl) == len(im), (len(tl), len(im))
    pages = []
    for i, (lines, boxes) in enumerate(zip(tl, im)):
        items = list(lines)
        for b in boxes:
            w, h = b[2] - b[0], b[3] - b[1]
            items.append({"type": "img", "x0": b[0], "y0": b[1], "x1": b[2], "y1": b[3],
                          "small": w < MIN_W or h < MIN_H or b[1] < 40})
        items.sort(key=lambda it: (round(it["y0"] / 3), it["x0"]))
        pages.append({"page": i + 1, "items": items})
    json.dump(pages, open(OUT, "w"), indent=1)
    n = sum(1 for p in pages for it in p["items"] if it["type"] == "img" and not it["small"])
    print(f"{len(pages)} pages, {n} content images -> {OUT}")


if __name__ == "__main__":
    main()
