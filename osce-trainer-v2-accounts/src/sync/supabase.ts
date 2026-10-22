import { useSyncExternalStore } from "react";

/**
 * Minimal Supabase client: Auth (GoTrue) and the REST API (PostgREST) over fetch.
 * No SDK dependency – the app only needs email + password sign-in and two tables.
 * Config comes from the build (scripts/build.mjs → __SUPABASE__); when it is null accounts are off.
 */
export const SUPABASE: { url: string; key: string } | null = typeof __SUPABASE__ !== "undefined" ? __SUPABASE__ : null;
export const accountsEnabled = () => SUPABASE !== null;

export interface User { id: string; email: string }
interface Session { access_token: string; refresh_token: string; expires_at: number; user: User }

export interface AuthState {
  ready: boolean;
  user: User | null;
  /** Opened from a "reset password" email: ask for a new password. */
  recovery: boolean;
  /** One-off message for the Account page (e.g. "Email confirmed"). */
  notice: { kind: "ok" | "error"; text: string } | null;
}

const KEY = "osce-auth-v1";
let session: Session | null = null;
let state: AuthState = { ready: false, user: null, recovery: false, notice: null };
const listeners = new Set<() => void>();
const emit = (patch: Partial<AuthState>) => { state = { ...state, ...patch }; listeners.forEach((l) => l()); };
export const useAuth = () => useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb); }, () => state);
export const getAuth = () => state;
export const onAuthChange = (cb: () => void) => { listeners.add(cb); return () => listeners.delete(cb); };

function store(s: Session | null) {
  session = s;
  try { if (s) localStorage.setItem(KEY, JSON.stringify(s)); else localStorage.removeItem(KEY); } catch {}
  emit({ user: s?.user ?? null });
}

export class ApiError extends Error {
  constructor(message: string, public status = 0, public code = "", public offline = false) { super(message); }
}

/** Turn Supabase error bodies into sentences a student can act on. */
export function friendlyError(status: number, body: any): ApiError {
  const code = String(body?.error_code ?? body?.code ?? body?.error ?? "");
  const msg = String(body?.msg ?? body?.error_description ?? body?.message ?? "");
  const say = (t: string) => new ApiError(t, status, code);
  if (code === "invalid_credentials" || /invalid login credentials/i.test(msg) || code === "invalid_grant" && /credentials/i.test(msg)) return say("Wrong email or password.");
  if (code === "email_not_confirmed" || /not confirmed/i.test(msg)) return say("Confirm your email first – open the link we sent you, then sign in.");
  if (code === "user_already_exists" || code === "email_exists" || /already registered/i.test(msg)) return say("An account with this email already exists. Sign in instead.");
  if (code === "weak_password" || /password should/i.test(msg)) return say(msg ? `Choose a stronger password: ${msg.replace(/^Password should /i, "it should ")}` : "Choose a stronger password.");
  if (code === "same_password") return say("The new password must be different from your current one.");
  if (code === "validation_failed" || /invalid.*email|unable to validate email/i.test(msg)) return say("That email address doesn't look right.");
  if (status === 429 || /rate limit/i.test(code + msg)) return say("Too many attempts. Wait a minute and try again.");
  if (code === "signup_disabled") return say("New accounts are switched off for this app.");
  if (status === 401 || code === "bad_jwt" || code === "session_not_found") return say("Your sign-in has expired. Sign in again.");
  return say(msg || `Something went wrong (error ${status || "unknown"}). Try again.`);
}

interface Req { method?: string; body?: unknown; token?: string | null; headers?: Record<string, string> }

/** One call to Supabase. Throws ApiError (offline = true when there is no connection). */
export async function call<T = any>(path: string, r: Req = {}): Promise<T> {
  if (!SUPABASE) throw new ApiError("Accounts are not set up for this app.");
  let res: Response;
  try {
    res = await fetch(SUPABASE.url + path, {
      method: r.method ?? (r.body === undefined ? "GET" : "POST"),
      headers: {
        apikey: SUPABASE.key,
        Authorization: `Bearer ${r.token ?? SUPABASE.key}`,
        ...(r.body === undefined ? {} : { "Content-Type": "application/json" }),
        ...r.headers,
      },
      body: r.body === undefined ? undefined : JSON.stringify(r.body),
    });
  } catch {
    throw new ApiError("No connection. Check your internet and try again.", 0, "offline", true);
  }
  const text = await res.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = { message: text }; }
  if (!res.ok) throw friendlyError(res.status, body);
  return body as T;
}

const toSession = (b: any): Session => ({
  access_token: b.access_token, refresh_token: b.refresh_token,
  expires_at: Number(b.expires_at) || Math.floor(Date.now() / 1000) + (Number(b.expires_in) || 3600),
  user: { id: b.user?.id, email: b.user?.email ?? "" },
});

/** Where links in Supabase emails come back to: this page, without its #route. */
const here = () => location.origin + location.pathname;

/* ------------------------------------------------------------------ public auth API */

export async function signUp(email: string, password: string): Promise<{ signedIn: boolean }> {
  const b = await call(`/auth/v1/signup?redirect_to=${encodeURIComponent(here())}`, { body: { email, password } });
  if (b?.access_token) { store(toSession(b)); return { signedIn: true }; }
  return { signedIn: false };   // email confirmation is on: a link has been sent
}

export async function signIn(email: string, password: string): Promise<User> {
  const b = await call("/auth/v1/token?grant_type=password", { body: { email, password } });
  const s = toSession(b);
  store(s);
  emit({ recovery: false });
  return s.user;
}

export async function signOut(): Promise<void> {
  const token = session?.access_token;
  store(null);
  emit({ recovery: false });
  if (token) call("/auth/v1/logout", { body: {}, token }).catch(() => {});
}

export async function sendPasswordReset(email: string): Promise<void> {
  await call(`/auth/v1/recover?redirect_to=${encodeURIComponent(here())}`, { body: { email } });
}

export async function updatePassword(password: string): Promise<void> {
  await call("/auth/v1/user", { method: "PUT", body: { password }, token: await accessToken() });
  emit({ recovery: false });
}

/** Deletes the account and everything synced to it (SQL function delete_my_account). */
export async function deleteAccount(): Promise<void> {
  await call("/rest/v1/rpc/delete_my_account", { body: {}, token: await accessToken() });
  store(null);
}

export const clearNotice = () => emit({ notice: null });

let refreshing: Promise<string> | null = null;

/** A valid access token, refreshed when it is about to expire. Throws when signed out. */
export async function accessToken(): Promise<string> {
  if (!session) throw new ApiError("You are signed out.", 401, "signed_out");
  if (session.expires_at * 1000 - 60_000 > Date.now()) return session.access_token;
  refreshing ??= (async () => {
    try {
      const b = await call("/auth/v1/token?grant_type=refresh_token", { body: { refresh_token: session!.refresh_token } });
      const s = toSession({ ...b, user: b.user ?? session!.user });
      store(s);
      return s.access_token;
    } catch (e) {
      if (!(e as ApiError).offline) { store(null); emit({ notice: { kind: "error", text: "Your sign-in has expired. Sign in again to keep syncing." } }); }
      throw e;
    } finally { refreshing = null; }
  })();
  return refreshing;
}

/**
 * Run once at start-up, before the router reads the URL. Supabase email links (confirm sign-up,
 * reset password) come back with tokens in the #fragment; they are taken out of the address bar
 * at once and the student lands on the Account page.
 */
export function initAuth(): void {
  if (!SUPABASE) { emit({ ready: true }); return; }
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) { session = JSON.parse(raw); emit({ user: session?.user ?? null }); }
  } catch {}
  window.addEventListener("storage", (e) => {
    if (e.key !== KEY) return;
    try { session = e.newValue ? JSON.parse(e.newValue) : null; } catch { session = null; }
    emit({ user: session?.user ?? null });
  });

  if (!readLinkTokens()) emit({ ready: true });
  // a link opened in a tab where the app is already running only changes the #fragment
  window.addEventListener("hashchange", () => { readLinkTokens(); }, true);
}

/** Take Supabase tokens (or an error) out of the #fragment. Returns false when there are none. */
function readLinkTokens(): boolean {
  const h = location.hash.replace(/^#\/?/, "");
  const p = /(^|&)(access_token|error_description|error)=/.test(h) ? new URLSearchParams(h) : null;
  if (!p) return false;
  history.replaceState(null, "", location.pathname + location.search + "#/account");
  window.dispatchEvent(new HashChangeEvent("hashchange"));
  if (p.get("error_description") || p.get("error")) {
    const d = p.get("error_description") ?? p.get("error") ?? "";
    emit({ ready: true, notice: { kind: "error", text: /expired|invalid/i.test(d) ? "That email link has expired or was already used. Ask for a new one." : d } });
    return true;
  }
  const type = p.get("type");
  const tmp = toSession({ access_token: p.get("access_token"), refresh_token: p.get("refresh_token"), expires_at: p.get("expires_at"), expires_in: p.get("expires_in"), user: { id: "", email: "" } });
  emit({ ready: false });
  call("/auth/v1/user", { token: tmp.access_token })
    .then((u) => {
      store({ ...tmp, user: { id: u.id, email: u.email ?? "" } });
      emit({
        ready: true, recovery: type === "recovery",
        notice: type === "recovery" ? null : { kind: "ok", text: type === "signup" ? "Email confirmed – you're signed in." : "You're signed in." },
      });
    })
    .catch((e) => emit({ ready: true, notice: { kind: "error", text: (e as Error).message } }));
  return true;
}
