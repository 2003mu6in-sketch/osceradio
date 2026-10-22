// V2 end-to-end checks (npm run e2e): subjects, MCQ player, cause sheet, photos, notes,
// V1 backup into V2, and screenshots of the new screens at phone and desktop width.
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";

const PORT = 4181, BASE = `http://localhost:${PORT}/`;
const mcq = (s) => JSON.parse(readFileSync(`dist/content/mcq/${s}.json`, "utf8"));
const server = spawn(process.execPath, ["scripts/serve.mjs", "dist", String(PORT)], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 600));
mkdirSync("test-results", { recursive: true });

const results = [];
let page;
const check = async (name, fn) => {
  try { await fn(); results.push(["PASS", name]); } catch (e) {
    results.push(["FAIL", name, e.message.split("\n")[0]]);
    try { await page.screenshot({ path: `test-results/FAIL-v2-${name.replace(/[^a-z0-9]+/gi, "-").slice(0, 40)}.png` }); } catch {}
  }
};
const errors = [];
const browser = await chromium.launch();
const ana = mcq("anaesthesia");
const byStem = (bank, stem) => bank.cards.find((c) => c.stem.trim() === stem.trim());

try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: "dark" });
  page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));

  await check("home: subject tabs switch the page and are remembered", async () => {
    await page.goto(BASE);
    await page.getByRole("heading", { name: "Radiology OSCE & MCQ practice" }).waitFor();
    await page.getByRole("tab", { name: "Anaesthesia" }).click();
    await page.getByRole("heading", { name: "Anaesthesia OSCE & MCQ practice" }).waitFor();
    assert.equal(await page.locator(".hero-stats div", { hasText: "MCQs" }).locator("b").innerText(), String(ana.cards.length));
    await page.reload();
    await page.getByRole("heading", { name: "Anaesthesia OSCE & MCQ practice" }).waitFor();
    assert.equal(await page.getByRole("tab", { name: "Anaesthesia" }).getAttribute("aria-selected"), "true");
    await page.screenshot({ path: "test-results/v2-home-desktop-dark.png", fullPage: true });
  });

  let first;
  await check("mcq: tapping the right option marks it right; Next moves on", async () => {
    await page.locator("section[aria-labelledby=papers-mcq] .paper").first().click();
    await page.getByRole("button", { name: /^Start \d+ questions?$/ }).click();
    await page.locator(".mcq-stem").waitFor();
    first = byStem(ana, await page.locator(".mcq-stem").innerText());
    assert.ok(first, "stem not found in the bank");
    assert.equal(await page.locator(".verdict").count(), 0, "answer shown before choosing");
    if (first.type !== "mcq" || first.noKey) return; // first item in this paper is not a keyed MCQ – covered below
    await page.locator(".mcq-opt").nth(first.options.findIndex((o) => o.key === first.correct[0])).click();
    await page.locator(".verdict.right").waitFor();
    await page.screenshot({ path: "test-results/v2-mcq-right-desktop-dark.png", fullPage: true });
    await page.getByRole("button", { name: /^Next/ }).click();
    await page.waitForFunction(() => document.querySelector(".study-head .count")?.textContent?.startsWith("2/"));
  });

  await check("mcq: a wrong option shows the key; logging needs a cause; entry lands in the log", async () => {
    // find the next keyed, undisputed MCQ in this set and answer it wrongly by keyboard
    for (let i = 0; i < 30; i++) {
      const c = byStem(ana, await page.locator(".mcq-stem").innerText());
      if (c && c.type === "mcq" && !c.noKey && !c.disputed && c.accepted.length < c.options.length) {
        const wrong = c.options.find((o) => !c.accepted.includes(o.key));
        await page.keyboard.press(wrong.key.toLowerCase());
        await page.locator(".verdict.wrong").waitFor();
        assert.equal(await page.locator(".mcq-opt.correct").count() >= 1, true, "key not highlighted");
        await page.screenshot({ path: "test-results/v2-mcq-wrong-desktop-dark.png", fullPage: true });
        await page.keyboard.press("Enter");
        const dlg = page.getByRole("dialog", { name: "Why did you get it wrong?" });
        await dlg.waitFor();
        assert.equal(await dlg.getByRole("button", { name: "Save to error log" }).isDisabled(), true);
        await page.keyboard.press("t");
        await dlg.getByRole("button", { name: "Save to error log" }).click();
        await page.getByRole("status").getByText("Saved to error log").waitFor();
        await page.goto(BASE + "#/log");
        await page.getByRole("heading", { name: "Your MCQ mistakes" }).waitFor();
        await page.locator(".log-row").first().waitFor();
        assert.match(await page.locator(".log-row").first().innerText(), /Narrowed to two/);
        await page.screenshot({ path: "test-results/v2-log-desktop-dark.png", fullPage: true });
        return;
      }
      if (c?.type === "mcq" && !c.noKey) { await page.locator(".mcq-opt").first().click(); await page.locator(".verdict").waitFor(); await page.keyboard.press("Enter");
        if (await page.getByRole("dialog").count()) { await page.keyboard.press("Escape"); await page.locator(".mcq-opt").first().waitFor(); throw new Error("unexpected dialog"); } }
      else { await page.getByRole("button", { name: /Reveal/ }).click(); await page.getByRole("button", { name: /Right/ }).click(); }
      await page.waitForTimeout(150);
    }
    throw new Error("no keyed MCQ found in 30 questions");
  });

  await check("review: the MCQ is scheduled 48 h ahead in the Anaesthesia list", async () => {
    await page.goto(BASE + "#/review?subject=anaesthesia");
    await page.getByRole("heading", { name: "Review · Anaesthesia" }).waitFor();
    await page.locator(".review-list li").first().waitFor();
    assert.match(await page.locator(".review-list li").first().innerText(), /Anaesthesia · MCQ/);
  });

  await check("browse: MCQ list per subject; card page shows the key on request", async () => {
    await page.goto(BASE + "#/browse?subject=ent&kind=mcq");
    await page.locator(".mcq-list li a").first().click();
    await page.getByRole("button", { name: "Show answer" }).click();
    await page.locator(".verdict.neutral").waitFor();
  });

  await check("notes and paper photos open for the subjects that have them", async () => {
    const withPhotos = ["radiology", "anaesthesia", "ophthalmology", "ent"].find((s) => mcq(s).photoCards.length);
    await page.goto(BASE + `#/study?subject=${withPhotos}&kind=photo`);
    await page.getByRole("button", { name: /^Start/ }).click();
    await page.getByRole("button", { name: "Reveal the key" }).click();
    await page.locator(".mark-bar").waitFor();
    await page.goto(BASE + "#/notes/ophthalmology");
    await page.getByRole("heading", { name: "Revision notes", level: 1 }).waitFor();
    assert.ok(await page.locator("section.panel").count() > 0);
  });
  await ctx.close();

  // ---------- a V1 backup file imports into V2 unchanged ----------
  const bctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: "light" });
  page = await bctx.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await check("backup: a V1 file imports; its entries show as Radiology OSCE", async () => {
    const T = Date.UTC(2026, 9, 1);
    writeFileSync("test-results/v1-backup.json", JSON.stringify({ app: "osce-trainer", schemaVersion: 1, exportedAt: T,
      reviews: [{ cardId: "70W-Q04", stage: 1, dueAt: T + 48 * 3600e3, seen: 1, rights: 0, misses: 1, lastResult: "wrong", lastSeenAt: T }],
      errors: [{ id: "v1a", cardId: "70W-Q04", createdAt: T, tags: ["missed-finding"], rootCause: "image-familiarity", note: "from V1" }], session: null }));
    await page.goto(BASE + "#/settings");
    await page.setInputFiles("#import-file", "test-results/v1-backup.json");
    await page.getByText("Adds 1 error log entry, progress on 1 new question.").waitFor();
    await page.getByRole("button", { name: "Import", exact: true }).click();
    await page.getByText(/^Imported/).waitFor();
    await page.goto(BASE + "#/log");
    await page.getByRole("heading", { name: "Your OSCE picture mistakes" }).waitFor();
    assert.match(await page.locator(".log-row").first().innerText(), /Image familiarity/);
    await page.screenshot({ path: "test-results/v2-log-desktop-light.png", fullPage: true });
  });
  await bctx.close();

  // ---------- per-subject offline pictures ----------
  const octx = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: "dark" });
  page = await octx.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await check("offline: saving ENT pictures makes ENT OSCE pictures load with no network", async () => {
    const entIds = JSON.parse(readFileSync("dist/content/images.json", "utf8")).ent;
    await page.goto(BASE + "#/settings");
    await page.waitForFunction(() => !!navigator.serviceWorker.controller || (navigator.serviceWorker.ready.then(() => location.reload()), false));
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    await page.getByRole("button", { name: "Save ENT pictures for offline use" }).click();
    await page.getByText(`All ${entIds.length} pictures saved`).waitFor({ timeout: 60000 });
    await page.screenshot({ path: "test-results/v2-settings-offline.png", fullPage: true });
    await octx.setOffline(true);
    const entCard = JSON.parse(readFileSync("dist/content/osce/ent.json", "utf8")).cards.find((c) => c.images.length);
    await page.goto(BASE + `#/card/${entCard.id}`);
    await page.locator(".film img").first().waitFor();
    const ok = await page.locator(".film img").first().evaluate(async (img) => { if (!img.complete) await new Promise((r) => (img.onload = img.onerror = r)); return img.naturalWidth > 0; });
    assert.ok(ok, "ENT picture did not load offline");
    await octx.setOffline(false);
  });
  await octx.close();

  // ---------- phone width, both themes ----------
  for (const scheme of ["light", "dark"]) {
    const ph = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: scheme });
    page = await ph.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    await check(`phone ${scheme}: home, MCQ, cause sheet, browse and notes fit the screen`, async () => {
      const fits = async (what) => {
        const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        assert.ok(over <= 0, `${what}: ${over}px too wide`);
      };
      await page.goto(BASE);
      await page.getByRole("tab", { name: "Ophthalmology" }).click();
      await page.getByRole("heading", { name: "Ophthalmology OSCE & MCQ practice" }).waitFor();
      await fits("home"); await page.screenshot({ path: `test-results/v2-home-phone-${scheme}.png`, fullPage: true });
      await page.goto(BASE + "#/study?subject=ophthalmology&kind=mcq");
      await page.getByRole("button", { name: /^Start/ }).click();
      await page.locator(".mcq-stem, .stem").first().waitFor();
      await fits("mcq"); await page.screenshot({ path: `test-results/v2-mcq-phone-${scheme}.png`, fullPage: true });
      if (await page.locator(".mcq-opt").count()) {
        await page.locator(".mcq-opt").last().tap();
        await page.locator(".verdict").waitFor();
        await fits("mcq answered"); await page.screenshot({ path: `test-results/v2-mcq-answered-phone-${scheme}.png`, fullPage: true });
        const log = page.getByRole("button", { name: /Log it and go on/ });
        if (await log.count()) { await log.tap(); await page.getByRole("dialog").waitFor(); await fits("cause sheet");
          await page.screenshot({ path: `test-results/v2-cause-phone-${scheme}.png` }); await page.getByRole("button", { name: "Cancel" }).tap(); }
      }
      for (const route of ["#/browse?subject=ent&kind=mcq", "#/notes/ophthalmology", "#/review", "#/log", "#/about"]) {
        await page.goto(BASE + route); await page.waitForTimeout(400); await fits(route);
      }
      await page.goto(BASE + "#/notes/ophthalmology"); await page.waitForTimeout(400);
      await page.screenshot({ path: `test-results/v2-notes-phone-${scheme}.png`, fullPage: true });
    });
    await ph.close();
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
