"""Debug: print merged rows around a question. usage: show.py FILE PAGE [startRegex] [n]"""
import json,sys,re,importlib,os
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
m=importlib.import_module("02_parse")
f,pg=sys.argv[1],int(sys.argv[2]); pat=sys.argv[3] if len(sys.argv)>3 else None; n=int(sys.argv[4]) if len(sys.argv)>4 else 14
d=json.load(open(f"build/mcq/{f}.layout.json"))
rows=[r for p in d["pages"] if p["n"] in (pg,pg+1) for r in m.rows_of(p)]
i=next((k for k,r in enumerate(rows) if pat and re.search(pat,r["text"])),0)
for r in rows[i:i+n]: print(f"  p{r['page']} x{round(r['x0'])} {r['color'][:3]} {str(r['hl'])[:3]:4} {r['text'][:110]}")
