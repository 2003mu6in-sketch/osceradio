"""Phase V2-3 step 2: OCR lines -> draft questions with bounding boxes and a quality score.

Output: build/photos/<subject>.draft.json
  {papers: {paper: {pages:[...], questions:[{n, page, col, box:[x0,y0,x1,y1], stem, options:[{key,text}], lines:[...], score, issues:[...]}]}}}
A question can span columns/pages; `parts` lists each (page, col, box) piece for cropping.
"""
import json, os, re, sys
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(os.path.dirname(HERE))
PB = os.path.join(ROOT, "build", "photos")

PAPERS = {
    "radiology": [("2023 photos", [39, 40]), ("2020", list(range(57, 69)))],
    "anaesthesia": [("2025", list(range(1, 10))), ("2016", list(range(70, 82)))],
    "ent": [("2025", list(range(1, 9))), ("2023", [10, 11]), ("2016", list(range(48, 70)))],
    "ophthalmology": [("2025", list(range(1, 10))), ("2018 & 2016", list(range(51, 71)))],
}
JUNK = "‘’'\"`•·~«»|_—–-*°^,.:;"
Q_RE = re.compile(r"^(\d{1,3})\s*[.,)]\s*(\S.*)$")
OPT_RE = re.compile(r"^\(?([A-Ea-e])\s*[.,)]\s*(\S.*)$")
OPT_LOOSE = re.compile(r"^\(?([A-Ea-e])\s+([A-Z0-9(].*)$")


def norm_line(t):
    t = t.strip()
    while t and t[0] in JUNK and not re.match(r"^[-–]\s*\d", t):
        t = t[1:].lstrip()
    return t


def words_ok(t):
    w = re.findall(r"[A-Za-z]{2,}", t)
    junk = len(re.findall(r"[^\w\s.,;:()'’/%+\-?=<>]", t))
    return len(w), junk


def parse(subj):
    out = {}
    for paper, pages in PAPERS[subj]:
        stream = []
        for p in pages:
            path = os.path.join(PB, subj, f"p{p:03d}.ocr.json")
            d = json.load(open(path))
            for ci, c in enumerate(d["cols"]):
                for l in c["lines"]:
                    stream.append(dict(l, page=p, col=ci, text=norm_line(l["text"]), raw=l["text"]))
        qs, cur, last = [], None, 0
        for l in stream:
            t = l["text"]
            if not t: continue
            m = Q_RE.match(t)
            if m:
                n = int(m.group(1))
                if (last == 0 and n <= 60) or 0 < n - last <= 25:
                    cur = dict(n=n, stemLines=[m.group(2)], options=[], parts=[], lines=[l["raw"]], conf=[l["conf"]])
                    cur["parts"].append([l["page"], l["col"], l["x0"], l["y0"], l["x1"], l["y1"]])
                    qs.append(cur); last = n
                    continue
            if cur is None: continue
            # extend the box of the current piece, or start a new piece on a new column/page
            pc = cur["parts"][-1]
            if pc[0] == l["page"] and pc[1] == l["col"]:
                pc[2] = min(pc[2], l["x0"]); pc[4] = max(pc[4], l["x1"]); pc[5] = max(pc[5], l["y1"])
            else:
                cur["parts"].append([l["page"], l["col"], l["x0"], l["y0"], l["x1"], l["y1"]])
            cur["lines"].append(l["raw"]); cur["conf"].append(l["conf"])
            expect = chr(65 + len(cur["options"]))
            om = OPT_RE.match(t) or OPT_LOOSE.match(t)
            if om and om.group(1).upper() == expect:
                cur["options"].append(dict(key=expect, text=om.group(2).strip()))
            elif cur["options"]:
                cur["options"][-1]["text"] += " " + t
            else:
                cur["stemLines"].append(t)
        for q in qs:
            q["stem"] = " ".join(q.pop("stemLines"))
            issues = []
            if len(q["options"]) < 4: issues.append(f"{len(q['options'])} options")
            texts = [q["stem"]] + [o["text"] for o in q["options"]]
            for t in texts:
                w, j = words_ok(t)
                if j >= 2: issues.append(f"odd characters: {t[:30]}"); break
            if any(len(o["text"]) > 150 for o in q["options"]): issues.append("long option")
            mc = sum(q["conf"]) / len(q["conf"])
            if mc < 75: issues.append(f"low OCR confidence {mc:.0f}")
            q["score"] = round(mc - 15 * len(issues), 1)
            q["issues"] = issues
            del q["conf"]
        nums = [q["n"] for q in qs]
        out[paper] = dict(pages=pages, questions=qs,
                          missing=sorted(set(range(1, max(nums) + 1)) - set(nums)) if nums else [])
        clean = sum(1 for q in qs if not q["issues"])
        print(f"{subj} {paper}: {len(qs)} questions ({min(nums) if nums else '-'}–{max(nums) if nums else '-'}), "
              f"{clean} without issues; missing numbers {out[paper]['missing'][:30]}")
    json.dump(dict(papers=out), open(os.path.join(PB, f"{subj}.draft.json"), "w"), ensure_ascii=False, indent=0)


if __name__ == "__main__":
    for s in sys.argv[1:] or PAPERS: parse(s)
