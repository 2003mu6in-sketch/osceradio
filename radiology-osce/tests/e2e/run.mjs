// End-to-end checks against the production build (npm run e2e).
// Covers: content loads, browse & filters, card reveal, zoom viewer, settings persist,
// full offline use (every image served by the service worker), no sideways scroll on phones.
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";

const PORT = 4179, BASE = `http://localhost:${PORT}/`;
const bank = JSON.parse(readFileSync("dist/content/cards.json", "utf8"));
const server = spawn(process.execPath, ["scripts/serve.mjs", "dist", String(PORT)], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 600));
mkdirSync("test-results", { recursive: true });

const results = [];
let page;
const check = async (name, fn) => {
  try { await fn(); results.push(["PASS", name]); } catch (e) {
    results.push(["FAIL", name, e.message.split("\n")[0]]);
    try { await page.screenshot({ path: `test-results/FAIL-${name.replace(/[^a-z0-9]+/gi, "-").slice(0, 40)}.png` }); } catch {}
  }
};

const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, colorScheme: "dark" });
  page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

  await check("home loads the question bank", async () => {
    await page.goto(BASE);
    await page.getByRole("heading", { name: "Radiology OSCE practice" }).waitFor();
    assert.equal(await page.locator(".hero-stats b").first().innerText(), String(bank.cards.length));
    assert.equal(await page.locator(".paper").count(), bank.sections.length);
    await page.screenshot({ path: "test-results/home-desktop-dark.png" });
  });

  await check("browse shows every question and filters by paper", async () => {
    await page.goto(BASE + "#/browse");
    await page.locator(".tile").first().waitFor();
    assert.equal(await page.locator(".tile").count(), bank.cards.length);
    await page.selectOption("#f-section", "2021");
    const n2021 = bank.cards.filter((c) => c.inSections.includes("2021")).length;
    await page.waitForFunction((n) => document.querySelectorAll(".tile").length === n, n2021);
    await page.fill("#f-q", "achalasia");
    await page.waitForFunction(() => document.querySelectorAll(".tile").length <= 3);
    await page.screenshot({ path: "test-results/browse-desktop-dark.png" });
  });

  await check("card hides the answer until revealed; viewer opens and closes", async () => {
    await page.goto(BASE + "#/card/70W-Q04");
    await page.getByRole("button", { name: "Show answer" }).waitFor();
    assert.equal(await page.getByText("Inverted coffee bean sign").count(), 0);
    await page.getByRole("button", { name: "Show answer" }).click();
    await page.getByText("Inverted coffee bean sign").waitFor();
    await page.screenshot({ path: "test-results/card-desktop-dark.png" });
    await page.getByRole("button", { name: "Enlarge image 1" }).click();
    await page.getByRole("dialog", { name: "Image viewer" }).waitFor();
    await page.keyboard.press("Escape");
    assert.equal(await page.getByRole("dialog").count(), 0);
  });

  await check("theme setting is saved across reloads", async () => {
    await page.goto(BASE + "#/settings");
    await page.getByRole("button", { name: "Light" }).click();
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "light");
    await page.reload();
    await page.getByRole("heading", { name: "Settings" }).waitFor();
    await page.waitForFunction(() => document.documentElement.dataset.theme === "light");
    await page.getByRole("button", { name: "Match device" }).click();
  });


  // ---------------- phase 3: study flow ----------------
  const n2014 = bank.cards.filter((c) => c.inSections.includes("2014")).length;
  const counter = () => page.locator(".study-head .count").innerText();

  await check("study: start a set; answer hidden until reveal", async () => {
    await page.goto(BASE + "#/study?section=2014");
    await page.getByRole("button", { name: `Start ${n2014} questions` }).click();
    await page.waitForFunction(() => location.hash === "#/study/run");
    assert.equal(await counter(), `1/${n2014}`);
    assert.equal(await page.locator(".mark-bar").count(), 0, "Right/Wrong shown before reveal");
    assert.equal(await page.locator(".panel .crumbs .chip.accent").count(), 0, "modality shown before reveal");
    assert.ok(!(await page.locator(".film img").first().getAttribute("alt")).match(/X-ray|CT|MRI|Ultrasound|IVU|HSG|Barium|Mammo|Angio|RUG/), "modality in alt text");
    await page.fill("#typed", "double bubble");
    await page.getByRole("button", { name: "Reveal answer" }).click();
    await page.locator(".mark-bar").waitFor();
    await page.getByText("Your answer").waitFor();
  });

  await check("study: Right goes to the next question; Undo brings it back", async () => {
    await page.getByRole("button", { name: /Right/ }).click();
    await page.waitForFunction((t) => document.querySelector(".study-head .count")?.textContent === t, `2/${n2014}`);
    await page.getByRole("status").getByText("Marked right").waitFor();
    await page.getByRole("button", { name: "Undo" }).click();
    await page.waitForFunction((t) => document.querySelector(".study-head .count")?.textContent === t, `1/${n2014}`);
    await page.keyboard.press("Space");
    await page.keyboard.press("r");
    await page.waitForFunction((t) => document.querySelector(".study-head .count")?.textContent === t, `2/${n2014}`);
  });

  await check("study: Wrong cannot be saved without an error type AND a root cause", async () => {
    await page.keyboard.press("Space");
    await page.getByRole("button", { name: /Wrong/ }).click();
    const dlg = page.getByRole("dialog", { name: "What went wrong?" });
    await dlg.waitFor();
    const save = dlg.getByRole("button", { name: "Save to error log" });
    assert.equal(await save.isDisabled(), true);
    await dlg.getByRole("button", { name: /Missed a finding/ }).click();
    assert.equal(await save.isDisabled(), true, "saved with tags but no root cause");
    await dlg.getByRole("radio", { name: /Image familiarity/ }).click();
    assert.equal(await save.isDisabled(), false);
    await dlg.locator("#wrong-note").fill("did not look at the posterior fossa");
    await page.screenshot({ path: "test-results/wrong-dialog-desktop.png" });
    await save.click();
    await page.waitForFunction((t) => document.querySelector(".study-head .count")?.textContent === t, `3/${n2014}`);
    await page.getByRole("status").getByText("Saved to error log").waitFor();
  });

  await check("study: keyboard Wrong → Esc cancels without recording", async () => {
    await page.keyboard.press("Space");
    await page.keyboard.press("w");
    await page.getByRole("dialog").waitFor();
    await page.keyboard.press("2"); await page.keyboard.press("a");
    await page.keyboard.press("Escape");
    assert.equal(await page.getByRole("dialog").count(), 0);
    assert.equal(await counter(), `3/${n2014}`);
    await page.locator(".mark-bar").waitFor();
  });

  await check("study: progress survives a reload and resumes", async () => {
    await page.reload();
    await page.waitForFunction((t) => document.querySelector(".study-head .count")?.textContent === t, `3/${n2014}`);
    await page.goto(BASE);
    await page.getByText("Continue: 2014 OSCE").waitFor();
    await page.goto(BASE + "#/log");
    await page.locator(".log-row").first().waitFor();
    assert.equal(await page.locator(".log-row").count(), 1);
    await page.getByText("did not look at the posterior fossa").waitFor();
    await page.getByText("Image familiarity").first().waitFor();
  });

  await check("study: finishing shows a summary and retries the wrong ones", async () => {
    await page.goto(BASE + "#/study/run");
    for (let i = 3; i <= n2014; i++) {
      await page.waitForFunction((t) => document.querySelector(".study-head .count")?.textContent === t, `${i}/${n2014}`);
      await page.keyboard.press("Space");
      await page.locator(".mark-bar").waitFor();
      await page.keyboard.press("r");
    }
    await page.getByText("Session complete").waitFor();
    await page.screenshot({ path: "test-results/summary-desktop.png" });
    await page.getByRole("button", { name: "Retry the 1 I got wrong now" }).click();
    await page.waitForFunction(() => document.querySelector(".study-head .count")?.textContent === "1/1");
  });

  // ---------------- phase 4: spaced review with a fake clock ----------------
  const tctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, colorScheme: "dark" });
  const tp = await tctx.newPage();
  tp.on("pageerror", (e) => errors.push(e.message));
  await tp.clock.install({ time: new Date("2026-10-01T08:00:00Z") });
  const markWrongFirst = async () => {
    await tp.goto(BASE + "#/study?section=2015");
    await tp.getByRole("button", { name: /^Start/ }).click();
    await tp.getByRole("button", { name: "Reveal answer" }).click();
    await tp.getByRole("button", { name: /Wrong/ }).click();
    const dlg = tp.getByRole("dialog");
    await dlg.getByRole("button", { name: /Wrong diagnosis/ }).click();
    await dlg.getByRole("radio", { name: /Knowledge application/ }).click();
    await dlg.getByRole("button", { name: "Save to error log" }).click();
    await tp.waitForFunction(() => document.querySelector(".study-head .count")?.textContent?.startsWith("2/"));
  };
  const stat = (label) => tp.locator(".hero-stats div", { hasText: label }).locator("b").innerText();

  await check("review: a wrong answer is scheduled 48 h ahead, not due yet", async () => {
    await markWrongFirst();
    await tp.goto(BASE + "#/review");
    await tp.getByText("Nothing due").waitFor();
    await tp.getByText("Your next review is in 2 days.").waitFor();
    assert.equal(await stat("coming up"), "1");
    assert.equal(await tp.locator(".nav .badge").count(), 0);
  });

  await check("review: after 49 h it is due – badge, home tile and review list", async () => {
    await tp.clock.fastForward(49 * 3600_000);
    await tp.getByRole("heading", { name: "Due now" }).waitFor();
    assert.equal(await stat("due now"), "1");
    assert.equal(await tp.getByText("Cervical insufficiency").count(), 0, "review list gives the diagnosis away");
    await tp.locator(".nav .badge", { hasText: "1" }).waitFor();
    await tp.screenshot({ path: "test-results/review-due-desktop.png" });
    await tp.goto(BASE);
    await tp.getByText("Review due: 1").waitFor();
  });

  await check("review: right when due → 2nd review in 72 h", async () => {
    await tp.goto(BASE + "#/review");
    await tp.getByRole("button", { name: "Start review (1)" }).click();
    await tp.getByText("1st review · due").waitFor();
    await tp.getByRole("button", { name: "Reveal answer" }).click();
    await tp.getByRole("button", { name: /Right/ }).click();
    await tp.getByText("Session complete").waitFor();
    await tp.goto(BASE + "#/review");
    await tp.getByText("Nothing due").waitFor();
    await tp.getByText("Your next review is in 3 days.").waitFor();
    await tp.locator(".review-list").getByText("2nd review").waitFor();
  });

  await check("review: right again after 73 h → mastered", async () => {
    await tp.clock.fastForward(73 * 3600_000);
    await tp.getByRole("button", { name: "Start review (1)" }).click();
    await tp.getByText("2nd review · due").waitFor();
    await tp.getByRole("button", { name: "Reveal answer" }).click();
    await tp.getByRole("button", { name: /Right/ }).click();
    await tp.getByText("Session complete").waitFor();
    await tp.goto(BASE + "#/review");
    assert.equal(await stat("mastered"), "1");
    assert.equal(await stat("due now"), "0");
    assert.equal(await stat("coming up"), "0");
  });
  await tctx.close();

  // ---------------- phase 5: error log & insights (seeded like tests/unit/insights.test.ts) ----------------
  const lctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: "dark" });
  const lp = await lctx.newPage();
  lp.on("pageerror", (e) => errors.push(e.message));
  await check("log: insights from six seeded mistakes match the hand-worked fixture", async () => {
    await lp.goto(BASE + "#/log");
    await lp.getByText("Your error log is empty").waitFor();
    await lp.evaluate(async () => {
      const db = await new Promise((res, rej) => { const r = indexedDB.open("osce-trainer", 1); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
      const t = db.transaction(["errors", "reviews"], "readwrite");
      const E = (id, cardId, rootCause, tags, at) => ({ id, cardId, rootCause, tags, createdAt: at });
      [ E("e1", "2015-Q01", "image-familiarity", ["missed-finding"], 1),
        E("e2", "2015-Q02", "image-familiarity", ["missed-finding", "wrong-modality"], 2),
        E("e3", "2015-Q01", "image-familiarity", ["misread-finding"], 3),
        E("e4", "70W-Q04", "knowledge-application", ["wrong-diagnosis"], 4),
        E("e5", "70W-Q18", "image-familiarity", ["missed-finding"], 5),
        E("e6", "70W-Q04", "never-learnt", ["unknown-sign"], 6),
      ].forEach((e) => t.objectStore("errors").put({ ...e, createdAt: Date.UTC(2026, 9, 1) + e.createdAt * 3600e3, note: e.id === "e6" ? "never heard of the coffee bean sign" : undefined }));
      [ { cardId: "2015-Q01", stage: 1, dueAt: Date.now() + 1e8, seen: 3, rights: 1, misses: 2 },
        { cardId: "2015-Q02", stage: 1, dueAt: Date.now() + 1e8, seen: 1, rights: 0, misses: 1 },
        { cardId: "70W-Q04", stage: 1, dueAt: Date.now() + 1e8, seen: 4, rights: 2, misses: 2 },
        { cardId: "70W-Q18", stage: 1, dueAt: Date.now() + 1e8, seen: 2, rights: 1, misses: 1 },
      ].forEach((r) => t.objectStore("reviews").put(r));
      await new Promise((res) => (t.oncomplete = res));
    });
    await lp.reload();
    await lp.getByRole("heading", { name: "What your mistakes say" }).waitFor();
    const v = await lp.locator(".verdicts li").allInnerTexts();
    assert.equal(v[0], "Most of your misses (4 of 6) are image familiarity: you are not yet reading these images confidently. Look at more normal and abnormal Ultrasound images before revising the theory.");
    assert.equal(v[1], "Ultrasound: mostly image familiarity (3 of 3).");
    assert.equal(v[2], "Your most common error type is “missed a finding” (3 of 6 entries).");
    assert.deepEqual(await lp.locator(".mod-rows .mod-name").allInnerTexts(), ["Ultrasound", "X-ray", "CT"]);
    const rates = await lp.locator(".ins-card", { hasText: "Miss rate" }).locator("tbody tr").allInnerTexts();
    assert.equal(rates.length, 2, "CT has only 2 attempts");
    assert.match(rates[0], /Ultrasound\s+4\s+3\s+75%/);
    await lp.screenshot({ path: "test-results/log-desktop-dark.png", fullPage: true });
  });

  await check("log: table view, filters and modality drill-down", async () => {
    await lp.getByRole("button", { name: "Show as table" }).click();
    assert.match(await lp.locator("table.data").first().locator("tbody tr").first().innerText(), /Ultrasound\s+3\s+0\s+0\s+3/);
    await lp.getByRole("button", { name: "Show chart" }).click();
    await lp.selectOption("#lf-cause", "knowledge-application");
    await lp.waitForFunction(() => document.querySelectorAll(".log-row").length === 1);
    await lp.getByRole("link", { name: "Clear filters" }).first().click();
    await lp.waitForFunction(() => document.querySelectorAll(".log-row").length === 6);
    await lp.locator(".mod-name", { hasText: "Ultrasound" }).click();
    await lp.waitForFunction(() => document.querySelectorAll(".log-row").length === 3);
    await lp.fill("#lf-q", "coffee");
    await lp.waitForFunction(() => document.querySelectorAll(".log-row").length === 0);
  });

  await check("log: entry detail shows history; delete needs a confirm", async () => {
    await lp.goto(BASE + "#/log/e3");
    await lp.getByText("All mistakes on this question (2)").waitFor();
    await lp.getByRole("button", { name: "Delete entry" }).click();
    await lp.getByText("Delete this entry? Its review schedule stays.").waitFor();
    await lp.getByRole("button", { name: "Keep" }).click();
    await lp.getByRole("button", { name: "Delete entry" }).click();
    await lp.getByRole("button", { name: "Delete", exact: true }).click();
    await lp.waitForFunction(() => location.hash.startsWith("#/log") && document.querySelectorAll(".log-row").length === 5);
    await lp.goto(BASE + "#/log/e1");
    await lp.getByRole("button", { name: "Study this question again" }).click();
    await lp.waitForFunction(() => document.querySelector(".study-head .count")?.textContent === "1/1");
  });

  await check("log: phone layout fits, light theme", async () => {
    const ph = await browser.newContext({ viewport: { width: 375, height: 800 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: "light" });
    const pg = await ph.newPage();
    await pg.goto(BASE + "#/log");
    await pg.evaluate(async () => {
      const db = await new Promise((res) => { const r = indexedDB.open("osce-trainer", 1); r.onsuccess = () => res(r.result); });
      const t = db.transaction(["errors"], "readwrite");
      [["a", "2015-Q01", "image-familiarity"], ["b", "70W-Q04", "knowledge-application"], ["c", "70W-Q18", "never-learnt"], ["d", "2015-Q02", "image-familiarity"]]
        .forEach(([id, cardId, rootCause], i) => t.objectStore("errors").put({ id, cardId, rootCause, tags: ["missed-finding"], createdAt: 1e12 + i }));
      await new Promise((res) => (t.oncomplete = res));
    });
    await pg.reload();
    await pg.getByRole("heading", { name: "What your mistakes say" }).waitFor();
    const over = await pg.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(over <= 0, `log page ${over}px too wide`);
    await pg.screenshot({ path: "test-results/log-phone-light.png", fullPage: true });
    await ph.close();
  });
  await lctx.close();

  // ---------------- phase 6: backup, CSV, import, reset, reminder ----------------
  const bctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: "light", acceptDownloads: true });
  const bp = await bctx.newPage();
  bp.on("pageerror", (e) => errors.push(e.message));
  const T0 = Date.UTC(2026, 9, 5, 9, 0, 0);
  await bp.clock.install({ time: T0 });
  const dump = () => bp.evaluate(async () => {
    const db = await new Promise((res) => { const r = indexedDB.open("osce-trainer", 1); r.onsuccess = () => res(r.result); });
    const all = (s) => new Promise((res) => { const q = db.transaction(s).objectStore(s).getAll(); q.onsuccess = () => res(q.result); });
    const by = (k) => (a, b) => (a[k] < b[k] ? -1 : 1);
    return { reviews: (await all("reviews")).sort(by("cardId")), errors: (await all("errors")).sort(by("id")) };
  });
  let before;
  await check("backup: reminder appears after a day of use, not before", async () => {
    await bp.goto(BASE);
    await bp.getByRole("heading", { name: "Radiology OSCE practice" }).waitFor();
    await bp.evaluate(async (t) => {
      const db = await new Promise((res) => { const r = indexedDB.open("osce-trainer", 1); r.onsuccess = () => res(r.result); });
      const tx = db.transaction(["errors", "reviews"], "readwrite");
      tx.objectStore("errors").put({ id: "x1", cardId: "70W-Q04", rootCause: "never-learnt", tags: ["unknown-sign"], createdAt: t - 7200e3, note: 'said "double bubble", oops', typedAnswer: "small bowel obstruction" });
      tx.objectStore("errors").put({ id: "x2", cardId: "2019-Q07", rootCause: "image-familiarity", tags: ["missed-finding", "incomplete"], createdAt: t - 3600e3 });
      tx.objectStore("reviews").put({ cardId: "70W-Q04", stage: 1, dueAt: t + 165600e3, seen: 2, rights: 1, misses: 1, lastResult: "wrong", lastSeenAt: t - 7200e3 });
      tx.objectStore("reviews").put({ cardId: "2019-Q07", stage: 1, dueAt: t + 169200e3, seen: 1, rights: 0, misses: 1, lastResult: "wrong", lastSeenAt: t - 3600e3 });
      await new Promise((res) => (tx.oncomplete = res));
    }, T0);
    await bp.reload();
    await bp.getByRole("heading", { name: "Radiology OSCE practice" }).waitFor();
    assert.equal(await bp.locator(".backup-banner").count(), 0, "banner too early");
    await bp.clock.fastForward(23 * 3600e3);
    await bp.locator(".backup-banner").getByText("Save a backup so you don't lose it.").waitFor();
    before = await dump();
  });

  let backupPath;
  await check("backup: save file contains everything; reminder goes away", async () => {
    await bp.goto(BASE + "#/settings");
    const [dl] = await Promise.all([bp.waitForEvent("download"), bp.getByRole("button", { name: "Save backup file" }).click()]);
    assert.match(dl.suggestedFilename(), /^osce-trainer-backup-2026-10-06\.json$/);
    backupPath = "test-results/" + dl.suggestedFilename();
    await dl.saveAs(backupPath);
    const b = JSON.parse(readFileSync(backupPath, "utf8"));
    assert.equal(b.app, "osce-trainer");
    assert.equal(b.errors.length, 2);
    assert.equal(b.reviews.length, 2);
    await bp.getByText("Backup saved.").waitFor();
    assert.equal(await bp.locator(".backup-banner").count(), 0);
  });

  await check("backup: CSV export opens as a spreadsheet (header, rows, escaping)", async () => {
    const [dl] = await Promise.all([bp.waitForEvent("download"), bp.getByRole("button", { name: "Export error log (CSV)" }).click()]);
    const p = "test-results/" + dl.suggestedFilename();
    await dl.saveAs(p);
    const lines = readFileSync(p, "utf8").replace(/^﻿/, "").trim().split("\r\n");
    assert.equal(lines.length, 3);
    assert.match(lines[0], /^Date \(UTC\),Question,Paper,Diagnosis,Modality,Root cause,Error types,Your answer,Note,Review stage/);
    assert.match(lines[2], /"said ""double bubble"", oops"/);
  });

  await check("backup: delete everything → import restores identical data", async () => {
    await bp.getByRole("button", { name: "Delete all progress on this device…" }).click();
    await bp.getByRole("button", { name: "Delete everything" }).click();
    await bp.getByText("All progress deleted from this device.").waitFor();
    await bp.getByText("0 error log entries · 0 answers marked").waitFor();
    await bp.setInputFiles("#import-file", backupPath);
    await bp.getByText("Adds 2 error log entries, progress on 2 new questions.").waitFor();
    await bp.screenshot({ path: "test-results/import-preview.png" });
    await bp.getByRole("button", { name: "Import", exact: true }).click();
    await bp.getByText(/^Imported osce-trainer-backup/).waitFor();
    assert.deepEqual(await dump(), before, "restored data differs from the original");
    await bp.goto(BASE + "#/log");
    await bp.locator(".log-row").nth(1).waitFor();
  });

  await check("backup: importing the same file again adds nothing; junk files are refused", async () => {
    await bp.goto(BASE + "#/settings");
    await bp.setInputFiles("#import-file", backupPath);
    await bp.getByText("Nothing new – everything in this backup is already on this device.").waitFor();
    assert.equal(await bp.getByRole("button", { name: "Import", exact: true }).isDisabled(), true);
    await bp.getByRole("button", { name: "Cancel" }).click();
    writeFileSync("test-results/junk.json", '{"hello":1}');
    await bp.setInputFiles("#import-file", "test-results/junk.json");
    await bp.getByRole("alert").getByText("This file is not a backup from the Radiology OSCE Trainer.").waitFor();
  });

  await check("backup: weekly reminder once there is new progress", async () => {
    await bp.clock.fastForward(8 * 24 * 3600e3);
    await bp.goto(BASE);
    await bp.getByRole("heading", { name: "Radiology OSCE practice" }).waitFor();
    assert.equal(await bp.locator(".backup-banner").count(), 0, "nothing new since the backup");
    await bp.goto(BASE + "#/study?section=2014");
    await bp.getByRole("button", { name: /^Start/ }).click();
    await bp.getByRole("button", { name: "Reveal answer" }).click();
    await bp.getByRole("button", { name: /Right/ }).click();
    await bp.goto(BASE);
    await bp.locator(".backup-banner").getByText("Your last backup was 8 days ago.", { exact: false }).waitFor();
    await bp.getByRole("button", { name: "Remind me tomorrow" }).click();
    assert.equal(await bp.locator(".backup-banner").count(), 0);
  });
  await bctx.close();

  await check("works fully offline after the first visit (all images cached)", async () => {
    await page.goto(BASE);
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    await ctx.setOffline(true);
    await page.goto(BASE + "#/browse");
    await page.locator(".tile").first().waitFor();
    const urls = Object.keys(bank.images).flatMap((id) => [`./content/img/${id}.webp`, `./content/img/thumb/${id}.webp`]);
    const failed = await page.evaluate(async (list) => {
      const bad = [];
      for (const u of list) { try { const r = await fetch(u); if (!r.ok) bad.push(u); } catch { bad.push(u); } }
      return bad;
    }, urls);
    assert.deepEqual(failed, [], `${failed.length} images missing offline`);
    await page.goto(BASE + "#/card/2017-Q13");
    await page.getByRole("button", { name: "Show answer" }).click();
    await page.getByText("Achalasia").first().waitFor();
    await ctx.setOffline(false);
  });

  await check("no console errors", async () => assert.deepEqual(errors, []));

  const phone = await browser.newContext({ viewport: { width: 375, height: 760 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: "light" });
  const pp = await phone.newPage();
  for (const route of ["", "#/browse", "#/card/2017-Q10", "#/review", "#/log", "#/settings", "#/about", "#/study?section=2019"]) {
    await check(`phone: no sideways scroll on ${route || "home"}`, async () => {
      await pp.goto(BASE + route);
      await pp.locator("main > *").first().waitFor();
      await pp.waitForTimeout(150);
      const over = await pp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      assert.ok(over <= 0, `page is ${over}px wider than the screen`);
    });
  }

  await check("phone: study screen and wrong-answer sheet fit the screen", async () => {
    await pp.goto(BASE + "#/study?section=2019");
    await pp.getByRole("button", { name: /^Start/ }).click();
    await pp.getByRole("button", { name: "Reveal answer" }).click();
    await pp.locator(".mark-bar").waitFor();
    assert.equal(await pp.locator(".nav").isVisible(), false, "tab bar should hide during study");
    await pp.screenshot({ path: "test-results/study-phone-revealed.png" });
    let over = await pp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(over <= 0, `study page ${over}px too wide`);
    await pp.getByRole("button", { name: /Wrong/ }).click();
    await pp.getByRole("dialog").waitFor();
    await pp.screenshot({ path: "test-results/wrong-sheet-phone.png" });
    over = await pp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(over <= 0, `sheet ${over}px too wide`);
  });
  await pp.goto(BASE); await pp.locator(".paper").first().waitFor();
  await pp.screenshot({ path: "test-results/home-phone-light.png" });
  await pp.goto(BASE + "#/card/2017-Q10"); await pp.locator(".film img").waitFor();
  await pp.screenshot({ path: "test-results/card-phone-light.png", fullPage: true });
} finally {
  await browser.close();
  server.kill();
}
for (const r of results) console.log(r.join("  "));
const failed = results.filter((r) => r[0] === "FAIL").length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
