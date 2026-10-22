import json,sys
d=json.load(open(f"build/osce2/{sys.argv[1]}.units.json"))
for i,u in enumerate(d["units"]):
    print(f"[{i}] {u['paper']} p{u['page']} Q{u['qNumber']} img={u['images']} ansimg={u['answerImages']} head={u['heading']}")
    for t in u["pre"][:4]: print("     ?",t[:100])
    for t in u["answer"][:3]: print("     =",t[:100])
    if u["refs"]: print("     refs",len(u["refs"]))
