// Accounts & sync end-to-end checks (npm run e2e). Builds a copy of the app with Supabase switched on
// (dist-accounts/) and answers its Auth + REST calls with an in-memory fake that follows the same rules
// as supabase/migrations/0001_progress_sync.sql (row ownership, newest-wins, tombstones).
import { chromium } from "playwright";
import { spawn, execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import { readFileSync, mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";

const OUT = "dist-accounts", PORT = 4183, BASE = `http://localhost:${PORT}/`;
const SUPA = "https://mockproj.supabase.co", KEY = "test-anon-key";
execFileSync(process.execPath, ["scripts/build.mjs"], { env: { ...process.env, OUT_DIR: OUT, SUPABASE_URL: SUPA, SUPABASE_ANON_KEY: KEY }, stdio: "inherit" });
const server = spawn(process.execPath, ["scripts/serve.mjs", OUT, String(PORT)], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 600));
mkdirSync("test-results", { recursive: true });

/* ------------------------------------------------------------------ fake Supabase */
const db = { users: new Map(), tokens: new Map(), refresh: new Map(), reviews: [], errors: [], confirm: false, down: false, ttl: 3600, refreshCalls: 0 };
let clock = Date.parse("2026-10-21T10:00:00Z");
const ts = () => new Date(clock += 7).toISOString();
const json = (route, status, body) => route.fulfill({ status, contentType: "application/json", body: body === undefined ? "" : JSON.stringify(body) });
const issue = (u) => {
  const access_token = `at-${randomUUID()}`, refresh_token = `rt-${randomUUID()}`;
  db.tokens.set(access_token, u.id); db.refresh.set(refresh_token, u.id);
  return { access_token, refresh_token, token_type: "bearer", expires_in: db.ttl, expires_at: Math.floor(Date.now() / 1000) + db.ttl, user: { id: u.id, email: u.email } };
};
const userOf = (req) => db.tokens.get((req.headers()["authorization"] ?? "").replace(/^Bearer /, ""));

async function supabase(route) {
  const req = route.request(), url = new URL(req.url()), path = url.pathname, method = req.method();
  if (db.down) return route.abort("internetdisconnected");
  if (req.headers()["apikey"] !== KEY) return json(route, 401, { message: "No API key found in request" });
  const body = req.postData() ? JSON.parse(req.postData()) : null;
  if (path === "/auth/v1/signup") {
    if ([...db.users.values()].some((u) => u.email === body.email)) return json(route, 422, { code: 422, error_code: "user_already_exists", msg: "User already registered" });
    const u = { id: randomUUID(), email: body.email, password: body.password, confirmed: !db.confirm };
    db.users.set(u.id, u);
    return json(route, 200, u.confirmed ? issue(u) : { id: u.id, email: u.email });
  }
  if (path === "/auth/v1/token" && url.searchParams.get("grant_type") === "password") {
    const u = [...db.users.values()].find((x) => x.email === body.email && x.password === body.password);
    if (!u) return json(route, 400, { code: 400, error_code: "invalid_credentials", msg: "Invalid login credentials" });
    if (!u.confirmed) return json(route, 400, { code: 400, error_code: "email_not_confirmed", msg: "Email not confirmed" });
    return json(route, 200, issue(u));
  }
  if (path === "/auth/v1/token" && url.searchParams.get("grant_type") === "refresh_token") {
    db.refreshCalls++;
    const id = db.refresh.get(body.refresh_token);
    if (!id) return json(route, 400, { error_code: "refresh_token_not_found", msg: "Invalid Refresh Token" });
    db.refresh.delete(body.refresh_token);
    return json(route, 200, issue(db.users.get(id)));
  }
  if (path === "/auth/v1/recover") return json(route, 200, {});
  if (path === "/auth/v1/logout") { db.tokens.delete((req.headers()["authorization"] ?? "").slice(7)); return route.fulfill({ status: 204 }); }
  const uid = userOf(req);
  if (path === "/auth/v1/user") {
    if (!uid) return json(route, 401, { error_code: "bad_jwt", msg: "invalid JWT" });
    const u = db.users.get(uid);
    if (method === "PUT") { if (body.password === u.password) return json(route, 422, { error_code: "same_password" }); u.password = body.password; }
    return json(route, 200, { id: u.id, email: u.email });
  }
  if (!path.startsWith("/rest/v1/")) return json(route, 404, { message: "not found" });
  if (!uid) return json(route, 401, { code: "PGRST301", message: "JWT required" });
  if (path === "/rest/v1/rpc/delete_my_account") {
    db.users.delete(uid); db.reviews = db.reviews.filter((r) => r.user_id !== uid); db.errors = db.errors.filter((r) => r.user_id !== uid);
    return route.fulfill({ status: 204 });
  }
  const table = path.endsWith("/reviews") ? "reviews" : path.endsWith("/error_entries") ? "errors" : null;
  if (!table) return json(route, 404, { message: "no table" });
  const key = table === "reviews" ? "card_id" : "id";
  if (method === "GET") {
    const since = (url.searchParams.get("updated_at") ?? "").replace(/^gte\./, "");
    const rows = db[table].filter((r) => r.user_id === uid && (!since || r.updated_at >= since)).sort((a, b) => (a.updated_at < b.updated_at ? -1 : 1));
    const off = Number(url.searchParams.get("offset") ?? 0), lim = Number(url.searchParams.get("limit") ?? 1000);
    return json(route, 200, rows.slice(off, off + lim).map(({ user_id, ...r }) => r));
  }
  if (method === "POST") {
    for (const row of body) {
      const old = db[table].find((r) => r.user_id === uid && r[key] === row[key]);
      if (!old) { db[table].push({ ...row, data: row.deleted ? null : row.data, user_id: uid, updated_at: ts() }); continue; }
      if (table === "reviews" && row.rev < old.rev) continue;          // trigger: newest wins
      if (table === "errors" && old.deleted) continue;                 // trigger: deleted stays deleted
      Object.assign(old, row, { data: row.deleted ? null : row.data, updated_at: ts() });
    }
    return route.fulfill({ status: 201 });
  }
  if (method === "DELETE") {
    const f = (url.searchParams.get("user_id") ?? "").replace(/^eq\./, "");
    if (f !== uid) return json(route, 400, { message: "filter required" });
    db[table] = db[table].filter((r) => r.user_id !== uid);
    return route.fulfill({ status: 204 });
  }
  return json(route, 405, {});
}

/* ------------------------------------------------------------------ helpers */
const results = [];
let page;
const errors = [];
const check = async (name, fn) => {
  try { await fn(); results.push(["PASS", name]); } catch (e) {
    results.push(["FAIL", name, e.message.split("\n")[0]]);
    try { await page.screenshot({ path: `test-results/FAIL-acct-${name.replace(/[^a-z0-9]+/gi, "-").slice(0, 40)}.png`, fullPage: true }); } catch {}
  }
};
const browser = await chromium.launch();
const device = async (opts = {}) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: "dark", ...opts });
  await ctx.route(`${SUPA}/**`, supabase);
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("console", (m) => m.type() === "error" && !/Failed to load resource|ERR_INTERNET_DISCONNECTED/.test(m.text()) && errors.push(m.text()));
  return { ctx, p };
};
const ana = JSON.parse(readFileSync(`${OUT}/content/mcq/anaesthesia.json`, "utf8"));
const byStem = (stem) => ana.cards.find((c) => c.stem.trim() === stem.trim());
const ME = "student@example.com", PW = "correct-horse-1";
const mine = (t) => { const u = [...db.users.values()].find((x) => x.email === ME); return u ? db[t].filter((r) => r.user_id === u.id) : []; };

/** Answer the current MCQ wrongly and log it (or mark a recall question wrong). */
async function answerWrong(p) {
  for (let i = 0; i < 20; i++) {
    const c = byStem(await p.locator(".mcq-stem").innerText());
    if (c && c.type === "mcq" && !c.noKey && !c.disputed && c.accepted.length < c.options.length) {
      await p.keyboard.press(c.options.find((o) => !c.accepted.includes(o.key)).key.toLowerCase());
      await p.keyboard.press("Enter");
      await p.keyboard.press("n");
      await p.getByRole("dialog").getByRole("button", { name: "Save to error log" }).click();
      await p.getByRole("status").getByText("Saved to error log").waitFor();
      return c;
    }
    if (c?.type === "mcq" && !c.noKey) { await p.locator(".mcq-opt").first().click(); await p.locator(".verdict").waitFor(); if (await p.locator(".verdict.right").count()) await p.keyboard.press("Enter"); else return answerWrongLogged(p); }
    else { await p.getByRole("button", { name: /Reveal/ }).click(); await p.getByRole("button", { name: /Right/ }).click(); }
    await p.waitForTimeout(150);
  }
  throw new Error("no MCQ found");
}
async function answerWrongLogged(p) {
  await p.keyboard.press("Enter"); await p.keyboard.press("n");
  await p.getByRole("dialog").getByRole("button", { name: "Save to error log" }).click();
  await p.getByRole("status").getByText("Saved to error log").waitFor();
}
const startMcqs = async (p) => {
  await p.goto(BASE + "#/study?subject=anaesthesia&kind=mcq");
  await p.getByRole("button", { name: /^Start/ }).click();
  await p.locator(".mcq-stem").waitFor();
};
const signInForm = async (p, email, pw) => {
  await p.goto(BASE + "#/account");
  await p.getByRole("button", { name: "Sign in", exact: true }).first().waitFor();
  await p.locator("#acct-email").fill(email);
  await p.locator("#acct-pw").fill(pw);
  await p.locator("form").getByRole("button", { name: "Sign in" }).click();
};
const until = async (fn, msg, ms = 10000) => { const t = Date.now(); while (!fn()) { if (Date.now() - t > ms) throw new Error(msg); await new Promise((r) => setTimeout(r, 100)); } };
const upToDate = (p) => p.getByText(/^Up to date/).waitFor({ timeout: 15000 });

try {
  const A = await device();
  page = A.p;
  await check("accounts on: header offers Sign in; Settings has an Account panel", async () => {
    await A.p.goto(BASE);
    await A.p.locator(".acct", { hasText: "Sign in" }).waitFor();
    await A.p.goto(BASE + "#/settings");
    await A.p.getByRole("heading", { name: "Account" }).waitFor();
    await A.p.getByRole("link", { name: "Sign in or create an account" }).click();
    await A.p.getByRole("heading", { name: "Account", level: 1 }).waitFor();
  });

  await check("progress made signed out is uploaded when the account is created", async () => {
    await startMcqs(A.p);
    await answerWrong(A.p);
    await A.p.goto(BASE + "#/account");
    await A.p.getByRole("button", { name: "Create account" }).click();
    await A.p.locator("#acct-email").fill(ME);
    await A.p.locator("#acct-pw").fill("short");
    await A.p.locator("form").getByRole("button", { name: "Create account" }).click();
    await A.p.getByRole("alert").getByText(/at least 8 characters/).waitFor();
    await A.p.locator("#acct-pw").fill(PW);
    await A.p.locator("form").getByRole("button", { name: "Create account" }).click();
    await A.p.getByText(/Account created/).waitFor();
    await upToDate(A.p);
    assert.equal(mine("errors").length, 1, "error entry not uploaded");
    assert.ok(mine("reviews").length >= 1, "review not uploaded");
    await A.p.locator(".acct", { hasText: "Synced" }).waitFor();
    await A.p.screenshot({ path: "test-results/acct-signed-in-desktop-dark.png", fullPage: true });
  });

  await check("each answer syncs a few seconds later", async () => {
    const before = mine("errors").length;
    await startMcqs(A.p);
    await A.p.getByRole("button", { name: /Continue|Start/ }).first().click().catch(() => {});
    await answerWrong(A.p);
    await until(() => mine("errors").length === before + 1, "answer not uploaded within 10 s");
  });

  const B = await device({ colorScheme: "light" });
  page = B.p;
  await check("second device: wrong password is refused; right password brings the progress over", async () => {
    await signInForm(B.p, ME, "nope-nope-nope");
    await B.p.getByRole("alert").getByText("Wrong email or password.").waitFor();
    await signInForm(B.p, ME, PW);
    await upToDate(B.p);
    await B.p.goto(BASE + "#/log");
    await B.p.locator(".log-row").nth(1).waitFor();
    assert.equal(await B.p.locator(".log-row").count(), 2);
    await B.p.goto(BASE + "#/review?subject=anaesthesia");
    await B.p.locator(".review-list li").first().waitFor();
  });

  await check("deleting an entry on one device removes it on the other", async () => {
    await B.p.goto(BASE + "#/log");
    await B.p.locator(".log-row").first().click();
    await B.p.getByRole("button", { name: "Delete entry" }).click();
    await B.p.getByRole("button", { name: "Delete", exact: true }).click();
    await B.p.waitForFunction(() => document.querySelector(".acct")?.textContent === "Synced" && document.querySelectorAll(".log-row").length === 1, null, { timeout: 15000 });
    await B.p.waitForTimeout(3500);
    assert.equal(mine("errors").filter((e) => e.deleted).length, 1, "tombstone not pushed");
    page = A.p;
    await A.p.goto(BASE + "#/account");
    await A.p.getByRole("button", { name: "Sync now" }).click();
    await upToDate(A.p);
    await A.p.goto(BASE + "#/log");
    await A.p.waitForFunction(() => document.querySelectorAll(".log-row").length === 1);
  });

  await check("offline: answers are kept and sync when the connection returns", async () => {
    page = A.p;
    db.down = true;
    const before = mine("errors").length;
    await startMcqs(A.p);
    await A.p.getByRole("button", { name: /Continue|Start/ }).first().click().catch(() => {});
    await answerWrong(A.p);
    await A.p.locator(".acct", { hasText: "Offline" }).waitFor({ timeout: 15000 });
    assert.equal(mine("errors").length, before);
    db.down = false;
    await A.p.evaluate(() => window.dispatchEvent(new Event("online")));
    await A.p.locator(".acct", { hasText: "Synced" }).waitFor({ timeout: 15000 });
    assert.equal(mine("errors").length, before + 1);
  });

  await check("an expiring session is refreshed without asking the student", async () => {
    db.ttl = 30;                       // under the app's 60 s margin → every call refreshes first
    await signInForm(B.p, ME, PW).catch(() => {});
    page = B.p;
    await B.p.goto(BASE + "#/account");
    await B.p.getByRole("button", { name: "Sign out" }).click();
    await B.p.getByText(/Signed out/).waitFor();
    await signInForm(B.p, ME, PW);
    await upToDate(B.p);
    const n = db.refreshCalls;
    await B.p.getByRole("button", { name: "Sync now" }).click();
    await upToDate(B.p);
    assert.ok(db.refreshCalls > n, "no refresh call");
    db.ttl = 3600;
  });

  await check("sign out can remove progress from a shared device; signing in brings it back", async () => {
    await B.p.goto(BASE + "#/account");
    await B.p.getByLabel(/Also remove my progress/).check();
    await B.p.getByRole("button", { name: "Sign out" }).click();
    await B.p.getByText("Signed out and removed your progress from this device.").waitFor();
    await B.p.goto(BASE + "#/log");
    await B.p.getByText("Your error log is empty").waitFor();
    await signInForm(B.p, ME, PW);
    await upToDate(B.p);
    await B.p.goto(BASE + "#/log");
    await B.p.locator(".log-row").first().waitFor();
  });

  await check("another account on the same device must choose: add or remove the old progress", async () => {
    await B.p.goto(BASE + "#/account");
    await B.p.getByRole("button", { name: "Sign out" }).click();
    await B.p.getByText(/Signed out\. Your progress stays/).waitFor();
    db.confirm = false;
    await B.p.getByRole("button", { name: "Create account" }).click();
    await B.p.locator("#acct-email").fill("friend@example.com");
    await B.p.locator("#acct-pw").fill("friend-password");
    await B.p.locator("form").getByRole("button", { name: "Create account" }).click();
    await B.p.getByRole("heading", { name: "This device has someone else's progress" }).waitFor({ timeout: 15000 });
    await B.p.getByText(ME).first().waitFor();
    await B.p.locator(".acct", { hasText: "Sync paused" }).waitFor();
    await B.p.screenshot({ path: "test-results/acct-choose-desktop-light.png", fullPage: true });
    await B.p.getByRole("button", { name: "Remove it from this device" }).click();
    await upToDate(B.p);
    await B.p.goto(BASE + "#/log");
    await B.p.getByText("Your error log is empty").waitFor();
    const friend = [...db.users.values()].find((u) => u.email === "friend@example.com");
    assert.equal(db.errors.filter((e) => e.user_id === friend.id).length, 0, "old progress leaked into the new account");
  });

  await check("email links: confirm sign-up and reset password land on the Account page", async () => {
    const C = await device();
    page = C.p;
    db.confirm = true;
    await C.p.goto(BASE + "#/account");
    await C.p.getByRole("button", { name: "Create account" }).click();
    await C.p.locator("#acct-email").fill("new@example.com");
    await C.p.locator("#acct-pw").fill("new-password-1");
    await C.p.locator("form").getByRole("button", { name: "Create account" }).click();
    await C.p.getByText(/we sent a confirmation link to new@example.com/).waitFor();
    await signInForm(C.p, "new@example.com", "new-password-1");
    await C.p.getByRole("alert").getByText(/Confirm your email first/).waitFor();
    const u = [...db.users.values()].find((x) => x.email === "new@example.com");
    u.confirmed = true;
    const s = issue(u);
    await C.p.goto(`${BASE}#access_token=${s.access_token}&expires_at=${s.expires_at}&expires_in=3600&refresh_token=${s.refresh_token}&token_type=bearer&type=signup`);
    await C.p.getByText("Email confirmed – you're signed in.").waitFor();
    assert.equal(new URL(C.p.url()).hash, "#/account", "tokens left in the address bar");
    await C.p.getByRole("button", { name: /Forgot/ }).count();
    const r = issue(u);
    await C.p.goto(`${BASE}#access_token=${r.access_token}&expires_in=3600&refresh_token=${r.refresh_token}&type=recovery`);
    await C.p.getByRole("heading", { name: "Set a new password" }).waitFor();
    await C.p.locator("#new-pw").fill("brand-new-pass");
    await C.p.getByRole("button", { name: "Save password" }).click();
    await C.p.getByText("Password saved – you're signed in.").waitFor();
    assert.equal(u.password, "brand-new-pass");
    await C.p.goto(`${BASE}#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired`);
    await C.p.getByRole("alert").getByText(/expired or was already used/).waitFor();
    await C.ctx.close();
  });

  await check("Delete everything (signed in) also clears the account; Delete account removes the user", async () => {
    page = A.p;
    await A.p.goto(BASE + "#/settings");
    await A.p.getByRole("button", { name: "Delete all progress on this device…" }).click();
    await A.p.getByText(/and from your account\?/).waitFor();
    await A.p.getByRole("button", { name: "Delete everything" }).click();
    await A.p.getByText("All progress deleted from this device and your account.").waitFor();
    assert.equal(mine("reviews").length + mine("errors").length, 0);
    await A.p.goto(BASE + "#/account");
    await A.p.getByRole("button", { name: "Delete my account…" }).click();
    await A.p.getByRole("button", { name: "Delete account", exact: true }).click();
    await A.p.getByText("Your account has been deleted.").waitFor();
    assert.ok(![...db.users.values()].some((u) => u.email === ME));
    await A.p.locator(".acct", { hasText: "Sign in" }).waitFor();
  });
  await A.ctx.close(); await B.ctx.close();

  for (const scheme of ["light", "dark"]) {
    const P = await device({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: scheme });
    page = P.p;
    await check(`phone ${scheme}: account page and header chip fit`, async () => {
      await P.p.goto(BASE + "#/account");
      await P.p.locator("#acct-email").waitFor();
      const over = await P.p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      assert.ok(over <= 0, `${over}px too wide`);
      await P.p.screenshot({ path: `test-results/acct-phone-${scheme}.png`, fullPage: true });
      await P.p.locator("#acct-email").fill(`phone-${scheme}@example.com`);
      await P.p.getByRole("button", { name: "Create account" }).tap();
      await P.p.locator("#acct-pw").fill("phone-password");
      db.confirm = false;
      await P.p.locator("form").getByRole("button", { name: "Create account" }).tap();
      await upToDate(P.p);
      await P.p.goto(BASE);
      await P.p.locator(".acct", { hasText: "Synced" }).waitFor();
      const over2 = await P.p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      assert.ok(over2 <= 0, `home ${over2}px too wide`);
      await P.p.screenshot({ path: `test-results/acct-home-phone-${scheme}.png` });
      await P.p.goto(BASE + "#/account");
      await P.p.getByRole("button", { name: "Sign out" }).tap();
      await P.p.getByText(/Signed out/).waitFor();
    });
    await P.ctx.close();
  }
  await check("no console errors", async () => assert.deepEqual(errors, []));
} finally {
  await browser.close();
  server.kill();
}
for (const [s, n, m] of results) console.log(`${s}  ${n}${m ? "  " + m : ""}`);
const failed = results.filter((r) => r[0] === "FAIL").length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
