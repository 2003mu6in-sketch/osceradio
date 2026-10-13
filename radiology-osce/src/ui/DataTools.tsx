import { useRef, useState } from "react";
import type { Content } from "../data/types.ts";
import { backupFileName, buildBackup, describePlan, errorsCsv, parseBackup, planMerge, type Backup, type MergePlan } from "../logic/backup.ts";
import { downloadText } from "../lib/download.ts";
import { applyImport, getProgress, resetProgress, useProgress } from "../storage/progress.ts";
import { updateSettings, useSettings } from "../storage/settings.ts";

const when = (t: number) => new Date(t).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

export async function exportBackup(): Promise<void> {
  const now = Date.now();
  const { reviews, errors, session } = getProgress();
  downloadText(backupFileName(now, "json"), JSON.stringify(buildBackup([...reviews.values()], errors, session, now), null, 1), "application/json");
  await updateSettings({ lastExportAt: now, backupSnoozedUntil: null });
}

/** Export, import (with a preview of what will change) and reset – shown in Settings. */
export function DataTools({ content }: { content: Content }) {
  const s = useSettings();
  const { errors, reviews } = useProgress();
  const file = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<{ name: string; backup: Backup; plan: MergePlan } | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "bad"; text: string } | null>(null);
  const [reset, setReset] = useState(false);
  const attempts = [...reviews.values()].reduce((n, r) => n + r.seen, 0);

  const exportCsv = () => {
    downloadText(backupFileName(Date.now(), "csv"), errorsCsv(errors, reviews, content), "text/csv;charset=utf-8");
    setMsg({ kind: "ok", text: "Error log saved as a spreadsheet (CSV)." });
  };
  const onFile = async (f: File | undefined) => {
    if (!f) return;
    setMsg(null);
    try {
      const backup = parseBackup(await f.text());
      const p = getProgress();
      setPending({ name: f.name, backup, plan: planMerge(p, backup, new Set(content.cards.map((c) => c.id))) });
    } catch (e) {
      setMsg({ kind: "bad", text: (e as Error).message });
    } finally { if (file.current) file.current.value = ""; }
  };
  const confirmImport = async () => {
    if (!pending) return;
    await applyImport(pending.plan);
    setMsg({ kind: "ok", text: `Imported ${pending.name}. ${describePlan(pending.plan).replace(/^Adds/, "Added")}` });
    setPending(null);
  };

  return (
    <section className="panel" aria-labelledby="data-h">
      <h2 id="data-h">Back up and move your data</h2>
      <p className="muted" style={{ margin: 0 }}>
        Your progress and error log are stored only in this browser, on this device. Save a backup file regularly;
        import it on another phone or computer to carry on there.
      </p>
      <dl className="dl">
        <dt>On this device</dt><dd>{errors.length} error log {errors.length === 1 ? "entry" : "entries"} · {attempts} answers marked</dd>
        <dt>Last backup</dt><dd>{s.lastExportAt ? when(s.lastExportAt) : "Never"}</dd>
      </dl>

      <div className="data-actions">
        <button className="btn primary" onClick={() => exportBackup().then(() => setMsg({ kind: "ok", text: "Backup saved. Keep the file somewhere safe (Drive, email to yourself)." }))}>
          Save backup file
        </button>
        <button className="btn" onClick={exportCsv} disabled={!errors.length}>Export error log (CSV)</button>
        <button className="btn" onClick={() => file.current?.click()}>Import a backup…</button>
        <input ref={file} id="import-file" type="file" accept=".json,application/json" hidden onChange={(e) => onFile(e.target.files?.[0])} />
      </div>

      {pending && (
        <div className="import-preview" role="region" aria-label="Import preview">
          <p style={{ margin: 0 }}><strong>{pending.name}</strong> · saved {when(pending.backup.exportedAt)}</p>
          <p style={{ margin: 0 }}>{describePlan(pending.plan)}</p>
          <p className="muted" style={{ margin: 0, fontSize: ".875rem" }}>Importing only adds. Nothing on this device is deleted; for each question the most recent progress is kept.</p>
          <div className="data-actions">
            <button className="btn primary" onClick={confirmImport}
              disabled={!pending.plan.newErrors && !pending.plan.updatedQuestions && !pending.plan.newQuestions && !pending.plan.session}>Import</button>
            <button className="btn ghost" onClick={() => setPending(null)}>Cancel</button>
          </div>
        </div>
      )}

      {msg && <p className={msg.kind === "ok" ? "notice ok" : "notice bad"} role={msg.kind === "bad" ? "alert" : "status"}>{msg.text}</p>}

      <div className="danger-zone">
        {!reset ? (
          <button className="btn ghost" onClick={() => setReset(true)} disabled={!errors.length && !attempts}>Delete all progress on this device…</button>
        ) : (
          <div className="stack" style={{ gap: 8 }}>
            <p style={{ margin: 0 }}><strong>Delete your error log, review schedule and progress from this device?</strong> This cannot be undone. Save a backup first if you may want it back.</p>
            <div className="data-actions">
              <button className="btn danger" onClick={async () => { await resetProgress(); setReset(false); setMsg({ kind: "ok", text: "All progress deleted from this device." }); }}>Delete everything</button>
              <button className="btn ghost" onClick={() => setReset(false)}>Keep my data</button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
