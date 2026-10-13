// Production build: bundle the app with esbuild, copy content + public files,
// and generate the service worker with a precache list of every shipped file.
import * as esbuild from "esbuild";
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, relative } from "node:path";

const dev = process.argv.includes("--dev");
const out = "dist";
rmSync(out, { recursive: true, force: true });
mkdirSync(`${out}/assets`, { recursive: true });

const app = await esbuild.build({
  entryPoints: { app: "src/main.tsx" },
  bundle: true, format: "esm", target: "es2022", jsx: "automatic",
  outdir: `${out}/assets`, entryNames: dev ? "[name]" : "[name]-[hash]",
  minify: !dev, sourcemap: dev ? "inline" : false, metafile: true,
  define: { "process.env.NODE_ENV": JSON.stringify(dev ? "development" : "production") },
  loader: { ".svg": "file", ".woff2": "file" }, logLevel: "warning",
});
const outputs = Object.keys(app.metafile.outputs).map((p) => relative(out, p));
const js = outputs.find((p) => p.endsWith(".js"));
const css = outputs.find((p) => p.endsWith(".css"));

cpSync("public", out, { recursive: true });
mkdirSync(`${out}/content`, { recursive: true });
cpSync("content/cards.json", `${out}/content/cards.json`);
// ship only the images the question bank references (full size + thumbnail)
const bank = JSON.parse(readFileSync("content/cards.json", "utf8"));
mkdirSync(`${out}/content/img/thumb`, { recursive: true });
for (const id of Object.keys(bank.images)) {
  cpSync(`content/img/${id}.webp`, `${out}/content/img/${id}.webp`);
  cpSync(`content/img/thumb/${id}.webp`, `${out}/content/img/thumb/${id}.webp`);
}

const html = readFileSync("src/index.html", "utf8")
  .replace("%CSS%", css ? `<link rel="stylesheet" href="./${css}">` : "")
  .replace("%JS%", `<script type="module" src="./${js}"></script>`);
writeFileSync(`${out}/index.html`, html);

// precache list + content hash => cache version
const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
const files = walk(out).map((f) => relative(out, f).split("\\").join("/")).filter((f) => f !== "sw.js").sort();
const hash = createHash("sha256");
if (process.env.BUILD_SALT) hash.update(process.env.BUILD_SALT);   // tests: force a "new version"
for (const f of files) hash.update(f).update(readFileSync(join(out, f)));
const version = hash.digest("hex").slice(0, 12);
await esbuild.build({
  entryPoints: ["src/sw.ts"], bundle: true, format: "iife", target: "es2022", minify: !dev,
  outfile: `${out}/sw.js`, logLevel: "warning",
  define: { __PRECACHE__: JSON.stringify(["./", ...files]), __VERSION__: JSON.stringify(version) },
});
const size = files.reduce((n, f) => n + statSync(join(out, f)).size, 0);
console.log(`built ${files.length} files (${(size / 1e6).toFixed(1)} MB), cache v${version}`);
