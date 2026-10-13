import { useEffect, useRef, useState } from "react";
import type { Card } from "../data/types.ts";
import { ERROR_TAGS, ROOT_CAUSES, type ErrorTag, type RootCause } from "../storage/types.ts";

export interface WrongInput { tags: ErrorTag[]; rootCause: RootCause; note?: string; typedAnswer?: string }

/**
 * Error log entry opened by "Wrong". Cannot be saved without at least one error type
 * and a root cause. Keys: 1–6 toggle error types, F / A / N pick the root cause,
 * Enter saves, Esc cancels (returns to the revealed answer without recording anything).
 */
export function WrongDialog({ card, typedAnswer, onSave, onCancel, saving }: {
  card: Card; typedAnswer: string; saving: boolean;
  onSave: (v: WrongInput) => void; onCancel: () => void;
}) {
  const [tags, setTags] = useState<ErrorTag[]>([]);
  const [cause, setCause] = useState<RootCause | null>(null);
  const [note, setNote] = useState("");
  const first = useRef<HTMLButtonElement>(null);
  const valid = tags.length > 0 && cause !== null;

  const toggle = (t: ErrorTag) => setTags((ts) => (ts.includes(t) ? ts.filter((x) => x !== t) : [...ts, t]));
  const save = () => {
    if (!valid || saving) return;
    onSave({ tags, rootCause: cause!, note: note.trim() || undefined, typedAnswer: typedAnswer.trim() || undefined });
  };

  useEffect(() => { first.current?.focus(); }, []);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onCancel(); return; }
      if ((e.target as HTMLElement).tagName === "TEXTAREA") {
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); save(); }
        return;
      }
      const n = Number(e.key);
      if (n >= 1 && n <= ERROR_TAGS.length) { e.preventDefault(); toggle(ERROR_TAGS[n - 1].id); return; }
      const rc = ROOT_CAUSES.find((r) => r.key === e.key.toUpperCase());
      if (rc && !e.ctrlKey && !e.metaKey) { e.preventDefault(); setCause(rc.id); return; }
      if (e.key === "Enter" && (e.target as HTMLElement).tagName !== "BUTTON") { e.preventDefault(); save(); }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });

  const missing = [!tags.length && "at least one error type", !cause && "a root cause"].filter(Boolean).join(" and ");

  return (
    <div className="sheet-backdrop" onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="wrong-h">
        <div>
          <p className="eyebrow">Error log · {card.id}</p>
          <h2 id="wrong-h">What went wrong?</h2>
          {card.diagnosis && <p className="muted" style={{ margin: "4px 0 0" }}>Answer: {card.diagnosis}</p>}
        </div>

        <fieldset className="fs">
          <legend>Error type <span className="muted">– choose all that apply</span></legend>
          <div className="tag-grid">
            {ERROR_TAGS.map((t, i) => (
              <button key={t.id} ref={i === 0 ? first : undefined} type="button" className="opt" aria-pressed={tags.includes(t.id)} onClick={() => toggle(t.id)}>
                <kbd>{i + 1}</kbd><span><strong>{t.label}</strong><small>{t.hint}</small></span>
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="fs">
          <legend>Root cause <span className="muted">– pick one</span></legend>
          <div className="cause-grid" role="radiogroup" aria-label="Root cause">
            {ROOT_CAUSES.map((r) => (
              <button key={r.id} type="button" role="radio" className="opt" aria-checked={cause === r.id} aria-pressed={cause === r.id} onClick={() => setCause(r.id)}>
                <kbd>{r.key}</kbd><span><strong>{r.label}</strong><small>{r.hint}</small></span>
              </button>
            ))}
          </div>
        </fieldset>

        <div className="field">
          <label htmlFor="wrong-note">Note <span className="muted">(optional)</span></label>
          <textarea id="wrong-note" rows={2} placeholder="e.g. confused the coffee bean sign with the double bubble" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        {typedAnswer.trim() && <p className="muted" style={{ margin: 0, fontSize: ".875rem" }}>Your typed answer is saved with this entry: “{typedAnswer.trim()}”</p>}

        <div className="sheet-actions">
          <button type="button" className="btn ghost" onClick={onCancel}>Cancel</button>
          <button type="button" className="btn danger" disabled={!valid || saving} onClick={save}>
            {saving ? "Saving…" : "Save to error log"}
          </button>
        </div>
        {!valid && <p className="hint" aria-live="polite">Choose {missing} to save.</p>}
      </div>
    </div>
  );
}
