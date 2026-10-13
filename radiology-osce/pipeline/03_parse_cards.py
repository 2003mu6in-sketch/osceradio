"""Step 3: layout stream -> draft cards (build/cards_draft.json).

Each card: id, section, qNumber, picture, images[], prompts[], answerLines[],
diagnosis, refs[] (raw cross-reference strings), flags[] (things QA must look at).
"""
import json, re

pages = json.load(open("build/layout.json"))

# (section id, display name, first page, last page, numbered questions?)
SECTIONS = [
    ("70W", "70 Ways to Akorli Kingdom", 1, 70, True),
    ("30R", "30 Roads to Akorli Kingdom", 71, 100, True),
    ("2025", "2025 OSCE", 101, 107, True),
    ("TIPS", "Dr. Akorli Final OSCE Tips 2025", 108, 144, False),
    ("2023", "2023 OSCE", 145, 148, True),
    ("2021", "2021 OSCE", 149, 158, True),
    ("2019", "2019 OSCE", 159, 189, True),
    ("2018", "2018 OSCE", 190, 205, True),
    ("2017", "2017 OSCE", 206, 217, True),
    ("2016", "2016 OSCE", 218, 226, True),
    ("2015", "2015 OSCE", 227, 238, True),
    ("2014", "2014 OSCE", 239, 249, True),
]

RE_Q = re.compile(r"^QUESTION\s+(\d+)\s*:?\s*$", re.I)
RE_ANSWER = re.compile(r"^ANSWER\s*:?\s*$", re.I)
RE_REF = re.compile(r"^\(?\s*(\d{4}\s*OSCE\s*,?\s*Q\s*\d+|(30 ROADS|70 WAYS) TO AKORLI KINGDOM.*|SIMILAR QUESTION.*)\)?\s*:?\s*$", re.I)
RE_LABEL = re.compile(r"^(PICTURE\s*\d|IMAGE\s*\(?[ivx]+\)?|\(?[ivx]+\)|\d)$", re.I)
RE_HEADING = re.compile(r"^(\d+\.\s+[A-Z][A-Z ]+:|\d{4} OSCE QUESTIONS|DR\. AKORLI FINAL OSCE TIPS RADIOLOGY|2025|LOOK OUT FOR.*|Akorli Kingdom, slide \d+)$")
RE_PIC_HDR = re.compile(r"^PICTURES?\s+(\d+)(?:\s*(?:and|&|AND)\s*(\d+))?\s*:\s*(.*)$", re.I)
RE_DX = re.compile(r"^(?:\(?[\divx]+\)?[.)]?\s*)?(?:\([a-z]\)\s*)?(?:Possible\s+|Most likely\s+)?(?:Dx|Diagnosis|Diagonosis)\b[^:\-]*?(?:\(Dx\))?\s*[:\-]\s*(.+)$", re.I)
QWORDS = re.compile(r"^(?:\(?[\da-e]+[.)]\s*)?(what|which|identify|describe|give|state|name|list|mention|write|where|how|suggest|about)\b", re.I)


def norm(t):
    return re.sub(r"\s+", " ", t.replace("’", "'").replace("“", '"').replace("”", '"')).strip()


def units_for(sec, start, end, numbered):
    units, cur = [], None
    for p in pages:
        if not (start <= p["page"] <= end):
            continue
        for it in p["items"]:
            it = dict(it, page=p["page"])
            if it["type"] == "img":
                if it["small"]:
                    continue
                if not numbered:
                    # tips: new unit per image unless side-by-side with the previous image
                    prev_img = cur and next((x for x in reversed(cur["items"]) if x["type"] == "img"), None)
                    side_by_side = prev_img and prev_img["page"] == it["page"] and abs(prev_img["y0"] - it["y0"]) < 15
                    has_text_after = cur and cur["items"] and cur["items"][-1]["type"] == "line"
                    if cur is None or (not side_by_side and has_text_after):
                        carry = []
                        if cur:   # trailing refs / headings belong to the next unit
                            while cur["items"] and cur["items"][-1]["type"] == "line" and (
                                    RE_REF.match(cur["items"][-1]["text"]) or RE_HEADING.match(cur["items"][-1]["text"])):
                                carry.insert(0, cur["items"].pop())
                        cur = {"num": None, "items": carry}
                        units.append(cur)
                if cur is None:
                    continue          # cover image before the first QUESTION
                cur["items"].append(it)
                continue
            text = norm(it["text"])
            if not text:
                continue
            m = RE_Q.match(text)
            if numbered and m:
                cur = {"num": int(m.group(1)), "items": []}
                units.append(cur)
                continue
            if cur is None:
                if numbered:
                    continue          # preamble before the first QUESTION (contributors, titles)
                cur = {"num": None, "items": []}
                units.append(cur)
            it["text"] = text
            cur["items"].append(it)
    return units


def label_map(items):
    """Map picture labels under images -> image ids, by x overlap and vertical proximity."""
    imgs = [x for x in items if x["type"] == "img"]
    out = {}
    for ln in items:
        if ln["type"] != "line" or not RE_LABEL.match(ln["text"]):
            continue
        cx = (ln["x0"] + ln["x1"]) / 2
        cands = [im for im in imgs if im["page"] == ln["page"] and im["x0"] - 20 <= cx <= im["x1"] + 20
                 and -10 <= ln["y0"] - im["y1"] <= 60]
        if cands:
            im = min(cands, key=lambda im: ln["y0"] - im["y1"])
            key = re.sub(r"\D", "", ln["text"]) or {"i": "1", "ii": "2", "iii": "3"}.get(
                re.sub(r"[^ivx]", "", ln["text"].lower()), ln["text"])
            out[key] = im["id"]
    return out


def find_dx(prompts, answer):
    for ln in answer:
        m = RE_DX.match(ln)
        if m and len(m.group(1)) > 2:
            return m.group(1).strip()
    # numbered answer matching a "diagnosis" prompt
    for pr in prompts:
        if re.search(r"diagnosis\b|impression", pr, re.I) and not re.search(r"differential|other", pr, re.I):
            num = re.match(r"^\(?([\da-e])", pr)
            if num:
                for i, ln in enumerate(answer):
                    if re.match(rf"^\(?{num.group(1)}[.)]\s*", ln):
                        val = re.sub(rf"^\(?{num.group(1)}[.)]\s*", "", ln)
                        if val.lower().startswith("ans"):
                            val = re.sub(r"^ans\s*:?\s*", "", val, flags=re.I)
                        if not val and i + 1 < len(answer):
                            val = answer[i + 1]
                        return re.sub(r"\s*\(\d.*mark.*\)\s*$", "", val).strip(" .")
            for i, ln in enumerate(answer):
                if ln == pr and i + 1 < len(answer) and answer[i + 1].lower().startswith("ans"):
                    return re.sub(r"^ans\s*:?\s*", "", answer[i + 1], flags=re.I).strip(" .")
    return None


RE_MARKER = re.compile(r"^(\(?\d+\)?[.)]|\(?[a-z]\)|[a-e]\.\s|\(?[ivx]+\)|•|-\s|Ans\b|ANS\b|Q\d+\.|NB\b|"
                       r"PICTURES?\b|IMAGE\b|Grade\b|QUESTION\b|ANSWER\b|[A-Z][A-Za-z ()/'-]{1,34}:)")


def join_wrapped(items):
    """Merge lines that the PDF wrapped: previous line reached the right margin and
    the next one doesn't start a new list item / label."""
    out = []
    for it in items:
        if it["type"] == "line" and out and out[-1]["type"] == "line":
            prev = out[-1]
            t = it["text"]
            wrapped = prev["x1"] > 430 and not RE_MARKER.match(t) and not RE_REF.match(t) \
                and not RE_LABEL.match(t) and not RE_ANSWER.match(t)
            if wrapped or (t[:1].islower() and not RE_MARKER.match(t)):
                sep = "" if prev["text"].endswith("-") and t[:1].islower() else " "
                out[-1] = dict(prev, text=prev["text"] + sep + t, x1=it["x1"])
                continue
        out.append(it)
    return out


def build_cards(sec, unit, idx):
    items = join_wrapped(unit["items"])
    lines = [x for x in items if x["type"] == "line"]
    images = [x["id"] for x in items if x["type"] == "img"]
    refs = [x["text"] for x in lines if RE_REF.match(x["text"])]
    labels = label_map(items)
    body = [x["text"] for x in lines if not RE_REF.match(x["text"]) and not RE_LABEL.match(x["text"])
            and not RE_HEADING.match(x["text"])]
    flags = []
    if any(RE_ANSWER.match(t) for t in body):
        k = next(i for i, t in enumerate(body) if RE_ANSWER.match(t))
        prompts, answer = body[:k], body[k + 1:]
    elif any(re.match(r"^ans\b", t, re.I) for t in body):
        prompts = [t for t in body if QWORDS.match(t) or t.endswith("?")]
        answer = body                      # interleaved Q / Ans – rendered together
        flags.append("inline-answers")
    else:
        prompts = [t for t in body if t.endswith("?") or QWORDS.match(t)]
        answer = [t for t in body if t not in prompts]
    if not answer:
        flags.append("no-answer")
    if images and not prompts:
        flags.append("no-prompt")
    num = unit["num"]
    base = f"{sec}-Q{num:02d}" if num is not None else f"{sec}-{idx:02d}"
    common = dict(section=sec, qNumber=num, refs=refs, page=items[0]["page"] if items else None)

    # split multi-picture answers
    hdr_idx = [i for i, t in enumerate(answer) if RE_PIC_HDR.match(t)]
    if len(images) >= 2 and hdr_idx and labels:
        cards = []
        for j, i0 in enumerate(hdr_idx):
            i1 = hdr_idx[j + 1] if j + 1 < len(hdr_idx) else len(answer)
            m = RE_PIC_HDR.match(answer[i0])
            pics = [m.group(1)] + ([m.group(2)] if m.group(2) else [])
            pic_imgs = [labels[p] for p in pics if p in labels]
            seg = ([m.group(3)] if m.group(3) else []) + answer[i0 + 1:i1]
            cflags = list(flags)
            if len(pic_imgs) != len(pics):
                cflags.append("picture-label-unmapped")
                pic_imgs = pic_imgs or images
            cid = base + "-P" + "".join(pics)
            cards.append(dict(common, id=cid, picture=int(pics[0]), images=pic_imgs, prompts=list(prompts),
                              answerLines=seg, diagnosis=find_dx(prompts, seg), flags=cflags))
        return cards
    if len(images) >= 2:
        flags.append("multi-image")
    return [dict(common, id=base, picture=None, images=images, prompts=prompts, answerLines=answer,
                 diagnosis=find_dx(prompts, answer), flags=flags)]


def main():
    cards = []
    for sec, name, a, b, numbered in SECTIONS:
        for i, u in enumerate(units_for(sec, a, b, numbered), 1):
            if not u["items"]:
                continue
            cards.extend(build_cards(sec, u, i))
    seen = {}
    for c in cards:                       # guarantee unique ids
        if c["id"] in seen:
            seen[c["id"]] += 1
            c["id"] += f"-{seen[c['id']]}"
            c["flags"].append("duplicate-id")
        else:
            seen[c["id"]] = 1
    json.dump({"sections": [{"id": s, "name": n} for s, n, *_ in SECTIONS], "cards": cards},
              open("build/cards_draft.json", "w"), indent=1, ensure_ascii=False)
    from collections import Counter
    print(len(cards), "cards;", Counter(c["section"] for c in cards))
    print("flags:", Counter(f for c in cards for f in c["flags"]))
    print("with diagnosis:", sum(1 for c in cards if c["diagnosis"]))


if __name__ == "__main__":
    main()
