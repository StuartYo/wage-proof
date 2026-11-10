// Read-only ME ID lookup: does this address have an ME ID (a verified real person on ME Network)?
// Usage: node scripts/meid.mjs <me1...|0x...> [--save <file>]
// Accepts a 0x address too: it is converted to its me1 form (same 20 bytes), and the ETH
// sub-account binding is also checked. Mirrors IdentityApi.getMeIdByAddress in the official JS SDK.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, config, getJson, evmToBech32 } from "./lib.mjs";

const MISSING = ["DID not found", "failed to get DID by sub-account"];

export async function lookupMeId(address) {
  const isEvm = /^0x[0-9a-fA-F]{40}$/.test(address);
  const me1 = isEvm ? evmToBech32(address) : address;
  const url = `${config.hub.rest}/metaearth/did/did?address=${encodeURIComponent(me1)}`;
  const raw = await getJson(url);
  let result = interpret(raw);
  let subRaw = null;
  if (!result.hasMeId && isEvm) {
    const subUrl = `${config.hub.rest}/metaearth/kyc/QuerySubAccountDidResponse?sub_account=${encodeURIComponent(address)}`;
    subRaw = await getJson(subUrl);
    const sub = interpret(subRaw);
    if (sub.hasMeId) result = { ...sub, via: "eth-sub-account" };
    subRaw = { url: subUrl, ...subRaw };
  }
  return { input: address, queried: me1, ...result, raw: { url, ...raw }, subAccountRaw: subRaw };
}

function interpret({ status, body }) {
  const info = body && typeof body === "object" ? body.info : null;
  if (status === 200 && info?.did) {
    return { hasMeId: true, active: info.status === "DID_STATUS_ACTIVE", status: info.status, kycLevel: info.kycLevel ?? "" };
  }
  const msg = body && typeof body === "object" ? String(body.message ?? "") : String(body);
  if (MISSING.some(m => msg.includes(m))) return { hasMeId: false, note: `node answered HTTP ${status}: ${msg}` };
  throw new Error(`unexpected ME ID response HTTP ${status}: ${msg.slice(0, 200)}`);
}

if (process.argv[1] && process.argv[1].endsWith("meid.mjs")) {
  const addr = process.argv[2];
  if (!addr) { console.error("usage: node scripts/meid.mjs <me1...|0x...> [--save file]"); process.exit(2); }
  const r = await lookupMeId(addr);
  console.log(`${addr}: ${r.hasMeId ? `有 ME ID（狀態 ${r.status}，等級 ${r.kycLevel}）` : "沒有 ME ID"}`);
  const i = process.argv.indexOf("--save");
  if (i > 0) {
    const file = join(ROOT, process.argv[i + 1]);
    writeFileSync(file, JSON.stringify({ queriedAt: new Date().toISOString(), ...r }, null, 2) + "\n");
    console.log(`saved ${process.argv[i + 1]}`);
  }
}
