// Local-script wrapper around api/_cw.mjs connectEthKey (Cosmos txs signed with an Ethereum-style key).
// Keys are read from .env.demo, never printed.
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./lib.mjs";
export { connectEthKey } from "../api/_cw.mjs";

export function readDemoKey(name) {
  const p = join(ROOT, ".env.demo");
  if (!existsSync(p)) return null;
  const m = readFileSync(p, "utf8").match(new RegExp(`^${name}="?(0x)?([0-9a-fA-F]{64})"?\\s*$`, "m"));
  return m ? m[2] : null;
}
