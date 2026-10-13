// A student with the app open gets a "new version" notice after a redeploy, and Reload picks it up.
import { chromium } from "playwright";
import { spawn, execFileSync } from "node:child_process";
const PORT = 4181, BASE = `http://localhost:${PORT}/`;
execFileSync(process.execPath, ["scripts/build.mjs"], { stdio: "ignore" });
const server = spawn(process.execPath, ["scripts/serve.mjs", "dist", String(PORT)], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 500));
const b = await chromium.launch();
let ok = false;
try {
  const p = await b.newPage();
  await p.goto(BASE);
  await p.waitForFunction(() => !!navigator.serviceWorker.controller || (navigator.serviceWorker.ready.then(() => location.reload()), false));
  await p.waitForFunction(() => !!navigator.serviceWorker.controller);
  const v1 = await p.evaluate(() => caches.keys());
  if (await p.locator(".toast.update").count()) throw new Error("update notice shown on first install");
  execFileSync(process.execPath, ["scripts/build.mjs"], { stdio: "ignore", env: { ...process.env, BUILD_SALT: String(Date.now()) } });   // "redeploy"
  await p.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r.update()));
  await p.getByText("A new version is ready.").waitFor({ timeout: 20000 });
  await p.getByRole("button", { name: "Reload" }).click();
  await p.getByRole("heading", { name: "Radiology OSCE practice" }).waitFor();
  const v2 = await p.evaluate(() => caches.keys());
  ok = v2.length === 1 && v2[0] !== v1[0];
  console.log(ok ? `PASS update notice + reload (${v1[0]} → ${v2[0]}, old cache removed)` : `FAIL caches ${v1} → ${v2}`);
} catch (e) { console.log("FAIL", e.message.split("\n")[0]); }
await b.close(); server.kill();
execFileSync(process.execPath, ["scripts/build.mjs"], { stdio: "ignore" });
process.exit(ok ? 0 : 1);
