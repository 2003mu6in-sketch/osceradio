// Production build: bundle the app with esbuild, copy content + public files,
// and generate the service worker with a precache list of every shipped file.
import * as esbuild from "esbuild";
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, relative } from "node:path";

const dev = process.argv.includes("--dev");

// Supabase (optional): sign-in and progress sync are switched on when a project URL and its public
// (anon / publishable) key are present at build time – Vercel env vars, or a local .env / .env.local file.
// Accepts the names the Supabase–Vercel integration creates. Without them the app runs exactly as before.
for (const f of [".env", ".env.local"]) {
  try {
    for (const line of readFileSync(f, "utf8").split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*"?([^"#]*?)"?\s*$/.exec(line);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
    }
  } catch {}
}
const env = (...names) => names.map((n) => process.env[n]).find((v) => v && v.trim())?.trim();
const supaUrl = env("SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL", "VITE_SUPABASE_URL");
const supaKey = env("SUPABASE_ANON_KEY", "SUPABASE_PUBLISHABLE_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "VITE_SUPABASE_ANON_KEY");
const supabase = supaUrl && supaKey ? { url: supaUrl.replace(/\/+$/, ""), key: supaKey } : null;
if (supabase && !/^https?:\/\//.test(supabase.url)) throw new Error(`SUPABASE_URL must start with https:// (got ${supabase.url})`);
if (supabase && /service_role|sb_secret_/.test(supabase.key + atobSafe(supabase.key))) throw new Error("That is the Supabase service-role/secret key. Use the anon or publishable key – the secret key must never be shipped to browsers.");
function atobSafe(k) { try { return Buffer.from(k.split(".")[1] ?? "", "base64").toString(); } catch { return ""; } }
const out = process.env.OUT_DIR || "dist";   // tests build a second copy with accounts switched on
rmSync(out, { recursive: true, force: true });
mkdirSync(`${out}/assets`, { recursive: true });

const app = await esbuild.build({
  entryPoints: { app: "src/main.tsx" },
  bundle: true, format: "esm", target: "es2022", jsx: "automatic",
  outdir: `${out}/assets`, entryNames: dev ? "[name]" : "[name]-[hash]",
  minify: !dev, sourcemap: dev ? "inline" : false, metafile: true,
  define: { "process.env.NODE_ENV": JSON.stringify(dev ? "development" : "production"), __SUPABASE__: JSON.stringify(supabase) },
  loader: { ".svg": "file", ".woff2": "file" }, logLevel: "warning",
});
const outputs = Object.keys(app.metafile.outputs).map((p) => relative(out, p));
const js = outputs.find((p) => p.endsWith(".js"));
const css = outputs.find((p) => p.endsWith(".css"));

cpSync("public", out, { recursive: true });
mkdirSync(`${out}/content`, { recursive: true });
cpSync("content/cards.json", `${out}/content/cards.json`);
mkdirSync(`${out}/content/osce`, { recursive: true });
mkdirSync(`${out}/content/mcq`, { recursive: true });
const OTHER = ["anaesthesia", "ophthalmology", "ent"], ALL = ["radiology", ...OTHER];
for (const s of OTHER) cpSync(`content/osce/${s}.json`, `${out}/content/osce/${s}.json`);
for (const s of ALL) cpSync(`content/mcq/${s}.json`, `${out}/content/mcq/${s}.json`);
// ship only the images the question banks reference (full size + thumbnail).
// Radiology OSCE images are precached (offline from the first visit, as in V1); the other
// subjects' images are cached when first shown or when the student downloads a subject for offline use.
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));
const bank = readJson("content/cards.json");
const precacheImages = new Set(Object.keys(bank.images));
const subjectImages = {};
for (const s of OTHER) subjectImages[s] = Object.keys(readJson(`content/osce/${s}.json`).images);
for (const s of ALL) subjectImages[s] = [...(subjectImages[s] ?? []), ...Object.keys(readJson(`content/mcq/${s}.json`).images ?? {})];
mkdirSync(`${out}/content/img/thumb`, { recursive: true });
for (const id of new Set([...precacheImages, ...Object.values(subjectImages).flat()])) {
  cpSync(`content/img/${id}.webp`, `${out}/content/img/${id}.webp`);
  cpSync(`content/img/thumb/${id}.webp`, `${out}/content/img/thumb/${id}.webp`);
}
writeFileSync(`${out}/content/images.json`, JSON.stringify(subjectImages));

const html = readFileSync("src/index.html", "utf8")
  .replace("%CSS%", css ? `<link rel="stylesheet" href="./${css}">` : "")
  .replace("%JS%", `<script type="module" src="./${js}"></script>`);
writeFileSync(`${out}/index.html`, html);

// precache list + content hash => cache version
const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
const allFiles = walk(out).map((f) => relative(out, f).split("\\").join("/")).filter((f) => f !== "sw.js").sort();
const imgId = (f) => f.replace(/^content\/img\/(thumb\/)?/, "").replace(/\.webp$/, "");
const files = allFiles.filter((f) => !f.startsWith("content/img/") || precacheImages.has(imgId(f)));
const hash = createHash("sha256");
if (process.env.BUILD_SALT) hash.update(process.env.BUILD_SALT);   // tests: force a "new version"
for (const f of allFiles) hash.update(f).update(readFileSync(join(out, f)));
const version = hash.digest("hex").slice(0, 12);
await esbuild.build({
  entryPoints: ["src/sw.ts"], bundle: true, format: "iife", target: "es2022", minify: !dev,
  outfile: `${out}/sw.js`, logLevel: "warning",
  define: { __PRECACHE__: JSON.stringify(["./", ...files]), __VERSION__: JSON.stringify(version) },
});
const size = files.reduce((n, f) => n + statSync(join(out, f)).size, 0);
const total = allFiles.reduce((n, f) => n + statSync(join(out, f)).size, 0);
console.log(supabase ? `accounts: on (${new URL(supabase.url).host})` : "accounts: off (no SUPABASE_URL / SUPABASE_ANON_KEY)");
console.log(`built ${allFiles.length} files (${(total / 1e6).toFixed(1)} MB); precache ${files.length} files (${(size / 1e6).toFixed(1)} MB), cache v${version}`);
