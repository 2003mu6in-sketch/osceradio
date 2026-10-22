import { useEffect, useState } from "react";
import { useNow } from "../lib/useNow.ts";
import { useProgress } from "../storage/progress.ts";
import {
  accountsEnabled, clearNotice, deleteAccount, sendPasswordReset, signIn, signUp, updatePassword, useAuth,
} from "../sync/supabase.ts";
import { forgetAccount, resolveOtherAccount, signOutAndMaybeClear, syncNow, useSync } from "../sync/sync.ts";

type Msg = { kind: "ok" | "bad"; text: string } | null;
const MIN_PW = 8;
const ago = (t: number, now: number) => { const m = Math.floor(Math.max(0, now - t) / 60_000); return m < 1 ? "just now" : m < 60 ? `${m} min ago` : `${Math.floor(m / 60)} h ago`; };

/** Sign in / create account / reset password, and – once signed in – sync status and account actions. */
export function AccountPage() {
  const auth = useAuth();
  const [msg, setMsg] = useState<Msg>(null);
  useEffect(() => {
    if (auth.notice) { setMsg({ kind: auth.notice.kind === "ok" ? "ok" : "bad", text: auth.notice.text }); clearNotice(); }
  }, [auth.notice]);

  if (!accountsEnabled()) {
    return (
      <div className="section-gap" style={{ maxWidth: 560 }}>
        <h1>Account</h1>
        <div className="empty"><h2>Accounts are not switched on</h2>
          <p className="muted">This copy of the app has no sign-in service connected. Everything still works and is saved on this device; use Settings → Back up to move it between devices.</p>
          <a className="btn" href="#/settings">Go to Settings</a></div>
      </div>
    );
  }
  return (
    <div className="section-gap" style={{ maxWidth: 560 }}>
      <div>
        <h1>Account</h1>
        <p className="lede">{auth.user
          ? "Your progress and error log sync to your account, so they follow you between your phone and computer."
          : "Sign in to keep your progress and error log in step across your phone and computer. The app works without an account too – everything is saved on this device."}</p>
      </div>
      {msg && <p className={`notice ${msg.kind}`} role={msg.kind === "bad" ? "alert" : "status"}>{msg.text}</p>}
      {!auth.ready ? <p className="loading">Checking your sign-in…</p>
        : auth.recovery && auth.user ? <NewPassword onDone={(t) => setMsg({ kind: "ok", text: t })} />
        : auth.user ? <SignedIn email={auth.user.email} setMsg={setMsg} />
        : <SignedOut setMsg={setMsg} />}
    </div>
  );
}

/* ------------------------------------------------------------------ signed out */

function SignedOut({ setMsg }: { setMsg: (m: Msg) => void }) {
  const [mode, setMode] = useState<"in" | "up" | "reset">("in");
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (e: { preventDefault(): void }) => {
    e.preventDefault();
    setMsg(null);
    const em = email.trim();
    if (!/^\S+@\S+\.\S+$/.test(em)) return setMsg({ kind: "bad", text: "Enter your email address." });
    if (mode !== "reset" && pw.length < (mode === "up" ? MIN_PW : 1)) return setMsg({ kind: "bad", text: mode === "up" ? `Choose a password of at least ${MIN_PW} characters.` : "Enter your password." });
    setBusy(true);
    try {
      if (mode === "in") { await signIn(em, pw); setMsg({ kind: "ok", text: "You're signed in. Syncing your progress…" }); }
      else if (mode === "up") {
        const r = await signUp(em, pw);
        setMsg({ kind: "ok", text: r.signedIn ? "Account created – you're signed in. Your progress on this device is being added to it." : `Almost done: we sent a confirmation link to ${em}. Open it on this device to finish, then you're signed in.` });
        if (!r.signedIn) { setMode("in"); setPw(""); }
      } else {
        await sendPasswordReset(em);
        setMsg({ kind: "ok", text: `If ${em} has an account, a link to set a new password is on its way. Open it on this device.` });
        setMode("in");
      }
    } catch (err) { setMsg({ kind: "bad", text: (err as Error).message }); }
    finally { setBusy(false); }
  };

  return (
    <section className="panel">
      {mode !== "reset" && (
        <div className="segmented" role="group" aria-label="Sign in or create an account">
          <button type="button" aria-pressed={mode === "in"} onClick={() => { setMode("in"); setMsg(null); }}>Sign in</button>
          <button type="button" aria-pressed={mode === "up"} onClick={() => { setMode("up"); setMsg(null); }}>Create account</button>
        </div>
      )}
      {mode === "reset" && <h2>Reset your password</h2>}
      <form className="stack" style={{ gap: 14 }} onSubmit={submit} noValidate>
        <div className="field">
          <label htmlFor="acct-email">Email</label>
          <input id="acct-email" type="email" autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        {mode !== "reset" && (
          <div className="field">
            <label htmlFor="acct-pw">Password{mode === "up" ? ` (at least ${MIN_PW} characters)` : ""}</label>
            <div className="pw-row">
              <input id="acct-pw" type={show ? "text" : "password"} autoComplete={mode === "up" ? "new-password" : "current-password"}
                value={pw} onChange={(e) => setPw(e.target.value)} required minLength={mode === "up" ? MIN_PW : undefined} />
              <button type="button" className="btn ghost small" aria-pressed={show} onClick={() => setShow(!show)}>{show ? "Hide" : "Show"}</button>
            </div>
          </div>
        )}
        <button className="btn primary wide" disabled={busy}>
          {busy ? "Please wait…" : mode === "in" ? "Sign in" : mode === "up" ? "Create account" : "Send reset link"}
        </button>
        {mode === "in" && <button type="button" className="linkish" onClick={() => { setMode("reset"); setMsg(null); }}>Forgot your password?</button>}
        {mode === "reset" && <button type="button" className="linkish" onClick={() => setMode("in")}>Back to sign in</button>}
      </form>
    </section>
  );
}

/* ------------------------------------------------------------------ signed in */

function SignedIn({ email, setMsg }: { email: string; setMsg: (m: Msg) => void }) {
  const sync = useSync();
  const now = useNow(15_000);
  const { reviews, errors } = useProgress();
  const answered = [...reviews.values()].filter((r) => r.seen).length;
  const [clearOnOut, setClearOnOut] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const status = sync.status === "syncing" ? "Syncing…"
    : sync.status === "offline" ? "Offline – changes are saved on this device and will sync when you're back online."
    : sync.status === "error" ? `Sync problem: ${sync.error} It will try again shortly.`
    : sync.status === "choose" ? "Waiting for your choice below."
    : sync.lastSyncedAt ? `Up to date (synced ${ago(sync.lastSyncedAt, Math.max(now, Date.now()))}).` : "Ready to sync.";

  return (
    <>
      <section className="panel">
        <h2>Signed in</h2>
        <dl className="dl">
          <dt>Email</dt><dd>{email}</dd>
          <dt>Sync</dt><dd role="status">{status}</dd>
          <dt>On this device</dt><dd>{errors.length} error log {errors.length === 1 ? "entry" : "entries"} · {answered} {answered === 1 ? "question" : "questions"} answered</dd>
        </dl>
        {sync.status !== "choose" && <button className="btn" disabled={sync.status === "syncing"} onClick={() => syncNow()}>Sync now</button>}
      </section>

      {sync.status === "choose" && (
        <section className="panel" aria-labelledby="choose-h" style={{ borderColor: "var(--warn)" }}>
          <h2 id="choose-h">This device has someone else's progress</h2>
          <p style={{ margin: 0 }}>The progress on this device was synced with <b>{sync.otherEmail}</b>. What should happen to it?</p>
          <div className="data-actions">
            <button className="btn primary" onClick={() => resolveOtherAccount("merge")}>Add it to my account</button>
            <button className="btn" onClick={() => resolveOtherAccount("clear")}>Remove it from this device</button>
          </div>
        </section>
      )}

      <ChangePassword setMsg={setMsg} />

      <section className="panel">
        <h2>Sign out</h2>
        <label className="switch" htmlFor="clear-out">
          <span>Also remove my progress from this device<br /><span className="muted" style={{ fontSize: ".875rem" }}>Choose this on a shared computer. Your account keeps everything that has synced.</span></span>
          <input id="clear-out" type="checkbox" checked={clearOnOut} onChange={(e) => setClearOnOut(e.target.checked)} />
        </label>
        <button className="btn" disabled={busy || sync.status === "syncing"} onClick={async () => {
          setBusy(true);
          if (clearOnOut && sync.status !== "idle") await syncNow();
          await signOutAndMaybeClear(clearOnOut);
          setBusy(false);
          setMsg({ kind: "ok", text: clearOnOut ? "Signed out and removed your progress from this device." : "Signed out. Your progress stays on this device." });
        }}>Sign out</button>
      </section>

      <section className="panel danger-zone">
        <h2>Delete account</h2>
        {!confirmDelete ? (
          <button className="btn ghost" onClick={() => setConfirmDelete(true)}>Delete my account…</button>
        ) : (
          <div className="stack" style={{ gap: 8 }}>
            <p style={{ margin: 0 }}><strong>Delete your account and the progress synced to it?</strong> This cannot be undone. The progress on this device stays here.</p>
            <div className="data-actions">
              <button className="btn danger" disabled={busy} onClick={async () => {
                setBusy(true);
                try { await deleteAccount(); forgetAccount(); setMsg({ kind: "ok", text: "Your account has been deleted." }); }
                catch (e) { setMsg({ kind: "bad", text: (e as Error).message }); }
                finally { setBusy(false); setConfirmDelete(false); }
              }}>Delete account</button>
              <button className="btn ghost" onClick={() => setConfirmDelete(false)}>Keep it</button>
            </div>
          </div>
        )}
      </section>
    </>
  );
}

function ChangePassword({ setMsg }: { setMsg: (m: Msg) => void }) {
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <details className="panel">
      <summary><h2 style={{ display: "inline" }}>Change password</h2></summary>
      <PasswordForm id="chg" pw={pw} setPw={setPw} busy={busy} label="Save new password" onSubmit={async () => {
        setBusy(true);
        try { await updatePassword(pw); setPw(""); setMsg({ kind: "ok", text: "Password changed." }); }
        catch (e) { setMsg({ kind: "bad", text: (e as Error).message }); }
        finally { setBusy(false); }
      }} onShort={() => setMsg({ kind: "bad", text: `Choose a password of at least ${MIN_PW} characters.` })} />
    </details>
  );
}

function NewPassword({ onDone }: { onDone: (t: string) => void }) {
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <section className="panel">
      <h2>Set a new password</h2>
      {err && <p className="notice bad" role="alert">{err}</p>}
      <PasswordForm id="new" pw={pw} setPw={setPw} busy={busy} label="Save password" onSubmit={async () => {
        setBusy(true); setErr(null);
        try { await updatePassword(pw); onDone("Password saved – you're signed in."); }
        catch (e) { setErr((e as Error).message); }
        finally { setBusy(false); }
      }} onShort={() => setErr(`Choose a password of at least ${MIN_PW} characters.`)} />
    </section>
  );
}

function PasswordForm({ id, pw, setPw, busy, label, onSubmit, onShort }: {
  id: string; pw: string; setPw: (s: string) => void; busy: boolean; label: string; onSubmit: () => void; onShort: () => void;
}) {
  const [show, setShow] = useState(false);
  return (
    <form className="stack" style={{ gap: 12 }} noValidate onSubmit={(e) => { e.preventDefault(); if (pw.length < MIN_PW) onShort(); else onSubmit(); }}>
      <div className="field">
        <label htmlFor={`${id}-pw`}>New password (at least {MIN_PW} characters)</label>
        <div className="pw-row">
          <input id={`${id}-pw`} type={show ? "text" : "password"} autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
          <button type="button" className="btn ghost small" aria-pressed={show} onClick={() => setShow(!show)}>{show ? "Hide" : "Show"}</button>
        </div>
      </div>
      <button className="btn primary" disabled={busy}>{busy ? "Saving…" : label}</button>
    </form>
  );
}
