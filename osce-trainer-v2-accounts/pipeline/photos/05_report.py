"""Append the photographed-paper reconciliation to content/mcq/REPORT.md."""
import os, glob, importlib.util
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(os.path.dirname(HERE))
spec = importlib.util.spec_from_file_location("tr", os.path.join(HERE, "03_transcripts.py")); tr = importlib.util.module_from_spec(spec); spec.loader.exec_module(tr)
NOTES = {
    "anaesthesia-2025.txt": "Q73–92 and Q95 are not among the photos (the key skips them too).",
    "ent-2025.txt": "Q13–26 (exam page 3) are not among the photos; the key has no answers for them either.",
    "ent-2016.txt": "Q100 is too blurred to transcribe: kept as a paper photo with its key answer.",
    "ent-2023.txt": "Recalled questions; answers are the students' ticks. One question has no tick and is incomplete.",
    "radiology-2020.txt": "Section A (Q1–50) is true/false with no key: kept as 12 paper-photo cards. Q56 has no key answer.",
    "ophthalmology-2025.txt": "The paper numbers two questions 56; the second is 56b.",
    "anaesthesia-2016.txt": "Q17–20 include the ECG strip from the photo. Five key answers are printed in red (meaning not stated).",
}
rows = ["", "## Photographed papers (transcribed by hand, phase V2-3)", "",
        "| File | Questions transcribed | Range | Notes |", "|---|---|---|---|"]
for p in sorted(glob.glob(os.path.join(HERE, "transcripts", "*.txt"))):
    qs = tr.parse_file(p); ns = [q["n"] for q in qs]
    rows.append(f"| {os.path.basename(p)} | {len(qs)} | {min(ns)}–{max(ns)} | {NOTES.get(os.path.basename(p), '')} |")
rows += ["", "Handwritten OSCE pages (ophthalmology Dr Batieka cases and misc, ENT misc) are kept as picture notes tagged *Handwritten*, not quizzed."]
src = open(os.path.join(ROOT, "build", "mcq", "report.md")).read()
open(os.path.join(ROOT, "content", "mcq", "REPORT.md"), "w").write(src + "\n".join(rows) + "\n")
print("\n".join(rows))
