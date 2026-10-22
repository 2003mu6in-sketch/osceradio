import { needsBackup } from "../logic/backup.ts";
import { HOUR } from "../logic/schedule.ts";
import { useNow } from "../lib/useNow.ts";
import { activitySpan, useProgress } from "../storage/progress.ts";
import { updateSettings, useSettings } from "../storage/settings.ts";
import { exportBackup } from "./DataTools.tsx";

/** Reminder to save a backup: after the first day of use, then weekly – only when there is new progress. */
export function BackupBanner() {
  const s = useSettings();
  useProgress();                      // re-render when progress changes
  const now = useNow();
  const span = activitySpan();
  if (!needsBackup({ now, lastExportAt: s.lastExportAt, firstActivityAt: span.first, lastActivityAt: span.last, snoozedUntil: s.backupSnoozedUntil })) return null;
  return (
    <div className="backup-banner" role="status">
      <p>{s.lastExportAt
        ? `Your last backup was ${Math.floor((now - s.lastExportAt) / (24 * HOUR))} days ago. Your progress lives only on this device.`
        : "Your progress lives only on this device. Save a backup so you don't lose it."}</p>
      <div className="data-actions">
        <button className="btn small primary" onClick={() => exportBackup()}>Save backup</button>
        <button className="btn small ghost" onClick={() => updateSettings({ backupSnoozedUntil: now + 24 * HOUR })}>Remind me tomorrow</button>
      </div>
    </div>
  );
}
