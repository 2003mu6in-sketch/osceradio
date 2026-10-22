"""Write review/mcq/index.html: every MCQ with its marked answer, for checking against the PDFs."""
import json, os, re
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(os.path.dirname(HERE))
subs = ["radiology", "anaesthesia", "ophthalmology", "ent"]
import base64
raw = {s: json.load(open(os.path.join(ROOT, "content", "mcq", f"{s}.json"))) for s in subs}
cards = {s: raw[s]["cards"] for s in subs}
photos = {s: raw[s].get("photoCards", []) for s in subs}
img = {}
for s in subs:
    for i in raw[s].get("images", {}):
        img[i] = "data:image/webp;base64," + base64.b64encode(open(os.path.join(ROOT, "content", "img", f"{i}.webp"), "rb").read()).decode()
rep = open(os.path.join(ROOT, "build", "mcq", "report.md")).read()
dropped = sum(int(m) for m in re.findall(r"^\| \d+ \| \d+ \| (\d+) \|", rep, re.M))
data = json.dumps(dict(cards=cards, photos=photos, img=img, dropped=dropped), ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
html = open(os.path.join(HERE, "qa_template.html")).read().replace("__DATA__", data)
os.makedirs(os.path.join(ROOT, "review", "mcq"), exist_ok=True)
out = os.path.join(ROOT, "review", "mcq", "index.html"); open(out, "w").write(html)
print(out, f"{len(html)/1024:.0f} KB", sum(map(len, cards.values())), "cards")
