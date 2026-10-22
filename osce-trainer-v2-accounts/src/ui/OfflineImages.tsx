import { useEffect, useState } from "react";
import { imageUrl, thumbUrl } from "../data/content.ts";
import { SUBJECTS, type Subject } from "../data/types.ts";

/** Same cache name as the service worker's runtime image cache (kept across app updates). */
const IMG_CACHE = "osce-img-v2";
type Row = { total: number; saved: number; busy: boolean; error?: string };

const urlsOf = (ids: string[]) => ids.flatMap((id) => [imageUrl(id), thumbUrl(id)]);

async function countSaved(ids: string[]): Promise<number> {
  const c = await caches.open(IMG_CACHE);
  let n = 0;
  for (const id of ids) {
    const hit = (await c.match(new URL(imageUrl(id), location.href).href, { ignoreSearch: true }))
      ?? (await caches.match(new URL(imageUrl(id), location.href).href, { ignoreSearch: true }));
    if (hit) n++;
  }
  return n;
}

/** Radiology OSCE pictures are saved on the first visit; this saves the other subjects' pictures on request. */
export function OfflineImages() {
  const [ids, setIds] = useState<Record<string, string[]> | null>(null);
  const [rows, setRows] = useState<Partial<Record<Subject, Row>>>({});
  const supported = typeof caches !== "undefined";

  useEffect(() => {
    if (!supported) return;
    let live = true;
    (async () => {
      const map = (await (await fetch("./content/images.json")).json()) as Record<string, string[]>;
      if (!live) return;
      setIds(map);
      for (const s of SUBJECTS) {
        const list = map[s.id] ?? [];
        const saved = await countSaved(list);
        if (live) setRows((r) => ({ ...r, [s.id]: { total: list.length, saved, busy: false } }));
      }
    })().catch(() => {});
    return () => { live = false; };
  }, [supported]);

  const save = async (s: Subject) => {
    const list = ids?.[s] ?? [];
    setRows((r) => ({ ...r, [s]: { ...r[s]!, busy: true, error: undefined } }));
    const c = await caches.open(IMG_CACHE);
    let done = 0, failed = 0;
    const urls = urlsOf(list);
    for (let i = 0; i < urls.length; i += 8) {
      await Promise.all(urls.slice(i, i + 8).map(async (u) => {
        try {
          const href = new URL(u, location.href).href;
          if (!(await c.match(href, { ignoreSearch: true }))) {
            const res = await fetch(href);
            if (!res.ok) throw new Error(String(res.status));
            await c.put(href, res);
          }
        } catch { failed++; }
      }));
      done = Math.min(list.length, Math.floor((i + 8) / 2));
      setRows((r) => ({ ...r, [s]: { ...r[s]!, saved: Math.max(r[s]!.saved, done) } }));
    }
    const saved = await countSaved(list);
    setRows((r) => ({ ...r, [s]: { total: list.length, saved, busy: false,
      error: failed ? `${failed} files could not be downloaded. Check your connection and try again.` : undefined } }));
  };

  if (!supported) return null;
  return (
    <div className="stack" style={{ gap: 8 }}>
      <p className="label" style={{ margin: 0 }}>Pictures for offline use</p>
      <p className="muted" style={{ margin: 0, fontSize: ".875rem" }}>All questions work offline. Radiology OSCE pictures are saved on your first visit; other pictures are saved when you first see them, or all at once here.</p>
      <ul className="offline-list">
        {SUBJECTS.map((s) => {
          const r = rows[s.id];
          const complete = r && r.total > 0 && r.saved >= r.total;
          return (
            <li key={s.id}>
              <span><b>{s.name}</b><br /><span className="muted">{!r ? "Checking…" : r.total === 0 ? "No extra pictures" : complete ? `All ${r.total} pictures saved` : `${r.saved} of ${r.total} pictures saved`}</span>
                {r?.error && <><br /><span role="alert" style={{ color: "var(--wrong)" }}>{r.error}</span></>}</span>
              {r && r.total > 0 && !complete && (
                <button className="btn small" disabled={r.busy} onClick={() => save(s.id)} aria-label={`Save ${s.name} pictures for offline use`}>
                  {r.busy ? "Saving…" : "Save for offline"}
                </button>
              )}
              {complete && <span className="chip small" style={{ color: "var(--right)" }}>✓ Offline</span>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
