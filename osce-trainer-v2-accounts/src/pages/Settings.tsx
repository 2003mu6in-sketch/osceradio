import { useEffect, useState } from "react";
import { requestPersistence } from "../storage/db.ts";
import { updateSettings, useSettings, type Theme } from "../storage/settings.ts";
import type { Content } from "../data/types.ts";
import { DataTools } from "../ui/DataTools.tsx";
import { OfflineImages } from "../ui/OfflineImages.tsx";
import { accountsEnabled, useAuth } from "../sync/supabase.ts";
import { useSync } from "../sync/sync.ts";

function useStorageInfo() {
  const [info, setInfo] = useState<{ persisted: boolean | null; usage?: number; quota?: number; offline: string }>({ persisted: null, offline: "Checking…" });
  useEffect(() => {
    (async () => {
      const persisted = navigator.storage?.persisted ? await navigator.storage.persisted() : null;
      const est = navigator.storage?.estimate ? await navigator.storage.estimate() : {};
      let offline = "Not available in this browser";
      if ("serviceWorker" in navigator) {
        const reg = await navigator.serviceWorker.getRegistration();
        offline = reg?.active ? "Ready – every question is saved on this device" : "Downloading questions and images…";
      }
      setInfo({ persisted, usage: est.usage, quota: est.quota, offline });
    })();
  }, []);
  return [info, setInfo] as const;
}

const mb = (n?: number) => (n == null ? "–" : `${(n / 1e6).toFixed(1)} MB`);

export function SettingsPage({ content }: { content: Content }) {
  const s = useSettings();
  const [info, setInfo] = useStorageInfo();
  const themes: [Theme, string][] = [["system", "Match device"], ["dark", "Dark"], ["light", "Light"]];
  return (
    <div className="section-gap" style={{ maxWidth: 720 }}>
      <h1>Settings</h1>

      <AccountPanel />

      <section className="panel">
        <h2>Display</h2>
        <div className="field">
          <span className="muted" id="theme-l">Theme</span>
          <div className="segmented" role="group" aria-labelledby="theme-l">
            {themes.map(([t, label]) => <button key={t} aria-pressed={s.theme === t} onClick={() => updateSettings({ theme: t })}>{label}</button>)}
          </div>
        </div>
      </section>

      <section className="panel">
        <h2>Studying</h2>
        <label className="switch" htmlFor="typed">
          <span>Type my answer before revealing<br /><span className="muted" style={{ fontSize: ".875rem" }}>Your typed answer is saved with the error log entry when you mark Wrong.</span></span>
          <input id="typed" type="checkbox" checked={s.typedAnswerBox} onChange={(e) => updateSettings({ typedAnswerBox: e.target.checked })} />
        </label>
        <label className="switch" htmlFor="shuffle">
          <span>Shuffle questions by default</span>
          <input id="shuffle" type="checkbox" checked={s.shuffle} onChange={(e) => updateSettings({ shuffle: e.target.checked })} />
        </label>
      </section>

      <DataTools content={content} />

      <section className="panel">
        <h2>Offline and storage</h2>
        <dl className="dl">
          <dt>Offline use</dt><dd>{info.offline}</dd>
          <dt>Protected from clean-up</dt><dd>{info.persisted == null ? "Not supported" : info.persisted ? "Yes" : "No"}</dd>
          <dt>Space used</dt><dd>{mb(info.usage)} of {mb(info.quota)}</dd>
        </dl>
        {info.persisted === false && (
          <button className="btn" onClick={async () => setInfo({ ...info, persisted: !!(await requestPersistence()) })}>Ask the browser to keep my data</button>
        )}
        <OfflineImages />
      </section>

      <a href="#/about">About this app and its sources ›</a>
    </div>
  );
}

function AccountPanel() {
  const auth = useAuth();
  const sync = useSync();
  if (!accountsEnabled()) return null;
  return (
    <section className="panel">
      <h2>Account</h2>
      {auth.user ? (
        <p style={{ margin: 0 }}>Signed in as <b>{auth.user.email}</b>. {sync.status === "idle" ? "Your progress is synced." : sync.status === "offline" ? "Offline – will sync when you're back online." : sync.status === "syncing" ? "Syncing…" : "Sync needs attention."}</p>
      ) : (
        <p style={{ margin: 0 }}>Sign in to keep your progress in step across your phone and computer.</p>
      )}
      <a className="btn" href="#/account" style={{ alignSelf: "flex-start" }}>{auth.user ? "Manage account" : "Sign in or create an account"}</a>
    </section>
  );
}
