// Build the static part of the online demo into public/ (used by Vercel, see vercel.json).
// Copies only: web/index.html, web/app.js, the two synthetic reports.
// No keys, no .env, no deployment secrets are ever copied.
import { mkdirSync, copyFileSync, rmSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "public");
const FILES = [
  ["web/index.html", "index.html"],
  ["web/app.js", "app.js"],
  ["demo/synthetic-report.json", "demo/synthetic-report.json"],
  ["demo/synthetic-report-2.json", "demo/synthetic-report-2.json"],
  ["web/fonts/NotoSansTC-subset.woff2", "fonts/NotoSansTC-subset.woff2"],
  ["web/fonts/NotoSansTC-OFL.txt", "fonts/NotoSansTC-OFL.txt"],
  ["web/fonts/GeistMono-Variable.woff2", "fonts/GeistMono-Variable.woff2"],
  ["web/fonts/Geist-OFL.txt", "fonts/Geist-OFL.txt"],
];

rmSync(OUT, { recursive: true, force: true });
for (const [from, to] of FILES) {
  mkdirSync(dirname(join(OUT, to)), { recursive: true });
  copyFileSync(join(ROOT, from), join(OUT, to));
}

// guard: refuse to publish anything that looks like a private key or mnemonic
const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
for (const f of walk(OUT)) {
  if (f.endsWith(".woff2")) continue;                       // binary font files
  const t = readFileSync(f, "utf8");
  if (/PRIVATE|MNEMONIC|DEMO_(WORKER|EMPLOYER)_KEY/.test(t)) { console.error(`refusing: suspicious text in ${f}`); process.exit(1); }
}
console.log(`public/ built: ${FILES.length} files`);
