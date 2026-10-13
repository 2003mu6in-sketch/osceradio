// Regression check: the next question must never render with its answer showing.
import { chromium } from "playwright";
import { spawn } from "node:child_process";
const server = spawn(process.execPath, ["scripts/serve.mjs", "dist", "4180"], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 500));
const b = await chromium.launch(); const p = await b.newPage();
await p.goto("http://localhost:4180/#/study?section=2019");
await p.getByRole("button", { name: /^Start/ }).click();
await p.evaluate(() => {
  window.__leaks = 0;
  window.__lastId = document.querySelector(".panel .crumbs .mono")?.textContent;
  new MutationObserver(() => {
    const id = document.querySelector(".panel .crumbs .mono")?.textContent;
    if (id && id !== window.__lastId) { window.__lastId = id; if (document.querySelector(".mark-bar")) window.__leaks++; }
  }).observe(document.body, { subtree: true, childList: true, characterData: true });
});
for (let i = 0; i < 34; i++) {
  await p.keyboard.press("Space");
  try { await p.locator(".mark-bar").waitFor({ timeout: 4000 }); }
  catch {
    console.log("STUCK at", i, await p.evaluate(() => ({
      count: document.querySelector(".study-head .count")?.textContent,
      reveal: !!document.querySelector(".panel .btn.primary"),
      active: document.activeElement?.outerHTML.slice(0, 120),
      dialog: !!document.querySelector("[role=dialog]"),
      toast: document.querySelector(".toast")?.textContent,
    })));
    await p.screenshot({ path: "test-results/stuck.png" }); break;
  }
  await p.keyboard.press("r");
  await p.waitForFunction((n) => document.querySelector(".study-head .count")?.textContent?.startsWith(`${n}/`), i + 2);
}
const leaks = await p.evaluate(() => window.__leaks);
console.log(leaks === 0 ? "PASS no answer flash across 34 questions" : `FAIL answer shown on ${leaks} new questions`);
await b.close(); server.kill(); process.exit(leaks ? 1 : 0);
