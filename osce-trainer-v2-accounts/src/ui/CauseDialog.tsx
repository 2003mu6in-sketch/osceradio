import { useEffect, useRef, useState } from "react";
import { MCQ_CAUSES, type McqCause } from "../storage/types.ts";

export interface CauseInput { rootCause: McqCause; note?: string }

/**
 * Error-log entry for an MCQ or paper photo. One cause is required.
 * Keys: N / R / M / T pick the cause, Enter saves, Esc cancels (nothing is recorded).
 */
export function CauseDialog({ title, summary, saving, onSave, onCancel }: {
  title: string; summary?: string; saving: boolean;
  onSave: (v: CauseInput) => void; onCancel: () => void;
}) {
  const [cause, setCause] = useState<McqCause | null>(null);
  const [note, setNote] = useState("");
  const first = useRef<HTMLButtonElement>(null);
  const save = () => { if (cause && !saving) onSave({ rootCause: cause, note: note.trim() || undefined }); };

  useEffect(() => { first.current?.focus(); }, []);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onCancel(); return; }
      if ((e.target as HTMLElement).tagName === "TEXTAREA") {
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); save(); }
        return;
      }
      const c = MCQ_CAUSES.find((r) => r.key === e.key.toUpperCase());
      if (c && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); setCause(c.id); return; }
      if (e.key === "Enter" && (e.target as HTMLElement).tagName !== "BUTTON") { e.preventDefault(); save(); }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });

  return (
    <div className="sheet-backdrop" onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="cause-h">
        <div>
          <p className="eyebrow">Error log · {title}</p>
          <h2 id="cause-h">Why did you get it wrong?</h2>
          {summary && <p className="muted" style={{ margin: "4px 0 0" }}>{summary}</p>}
        </div>
        <fieldset className="fs">
          <legend>Cause <span className="muted">– pick one</span></legend>
          <div className="cause-grid four" role="radiogroup" aria-label="Cause">
            {MCQ_CAUSES.map((r, i) => (
              <button key={r.id} ref={i === 0 ? first : undefined} type="button" role="radio" className="opt"
                aria-checked={cause === r.id} aria-pressed={cause === r.id} onClick={() => setCause(r.id)}>
                <kbd>{r.key}</kbd><span><strong>{r.label}</strong><small>{r.hint}</small></span>
              </button>
            ))}
          </div>
        </fieldset>
        <div className="field">
          <label htmlFor="cause-note">Note <span className="muted">(optional)</span></label>
          <textarea id="cause-note" rows={2} placeholder="e.g. didn't notice the question said EXCEPT" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        <div className="sheet-actions">
          <button type="button" className="btn ghost" onClick={onCancel}>Cancel</button>
          <button type="button" className="btn danger" disabled={!cause || saving} onClick={save}>{saving ? "Saving…" : "Save to error log"}</button>
        </div>
        {!cause && <p className="hint" aria-live="polite">Choose a cause to save.</p>}
      </div>
    </div>
  );
}
