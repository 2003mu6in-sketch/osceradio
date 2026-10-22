"""Write review/osce2/index.html: every new OSCE card with thumbnails inlined (for checking)."""
import base64, json, os
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(os.path.dirname(HERE))
subs = ["anaesthesia", "ophthalmology", "ent"]
D = {"subjects": {}, "img": {}}
for s in subs:
    d = json.load(open(os.path.join(ROOT, "content", "osce", f"{s}.json")))
    D["subjects"][s] = dict(cards=d["cards"], notes=d["notes"])
    for i in d["images"]:
        b = open(os.path.join(ROOT, "content", "img", "thumb", f"{i}.webp"), "rb").read()
        D["img"][i] = "data:image/webp;base64," + base64.b64encode(b).decode()
html = open(os.path.join(HERE, "qa_template.html")).read().replace("__DATA__", json.dumps(D, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/"))
os.makedirs(os.path.join(ROOT, "review", "osce2"), exist_ok=True)
out = os.path.join(ROOT, "review", "osce2", "index.html"); open(out, "w").write(html)
print(out, f"{len(html)/1e6:.1f} MB")
