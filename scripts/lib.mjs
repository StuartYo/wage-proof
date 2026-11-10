// Shared helpers: config, .env mnemonic, address derivation. Never prints secrets.
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { toBech32, fromHex } from "@cosmjs/encoding";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const config = JSON.parse(readFileSync(join(ROOT, "config", "network.json"), "utf8"));

export function readMnemonic() {
  const p = join(ROOT, ".env");
  if (!existsSync(p)) return null;
  const m = readFileSync(p, "utf8").match(/^TESTNET_MNEMONIC="?([a-z ]+)"?\s*$/m);
  return m ? m[1].trim() : null;
}

// ME ID / ethermint style: the bech32 form of a 0x address uses the same 20 bytes.
export function evmToBech32(evmAddress, prefix = config.bech32Prefix) {
  return toBech32(prefix, fromHex(evmAddress.toLowerCase().replace(/^0x/, "")));
}

export async function getJson(url, opts = {}) {
  const res = await fetch(url, { signal: AbortSignal.timeout(20000), ...opts });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
}
