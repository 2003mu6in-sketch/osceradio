"""Phase V2-3 step 3: read hand transcriptions (pipeline/photos/transcripts/*.txt) and validate them.

Usage: 03_transcripts.py [file …]  -> prints a check per file; build step imports parse_file().
"""
import os, re, sys, glob
HERE = os.path.dirname(os.path.abspath(__file__))
TDIR = os.path.join(HERE, "transcripts")

Q_RE = re.compile(r"^(\d{1,3}b?)\.\s+(.*)$")
OPT_RE = re.compile(r"^(\*?)([A-H])\.\s+(.*)$")
PHOTO_RE = re.compile(r"^\[photo\s+p(\d+)\s+([LRF])\s+([\d.]+)-([\d.]+)\]$")
IMG_RE = re.compile(r"^!img\s+p(\d+)\s+([LRF])\s+([\d.]+)-([\d.]+)$")


def parse_file(path):
    qs, cur, page, lead = [], None, None, None
    for raw in open(path, encoding="utf-8"):
        line = raw.rstrip("\n").strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("@page"):
            page = int(line.split()[1]); continue
        if line.startswith("@lead "):
            lead = line[6:].strip().replace("\\n", "\n"); continue
        if line.startswith("@endlead"):
            lead = None; continue
        m = Q_RE.match(line)
        if m:
            cur = dict(n=int(m.group(1).rstrip("b")), suffix="b" if m.group(1).endswith("b") else "", stem=m.group(2).strip(), options=[], pages=[page], images=[], photo=None, lead=lead)
            pm = PHOTO_RE.match(cur["stem"])
            if pm:
                cur["stem"] = None
                cur["photo"] = dict(page=int(pm.group(1)), col=pm.group(2), top=float(pm.group(3)), bottom=float(pm.group(4)))
            qs.append(cur); continue
        if cur is None:
            raise SystemExit(f"{path}: text before first question: {line[:60]}")
        if page not in cur["pages"]:
            cur["pages"].append(page)
        im = IMG_RE.match(line)
        if im:
            cur["images"].append(dict(page=int(im.group(1)), col=im.group(2), top=float(im.group(3)), bottom=float(im.group(4))))
            continue
        pm = PHOTO_RE.match(line)
        if pm:   # continuation of a photo question onto another page
            cur.setdefault("photoMore", []).append(dict(page=int(pm.group(1)), col=pm.group(2), top=float(pm.group(3)), bottom=float(pm.group(4))))
            continue
        om = OPT_RE.match(line)
        if om and om.group(2) == chr(65 + len(cur["options"])):
            cur["options"].append(dict(key=om.group(2), text=om.group(3).strip()))
            if om.group(1): cur.setdefault("marked", []).append(om.group(2))
            continue
        if cur["options"]:
            cur["options"][-1]["text"] += " " + line
        elif cur["stem"] is not None:
            cur["stem"] += " " + line
        else:
            raise SystemExit(f"{path}: text after a photo question: {line[:60]}")
    return qs


def check(path):
    qs = parse_file(path)
    issues = []
    seen = set()
    for q in qs:
        if (q["n"], q["suffix"]) in seen: issues.append(f"Q{q['n']} duplicated")
        seen.add((q["n"], q["suffix"]))
        if q["photo"] is None and len(q["options"]) < 2: issues.append(f"Q{q['n']} has {len(q['options'])} options")
    nums = sorted({n for n, _ in seen}); seen = set(nums)
    gaps = sorted(set(range(nums[0], nums[-1] + 1)) - seen) if nums else []
    photos = sum(1 for q in qs if q["photo"])
    print(f"{os.path.basename(path)}: {len(qs)} questions ({nums[0] if nums else '-'}–{nums[-1] if nums else '-'}), "
          f"{photos} as photo; gaps {gaps}; {'; '.join(issues) or 'ok'}")
    return qs


if __name__ == "__main__":
    for p in sys.argv[1:] or sorted(glob.glob(os.path.join(TDIR, "*.txt"))):
        check(p)
