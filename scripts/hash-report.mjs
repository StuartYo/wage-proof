// Fingerprint a report file: SHA-256 of the exact file bytes, as a bytes32 (0x...).
// Anyone can check it with `sha256sum <file>` or `certutil -hashfile <file> SHA256`.
// Only this fingerprint goes on chain; the file itself (which may hold personal data) never does.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

export function hashReport(path) {
  return "0x" + createHash("sha256").update(readFileSync(path)).digest("hex");
}

if (process.argv[1]?.endsWith("hash-report.mjs")) {
  const p = process.argv[2] || "demo/synthetic-report.json";
  console.log(`${p}\nsha256 bytes32: ${hashReport(p)}`);
}
