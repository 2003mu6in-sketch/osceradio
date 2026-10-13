"""Build review/index.html (QA sheet) from content/cards.json + build/reconciliation.md"""
import json, re
d = json.load(open("content/cards.json"))
rows = [l.strip().strip("|").split("|") for l in open("build/reconciliation.md").read().splitlines()[2:]]
rec = [[c.strip() for c in r] for r in rows]
t = open("pipeline/review_template.html").read()
dump = lambda o: json.dumps(o, ensure_ascii=False).replace("</", "<\\/")
open("review/index.html", "w").write(t.replace("__DATA__", dump(d)).replace("__REC__", dump(rec)))
print("review/index.html", len(d["cards"]), "cards,", len(rec), "rows")
