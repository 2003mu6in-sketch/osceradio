// Dev loop: rebuild on change (unminified, no hashes) and serve dist/ on :5173.
import { spawn } from "node:child_process";
import { watch } from "node:fs";
let busy = false, again = false;
const build = () => {
  if (busy) { again = true; return; }
  busy = true;
  spawn(process.execPath, ["scripts/build.mjs", "--dev"], { stdio: "inherit" }).on("exit", () => {
    busy = false; if (again) { again = false; build(); }
  });
};
build();
for (const dir of ["src", "public", "content"]) watch(dir, { recursive: true }, build);
spawn(process.execPath, ["scripts/serve.mjs", "dist", "5173"], { stdio: "inherit" });
