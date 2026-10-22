"""Parse typed MCQ papers into draft questions.

Input : build/mcq/<file>.layout.json, pipeline/mcq/segments.yaml
Output: build/mcq/<subject>.draft.json  {questions:[...], keys:{paper:{n:letter}}, flags:[...]}
"""
import json, os, re, sys
import yaml

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
BUILD = os.path.join(ROOT, "build", "mcq")
CFG = yaml.safe_load(open(os.path.join(HERE, "segments.yaml")))

Q_RE = re.compile(r"^(\d{1,3})\s*[.)]\s*(.*)$")
OPT_RE = re.compile(r"^\(?([A-Ha-h])\s*[.)]\s*(.*)$")
OPT_NODOT_RE = re.compile(r"^(?:([A-E])\s+(\S.*)|([a-e])\s+([A-Z0-9(].*))$")
KEY_RE = re.compile(r"(\d{1,3})\s*\.\s*([A-Ea-e]|-{2,}|—+)")
NOTE_START = re.compile(r"^(NOTE|Note|Info|INFO|Explanation|Rationale|Ans|ANS|Answer|ANSWER)\b\s*[:\-]?", re.I)
LEADIN_RE = re.compile(r"(use the following|answer questions?|questions? \d+\s*(and|to|-|–)\s*\d+)", re.I)


def rows_of(page):
    """Merge layout lines that share a baseline into rows (sorted top→bottom, left→right)."""
    lines = sorted(page["lines"], key=lambda l: (l["y0"], l["x0"]))
    rows = []
    for l in lines:
        placed = False
        for r in rows[-3:]:
            a0, a1 = r["y0"], r["y1"]
            ov = min(a1, l["y1"]) - max(a0, l["y0"])
            if ov >= 0.5 * min(a1 - a0, l["y1"] - l["y0"]):
                r["parts"].append(l); r["y0"] = min(a0, l["y0"]); r["y1"] = max(a1, l["y1"]); placed = True; break
        if not placed:
            rows.append(dict(y0=l["y0"], y1=l["y1"], parts=[l]))
    out = []
    for r in sorted(rows, key=lambda r: r["y0"]):
        ps = sorted(r["parts"], key=lambda p: p["x0"])
        text = re.sub(r"\s+", " ", " ".join(p["text"] for p in ps)).strip()
        n = sum(len(p["text"]) for p in ps) or 1
        def share(key, val):
            return sum(len(p["text"]) for p in ps if p[key] == val) / n
        hl = None
        for k in ("yellow", "green", "cyan", "magenta"):
            if share("hl", k) >= 0.5: hl = k; break
        # a highlighted option letter with an unhighlighted text part still counts
        if not hl and ps[0]["hl"] and OPT_RE.match(ps[0]["text"].strip() + " x"):
            hl = ps[0]["hl"]
        col = max(("black", "red", "blue", "other"), key=lambda c: share("color", c))
        out.append(dict(page=page["n"], x0=ps[0]["x0"], y0=r["y0"], text=text, hl=hl, color=col))
    return out


def norm_letter(c):
    return c.upper()


class Parser:
    def __init__(self, subject, cfg):
        self.subject, self.cfg = subject, cfg
        self.questions, self.flags, self.keys = [], [], {}

    def flag(self, q, msg):
        self.flags.append(dict(id=q["id"] if q else None, page=q["page"] if q else None, msg=msg))

    def new_q(self, seg, sub, num, text, row):
        paper = seg["paper"] + (f" {sub}" if sub else "")
        q = dict(subject=self.subject, paper=paper, qNumber=num, page=row["page"],
                 stem=text.strip(), options=[], correct=[], alt=[], notes=[], leadIn=None,
                 ansText=[], _mode="stem")
        slug = re.sub(r"[^A-Za-z0-9]+", "", paper.replace("Bank", "B").replace("Part", "P").replace("Misc", "M").replace("SET", "S"))
        q["id"] = f"{self.cfg['code']}-MCQ-{slug}-{num:03d}"
        self.questions.append(q)
        return q

    def run(self, layout):
        pages = {p["n"]: p for p in layout["pages"]}
        segs = self.cfg["segments"]
        allrows = [r for n in sorted(pages) for r in rows_of(pages[n])]
        # locate segment starts
        starts = []
        for s in segs:
            idx = next((i for i, r in enumerate(allrows) if r["page"] == s["page"] and re.search(s["start"], r["text"])), None)
            if idx is None:
                raise SystemExit(f"{self.subject}: segment start not found: {s}")
            starts.append(idx)
        starts.append(len(allrows))
        for si, s in enumerate(segs):
            rows = allrows[starts[si] + 1: starts[si + 1]]
            self.keys.setdefault(s["paper"], {})
            self.parse_segment(s, rows)
        for q in self.questions:
            self.finish(q)
        return self

    def parse_segment(self, seg, rows):
        q, last, sub, pending_lead = None, 0, None, None
        sub_re = re.compile(seg["sub"]) if seg.get("sub") else None
        for r in rows:
            t = r["text"]
            # answer-key grids
            km = KEY_RE.findall(t)
            if len(km) >= 3 and len(re.sub(r"[\d.\sA-Ea-e\-—()I,]", "", t)) < 4:
                for n, a in km:
                    self.keys[seg["paper"]][int(n)] = None if "-" in a or "—" in a else a.upper()
                continue
            if seg["kind"] != "typed":
                continue
            if re.fullmatch(r"\d{1,3}", t):        # page numbers
                continue
            if (sub_re and sub_re.match(t)) or (seg.get("subColor") and r["color"] == seg["subColor"] and not OPT_RE.match(t)):
                if sub_re:
                    sub = t.strip(); last = 0; q = None
                else:   # topic headings: numbering continues
                    self.topic = t.rstrip(":").strip().title()
                    if q: q["_mode"] = "done"
                continue
            m = Q_RE.match(t)
            if m:
                num = int(m.group(1))
                ok = (num == last + 1) or (last == 0 and num <= 3) or (0 < num - last <= 3 and q and q["options"])
                if num == 1 and last > 5 and q and q["options"]:
                    ok = True   # numbering restart without a heading
                if not ok and num == last and q and len(q["options"]) >= 2 and len(m.group(2)) > 15:
                    num = last + 1; ok = True   # repeated number in source
                    self.flags.append(dict(id=None, page=r["page"], msg=f"renumbered duplicate '{t[:40]}' as {num}"))
                if ok:
                    q = self.new_q(seg, sub if sub_re else None, num, m.group(2), r)
                    if getattr(self, "topic", None) and seg.get("subColor"):
                        q["topic"] = self.topic
                    if pending_lead:
                        q["leadIn"] = pending_lead
                        if not pending_lead.get("_range") or num >= pending_lead["_range"][1]:
                            pending_lead = None
                    last = num
                    continue
            if q is None and sub_re and last == 0 and not OPT_RE.match(t) and len(t) > 15:
                q = self.new_q(seg, sub, 1, t, r); last = 1
                self.flag(q, "unnumbered first question after heading")
                continue
            if q is None:
                continue
            om = OPT_RE.match(t)
            expect = chr(ord("A") + len(q["options"]))
            if not om and q["_mode"] in ("stem", "opts") and expect <= "H":
                om2 = OPT_NODOT_RE.match(t)
                if om2:
                    let, body = (om2.group(1), om2.group(2)) if om2.group(1) else (om2.group(3), om2.group(4))
                    if let.upper() == expect:
                        q["options"].append(dict(key=expect, text=body.strip(), hl=r["hl"], color=r["color"]))
                        q["_mode"] = "opts"
                        continue
            if om and q["_mode"] != "note" and norm_letter(om.group(1)) == expect:
                q["options"].append(dict(key=expect, text=om.group(2).strip(), hl=r["hl"], color=r["color"]))
                q["_mode"] = "opts"
                continue
            if om and q["_mode"] == "opts" and norm_letter(om.group(1)) != expect and expect <= "H":
                got = norm_letter(om.group(1))
                if got != "A" and abs(ord(got) - ord(expect)) <= 2:
                    q["options"].append(dict(key=expect, text=om.group(2).strip(), hl=r["hl"], color=r["color"]))
                    self.flag(q, f"option letter {got} relabelled {expect} (source typo)")
                    continue
                self.flag(q, f"option letter out of order: '{t[:60]}' (expected {expect})")
            # notes
            if q["_mode"] == "opts" and t.startswith("(") and t.rstrip(". ").endswith(")"):
                q["notes"].append(t.strip()); q["_mode"] = "note"
                continue
            if NOTE_START.match(t) or (r["color"] == "red" and q["_mode"] in ("opts", "note")):
                if re.match(r"^(Ans|ANS|Answer|ANSWER)\b", t) and not q["options"]:
                    q["ansText"].append(NOTE_START.sub("", t).strip())
                    q["_mode"] = "ans"
                else:
                    body = NOTE_START.sub("", t).strip() if NOTE_START.match(t) and len(t.split()) <= 2 else t
                    if body: q["notes"].append(body)
                    q["_mode"] = "note"
                continue
            if q["_mode"] in ("opts", "note") and re.match(r"^(A|An)\s+\d+[\s-]*(yr|year|month|week|day)", t):
                pending_lead = dict(text=t, _range=None)   # scenario for the next question
                q["_mode"] = "lead"
                continue
            if LEADIN_RE.search(t) and q["_mode"] in ("opts", "note"):
                rng = re.search(r"(\d+)\s*(?:and|to|-|–|&)\s*(\d+)", t)
                pending_lead = dict(text=t, _range=(int(rng.group(1)), int(rng.group(2))) if rng else None)
                q["_mode"] = "lead"
                continue
            if q["_mode"] == "lead" and pending_lead:
                pending_lead["text"] += "\n" + t
                continue
            if q["_mode"] == "stem":
                q["stem"] += ("\n" if q["stem"] else "") + t
            elif q["_mode"] == "opts":
                o = q["options"][-1]
                o["text"] += " " + t
                if r["hl"] and not o["hl"]:
                    o["hl"] = r["hl"]
            elif q["_mode"] in ("note",):
                q["notes"].append(t)
            elif q["_mode"] == "ans":
                q["ansText"].append(t)

    def finish(self, q):
        q.pop("_mode", None)
        if q["leadIn"]:
            q["leadIn"] = q["leadIn"]["text"]
        q["stem"] = re.sub(r"[ \t]+", " ", q["stem"]).strip()
        hls = [o for o in q["options"] if o["hl"] in ("yellow", "green", "magenta")]
        cy = [o for o in q["options"] if o["hl"] == "cyan"]
        reds = [o for o in q["options"] if o["color"] == "red"]
        if hls:
            q["correct"] = [o["key"] for o in hls]
            q["alt"] = [o["key"] for o in cy]
            q["answerFrom"] = "highlight"
        elif cy:
            q["correct"] = [o["key"] for o in cy]
            q["answerFrom"] = "highlight-cyan"
        elif reds and len(reds) < len(q["options"]):
            q["correct"] = [o["key"] for o in reds]
            q["answerFrom"] = "red-text"
        else:
            q["answerFrom"] = None
        for o in q["options"]:
            o.pop("hl", None); o.pop("color", None)
            o["text"] = re.sub(r"\s+", " ", o["text"]).strip()
        if not q["options"]:
            q["type"] = "recall" if q["ansText"] else "no-options"
        else:
            q["type"] = "mcq"
        if q["type"] == "mcq" and not q["correct"]:
            self.flag(q, "no answer marked")
        if q["type"] == "mcq" and len(q["options"]) < 3:
            self.flag(q, f"only {len(q['options'])} options")
        if len(q["correct"]) > 1:
            self.flag(q, f"several answers marked: {q['correct']}")
        if q["type"] == "no-options":
            self.flag(q, "no options and no answer")
        if not q["stem"]:
            self.flag(q, "empty stem")
        for o in q["options"]:
            if len(o["text"]) > 220:
                self.flag(q, f"long option {o['key']} ({len(o['text'])} chars) – explanation merged in?")


def main(subjects):
    summary = []
    for subj in subjects:
        cfg = CFG[subj]
        layout = json.load(open(os.path.join(BUILD, cfg["file"] + ".layout.json")))
        p = Parser(subj, cfg).run(layout)
        # duplicate ids (e.g. repeated numbering)
        seen = {}
        for q in p.questions:
            if q["id"] in seen:
                seen[q["id"]] += 1
                q["id"] += chr(ord("a") + seen[q["id"]] - 1)
                p.flag(q, "duplicate question number in paper")
            else:
                seen[q["id"]] = 1
        json.dump(dict(subject=subj, questions=p.questions, keys=p.keys, flags=p.flags),
                  open(os.path.join(BUILD, f"{subj}.draft.json"), "w"), ensure_ascii=False, indent=1)
        from collections import Counter
        per = Counter(q["paper"].split(" Set")[0] for q in p.questions)
        types = Counter(q["type"] for q in p.questions)
        summary.append(f"{subj}: {len(p.questions)} questions {dict(types)}, {len(p.flags)} flags\n   " +
                       ", ".join(f"{k}:{v}" for k, v in per.items()) +
                       "\n   keys: " + ", ".join(f"{k}:{len(v)}" for k, v in p.keys.items() if v))
    print("\n".join(summary))


if __name__ == "__main__":
    main(sys.argv[1:] or list(CFG))
