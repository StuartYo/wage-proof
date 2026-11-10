// Tiny static server for the demo page. Binds to 127.0.0.1 only (never a public address).
// Serves web/, the synthetic report, the contract ABI, the local deployment and the ethers UMD build.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, normalize, extname } from "node:path";
import { ROOT } from "./lib.mjs";

const PORT = Number(process.env.PORT || 5173);
const ROUTES = {
  "/vendor/ethers.umd.min.js": "node_modules/ethers/dist/ethers.umd.min.js",
  "/demo/synthetic-report.json": "demo/synthetic-report.json",
  "/abi/WageProof.json": "artifacts/contracts/WageProof.sol/WageProof.json",
  "/deployments/localhost.json": "deployments/localhost.json",
  "/config/network.json": "config/network.json",
};
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".json": "application/json", ".css": "text/css" };

createServer(async (req, res) => {
  const url = new URL(req.url, "http://x").pathname;
  let rel = ROUTES[url];
  if (!rel) {
    const p = normalize(url === "/" ? "/local.html" : url).replace(/^([/\\])+/, "");
    if (p.includes("..")) { res.writeHead(400).end(); return; }
    rel = join("web", p);
  }
  try {
    const body = await readFile(join(ROOT, rel));
    res.writeHead(200, { "content-type": TYPES[extname(rel)] || "application/octet-stream", "cache-control": "no-store" }).end(body);
  } catch {
    res.writeHead(404).end("not found");
  }
}).listen(PORT, "127.0.0.1", () => console.log(`demo page: http://127.0.0.1:${PORT}/`));
