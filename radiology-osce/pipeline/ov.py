"""Load and merge pipeline/overrides/*.yaml -> {"images": {...}, "cards": {...}}.
The same card/image may appear in several files; fields are merged, but setting the
same field twice is an error (so corrections never silently overwrite each other)."""
import glob, yaml


def load():
    out = {"images": {}, "cards": {}}
    for f in sorted(glob.glob("pipeline/overrides/*.yaml")):
        d = yaml.safe_load(open(f)) or {}
        for k in out:
            for key, val in (d.get(k) or {}).items():
                tgt = out[k].setdefault(key, {})
                for fld, v in (val or {}).items():
                    if fld in tgt:
                        raise SystemExit(f"{f}: {k}.{key}.{fld} already set in an earlier file")
                    tgt[fld] = v
    return out
