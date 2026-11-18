// wage-proof demo v3: two phones (worker, boss) + a strip of what happened on ME Network.
// Reads come straight from the ME testnet Hub REST (contract queries, txs, balances, ME ID).
// Writes go through POST /api/demo, where the server signs with two testnet-only demo accounts after
// simulating the call; the CONTRACT decides what is allowed. The page never invents a status.
(() => {
"use strict";
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const two = (n) => String(n).padStart(2, "0");
const hms = (s) => { const d = new Date(s * 1000); return `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`; };
const hm = (s) => { const d = new Date(s * 1000); return `${two(d.getHours())}:${two(d.getMinutes())}`; };
const short = (a, h = 6, t = 4) => (a ? `${a.slice(0, h)}…${a.slice(-t)}` : "");
const ntd = (n) => `NT$${Number(n).toLocaleString("en-US")}`;
const amtHtml = (n, cls = "amt") => `<p class="${cls}"><small>NT$</small>${Number(n).toLocaleString("en-US")}</p>`;
const num = (n) => Number(n).toLocaleString("en-US");
const clockText = (s) => { s = Math.max(0, Math.ceil(s)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return h ? `${h}:${two(m)}:${two(x)}` : `${m}:${two(x)}`; };
const isNarrow = () => window.matchMedia("(max-width: 1023px)").matches;

// ---------- icons (Lucide shapes, ISC license) ----------
const svg = (p, sw = 2) => `<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
const SHIELD = '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>';
const I = {
  check: () => svg('<path d="M20 6 9 17l-5-5"/>', 2.6),
  clock: () => svg('<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>'),
  flag: () => svg('<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><path d="M4 22v-7"/>'),
  ext: () => svg('<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>'),
  copy: () => svg('<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>'),
  shieldOk: () => svg(SHIELD + '<path d="m9 12 2 2 4-4"/>'),
  shieldNo: () => svg(SHIELD + '<path d="m14.5 9.5-5 5"/><path d="m9.5 9.5 5 5"/>'),
  arrow: () => svg('<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>'),
  alert: () => svg('<circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/>'),
  user: () => svg('<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>'),
  store: () => svg('<path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z"/><path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"/><path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2"/><path d="M10 6h4"/><path d="M10 10h4"/><path d="M10 14h4"/><path d="M10 18h4"/>'),
  chev: () => svg('<path d="m6 9 6 6 6-6"/>'),
  lock: () => svg('<rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>'),
  inbox: () => svg('<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>'),
};
const ext = (href, text) => `<a class="ext" href="${esc(href)}" target="_blank" rel="noopener">${text}${I.ext()}</a>`;

// ---------- words ----------
const LV = { two: "進階驗證", one: "真人驗證", none: "沒有 ME ID", err: "查不到", wait: "查詢中" };
const UNVERIFIED_NAME = "範例小吃店";
const CONTRACT_ZH = {
  EmployerNotVerified: "這家公司沒有 ME ID，合約不收",
  NotEmployer: "只有補薪單上的老闆能回覆",
  NotPending: "這張已經處理過了",
  DeadlinePassed: "已經過了回覆期限，老闆不能再回覆",
  DeadlineNotPassed: "還沒到期限，還不能記為逾期",
  NoSuchRecord: "鏈上找不到這張補薪單",
  BadWindow: "回覆期限不在合約允許的範圍",
  WrongSettlement: "補發金額跟補薪單上的不一樣，合約不收",
  WrongSettlementDenom: "合約只收 MEC",
  SettlementMissing: "補發時一定要同時付款",
  UnexpectedFunds: "這個動作不能附帶付款",
  MeIdLookupFailed: "合約查不到 ME ID，為了安全直接拒絕",
};
function plain(j, http) {
  if (http === 0) return "連不上伺服器。請檢查網路，再按一次。";
  if (j.code === "contract_rejected" || j.code === "employer_not_verified") return `合約拒絕：${CONTRACT_ZH[j.contractError] || "不符合合約規則"}。沒有送出，也沒有花手續費。`;
  if (j.code === "rate_limited") { const w = String(j.message || "").match(/請 (\d+) 秒/); return `按太快了。請等 ${w ? w[1] : 60} 秒再按。`; }
  if (j.code === "daily_limit") return "今天的示範次數用完了，明天會重置。";
  if (j.code === "out_of_funds") return "示範帳號的測試幣用完了。";
  if (j.code === "not_configured") return "示範伺服器還沒設定好。";
  if (j.code === "upstream_error") return "ME Network 節點暫時沒有回應。請再按一次。";
  return "沒有送出。請再按一次。";
}

// ---------- state ----------
const STATUS_N = { pending: 1, confirmed: 2, disputed: 3, expired: 4 };
const MINE_KEY = "wageproof.v3.mine", REASON_KEY = "wageproof.v3.reasons";
const REPORT_FILES = ["/demo/synthetic-report.json", "/demo/synthetic-report-2.json"];
let info = null;
const reports = [];
const levels = {};                 // address -> "two" | "one" | "none" | "err" | "wait"
let clockOffset = 0;               // chain time minus local time, seconds
const S = {
  rep: 0, emp: "verified", win: 60,
  phase: "loading",                // loading | draft | sending | blocked | waiting | due | marking | done | fatal
  sendAt: 0, sendStep: 0, sendErr: null, blocked: null,
  rec: null, txs: {},              // my current record and its txs by action
  boss: { open: false, busy: null, at: 0, err: null, reason: "", reasonErr: false },
  workerErr: null, bal: { before: null, after: null },
  view: "worker", toldBoss: false, showFour: false, tried: false, openReceipt: null,
  ev: [], evLocal: [], evTotal: null, count: null, fresh: new Set(), evErr: false,
};

const readJson = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const writeJson = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } };
const mine = () => readJson(MINE_KEY, []);
const remember = (id) => writeJson(MINE_KEY, [...mine().filter((x) => x !== id), id].slice(-20));
const reasonOf = (id) => readJson(REASON_KEY, {})[id];
const keepReason = (id, text) => { const r = readJson(REASON_KEY, {}); r[id] = text; writeJson(REASON_KEY, r); };

// ---------- chain reads ----------
async function getJson(url, opts) {
  const res = await fetch(url, { cache: "no-store", ...opts });
  const body = await res.json().catch(() => null);
  if (!res.ok) { const e = new Error(body?.message || `HTTP ${res.status}`); e.body = body; throw e; }
  return body;
}
const smartUrl = (q) => `${info.hubRest}/cosmwasm/wasm/v1/contract/${info.contract}/smart/${encodeURIComponent(btoa(JSON.stringify(q)))}`;
const txUrl = (h) => `${info.hubRest}/cosmos/tx/v1beta1/txs/${h}`;
const query = async (q) => (await getJson(smartUrl(q))).data;
const chainNow = () => Date.now() / 1000 + clockOffset;
const decimals = () => info?.settle?.mecDecimals ?? 8;
const mec = (umec, dp = 5) => (Number(umec) / 10 ** decimals()).toFixed(dp);
const twdOf = (umec) => Math.round(Number(umec) / (info?.settle?.umecPerTwd ?? 1000));

async function syncClock() {
  const b = await getJson(`${info.hubRest}/cosmos/base/tendermint/v1beta1/blocks/latest`);
  clockOffset = Date.parse(b.block.header.time) / 1000 - Date.now() / 1000;
}
async function balance() {
  const j = await getJson(`${info.hubRest}/cosmos/bank/v1beta1/balances/${info.worker}`);
  return Number(j.balances.find((b) => b.denom === (info.settle?.denom || "umec"))?.amount ?? 0);
}
async function loadLevel(addr) {
  try {
    const res = await fetch(`${info.hubRest}/metaearth/did/did?address=${encodeURIComponent(addr)}`, { cache: "no-store" });
    const b = await res.json().catch(() => null);
    if (res.ok && b?.info?.did) levels[addr] = b.info.status === "DID_STATUS_ACTIVE" ? ({ KYC_LEVEL_TWO: "two", KYC_LEVEL_ONE: "one" }[b.info.kycLevel] || "none") : "none";
    else levels[addr] = String(b?.message || "").includes("DID not found") ? "none" : "err";
  } catch { levels[addr] = "err"; }
}

async function loadReports() {
  for (const url of REPORT_FILES) {
    const raw = new Uint8Array(await (await fetch(url, { cache: "no-store" })).arrayBuffer());
    const r = JSON.parse(new TextDecoder().decode(raw));
    const d = await crypto.subtle.digest("SHA-256", raw);
    const hash = [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
    const f = r.findings[0], month = Number(r.period.slice(5, 7)), rest = f.item === "rest-day work";
    reports.push({
      hash, url, month, rest,
      employer: r.employer.displayName.replace("（虛構）", ""), worker: r.worker.displayName.replace("（虛構）", ""),
      wage: r.hourlyWageTWD, att: Number(f.attendance), pay: Number(f.payslip), diff: Number(f.differenceHours), short: f.estimatedShortfallTWD, basis: f.basis || "",
      why: rest ? `休息日出勤 ${f.differenceHours} 小時沒有算` : `加班少算 ${f.differenceHours} 小時`,
      bossWhy: rest ? `${month} 月休息日出勤少算 ${f.differenceHours} 小時` : `${month} 月加班少算 ${f.differenceHours} 小時`,
      swap: rest ? `換一份範例（休息日出勤 ${ntd(f.estimatedShortfallTWD)}）` : `換回範例（加班 ${ntd(f.estimatedShortfallTWD)}）`,
    });
  }
}
const basisTxt = (b) => String(b || "").split(/[,;]/)[0].replace(/ hours?/g, " 小時").replace(/ x /g, " × ").trim();
const initial = (name) => String(name || "?").trim().slice(-1);
const repOfRec = (rec) => reports.find((r) => r.hash === rec?.report_hash) || null;

// my record: status straight from the contract (effective_status turns pending into expired after the deadline)
async function loadRecord(id) {
  const rec = await query({ record: { id } });
  const eff = rec.status === "pending" ? await query({ effective_status: { id } }) : rec.status;
  S.rec = { ...rec, eff: STATUS_N[eff] };
  const i = reports.findIndex((r) => r.hash === rec.report_hash);
  if (i >= 0) S.rep = i;
  if (rec.status !== "pending") S.phase = "done";
  else if (S.phase !== "marking") S.phase = S.rec.eff === 4 ? "due" : "waiting";
}
async function loadTxs(id) {
  const url = `${info.hubRest}/cosmos/tx/v1beta1/txs?events=${encodeURIComponent(`wasm._contract_address='${info.contract}'`)}&events=${encodeURIComponent(`wasm.id='${id}'`)}`;
  const j = await getJson(url);
  const txs = {};
  for (const t of j.tx_responses || []) {
    if (t.code !== 0) continue;
    const a = attrs(t);
    if (Number(a.id) !== id) continue;
    const fee = t.tx?.auth_info?.fee?.amount?.find((x) => x.denom === "umec")?.amount;
    txs[a.action] = { hash: t.txhash, height: Number(t.height), time: Date.parse(t.timestamp) / 1000, fee: fee ? Number(fee) : null, settled: a.settled };
  }
  if (S.rec?.id === id) S.txs = txs;
}
function attrs(t) {
  const ev = (t.logs?.[0]?.events || t.events || []).find((e) => e.type === "wasm");
  return Object.fromEntries((ev?.attributes || []).map((a) => [a.key, a.value]));
}

// evidence strip: the contract's latest real transactions, newest first
const WHO = { submit: "勞工", confirm: "老闆", dispute: "老闆", mark_expired: "勞工", instantiate: "部署者" };
function rowOf(t) {
  const a = attrs(t), id = a.id;
  const base = { hash: t.txhash, height: Number(t.height), time: Date.parse(t.timestamp) / 1000, who: WHO[a.action] || "—", mine: id && mine().includes(Number(id)) };
  switch (a.action) {
    case "submit": return { ...base, what: `送出補薪單 #${id}`, sub: `合約查老闆 ME ID：${LV[a.employer_level] || a.employer_level}，通過` };
    case "confirm": return a.settled && a.settled !== "0"
      ? { ...base, what: `老闆補發 #${id}`, sub: `合約轉 ${mec(a.settled)} MEC 給勞工` }
      : { ...base, what: `老闆確認 #${id}`, sub: "這張沒有要求金額" };
    case "dispute": return { ...base, what: `老闆有異議 #${id}`, sub: "理由的指紋上鏈，沒有付款" };
    case "mark_expired": return { ...base, what: `記為逾期 #${id}`, sub: "老闆在期限內沒有回覆" };
    case "instantiate": return { ...base, what: "部署合約", sub: `規定老闆的 ME ID 至少要「${LV[a.min_employer_level] || a.min_employer_level}」` };
    default: return { ...base, what: a.action || "交易", sub: "" };
  }
}
async function loadEvidence() {
  try {
    const url = `${info.hubRest}/cosmos/tx/v1beta1/txs?events=${encodeURIComponent(`wasm._contract_address='${info.contract}'`)}&limit=6&page=1&order_by=2`;
    const [j, count] = await Promise.all([getJson(url), query({ count: {} }).catch(() => S.count)]);
    S.ev = (j.tx_responses || []).filter((t) => t.code === 0).map(rowOf);
    S.evTotal = Number(j.total ?? j.pagination?.total ?? S.ev.length);
    S.count = count;
    S.evErr = false;
  } catch { S.evErr = true; }
  renderEvidence();
}

// ---------- writes (server signs with demo accounts; the contract decides) ----------
async function post(body) {
  try {
    const res = await fetch("/api/demo", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return { http: res.status, j: await res.json().catch(() => ({})) };
  } catch { return { http: 0, j: {} }; }
}
let localSeq = 0;
function addLocal(row) { const r = { key: `l${++localSeq}`, time: chainNow(), ...row }; S.evLocal.unshift(r); S.fresh.add(r.key); renderEvidence(); return r.key; }
function dropLocal(key) { S.evLocal = S.evLocal.filter((r) => r.key !== key); }

async function submit() {
  const rep = reports[S.rep];
  if (!info || !rep || S.phase !== "draft") return;
  const toBad = S.emp === "unverified";
  S.phase = "sending"; S.sendAt = Date.now(); S.sendStep = 1; S.sendErr = null; S.blocked = null;
  render();
  const pend = addLocal({ who: "勞工", what: "送出補薪單", sub: "寫上 ME Network 中", pend: true });
  setTimeout(() => { if (S.phase === "sending") { S.sendStep = 2; renderWorker(); } }, 450);
  setTimeout(() => { if (S.phase === "sending") { S.sendStep = 3; renderWorker(); } }, 2200);
  const { http, j } = await post({ action: "submit", reportHash: "0x" + rep.hash, deadlineSeconds: S.win, employer: S.emp, claimTwd: rep.short });
  dropLocal(pend);
  if (j.ok) {
    remember(j.id);
    S.fresh.add(j.txHash);
    S.txs = { submit: { hash: j.txHash, height: j.blockNumber, time: chainNow() } };
    S.boss = { open: false, busy: null, at: 0, err: null, reason: "", reasonErr: false };
    S.bal = { before: null, after: null }; S.workerErr = null; S.toldBoss = false;
    try { await loadRecord(j.id); } catch { S.rec = { id: j.id, status: "pending", eff: 1, claim: j.claim, report_hash: rep.hash, submitted_at: chainNow(), deadline: chainNow() + S.win }; S.phase = "waiting"; }
    render();
    arrive();
    loadTxs(j.id).then(renderWorker).catch(() => {});
    loadEvidence();
    poll();
  } else if (j.code === "employer_not_verified") {
    S.phase = "blocked"; S.blocked = j; S.showFour = true; S.tried = true;
    addLocal({ who: "合約", what: "合約拒絕：老闆沒有 ME ID", sub: "伺服器先模擬，合約不收，所以沒有送出", rej: true, link: j.rejectProofUrl });
    render();
  } else {
    S.phase = "draft"; S.sendErr = toBad && http === 0 ? plain(j, http) : plain(j, http);
    renderEvidence(); render();
  }
}

async function confirmPay() {
  const rec = S.rec;
  if (!rec || S.boss.busy || S.phase !== "waiting") return;
  S.boss.busy = "confirm"; S.boss.at = Date.now(); S.boss.err = null;
  render();
  const pend = addLocal({ who: "老闆", what: `老闆補發 #${rec.id}`, sub: "寫上 ME Network 中", pend: true });
  let before = null;
  try { before = await balance(); } catch { /* shown as unknown */ }
  const { http, j } = await post({ action: "confirm", id: rec.id });
  dropLocal(pend);
  if (j.ok) {
    let after = null;
    try { after = await balance(); } catch { /* shown as unknown */ }
    S.bal = { before, after };
    S.fresh.add(j.txHash);
    S.txs.confirm = { hash: j.txHash, height: j.blockNumber, time: chainNow(), settled: j.settled };
    await afterBossAction(rec.id);
  } else {
    S.boss.busy = null; S.boss.err = plain(j, http);
    if (j.contractError === "DeadlinePassed" || j.contractError === "NotPending") await loadRecord(rec.id).catch(() => {});
    render(); renderEvidence();
  }
}

async function dispute() {
  const rec = S.rec;
  if (!rec || S.boss.busy || S.phase !== "waiting") return;
  const text = S.boss.reason.trim();
  if (!text) { S.boss.reasonErr = true; renderBoss(); $("reason")?.focus(); return; }
  S.boss.busy = "dispute"; S.boss.at = Date.now(); S.boss.err = null; S.boss.reasonErr = false;
  render();
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  const reasonHash = "0x" + [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, "0")).join("");
  const pend = addLocal({ who: "老闆", what: `老闆有異議 #${rec.id}`, sub: "寫上 ME Network 中", pend: true });
  const { http, j } = await post({ action: "dispute", id: rec.id, reasonHash });
  dropLocal(pend);
  if (j.ok) {
    keepReason(rec.id, text);
    S.fresh.add(j.txHash);
    S.txs.dispute = { hash: j.txHash, height: j.blockNumber, time: chainNow() };
    await afterBossAction(rec.id);
  } else {
    S.boss.busy = null; S.boss.err = plain(j, http);
    if (j.contractError === "DeadlinePassed" || j.contractError === "NotPending") await loadRecord(rec.id).catch(() => {});
    render(); renderEvidence();
  }
}

async function afterBossAction(id) {
  try { await loadRecord(id); } catch { S.phase = "done"; }
  S.boss.busy = null; S.showFour = true;
  render();
  loadTxs(id).then(() => { renderWorker(); renderBoss(); }).catch(() => {});
  loadEvidence();
}

async function markExpired() {
  const rec = S.rec;
  if (!rec || S.phase !== "due") return;
  S.phase = "marking"; S.workerErr = null; S.boss.at = Date.now();
  render();
  const pend = addLocal({ who: "勞工", what: `記為逾期 #${rec.id}`, sub: "寫上 ME Network 中", pend: true });
  const { http, j } = await post({ action: "markExpired", id: rec.id });
  dropLocal(pend);
  if (j.ok) {
    S.fresh.add(j.txHash);
    S.txs.mark_expired = { hash: j.txHash, height: j.blockNumber, time: chainNow() };
    S.phase = "due";
    await afterBossAction(rec.id);
  } else {
    S.phase = "due"; S.workerErr = plain(j, http);
    await loadRecord(rec.id).catch(() => {});
    render(); renderEvidence();
  }
}

function fresh() {
  S.openReceipt = null;
  S.phase = "draft"; S.rec = null; S.txs = {}; S.sendErr = null; S.blocked = null; S.workerErr = null;
  S.bal = { before: null, after: null }; S.boss = { open: false, busy: null, at: 0, err: null, reason: "", reasonErr: false };
}

// poll my open record so the countdown, expiry and the other phone stay in step with the chain
let polling = false;
async function poll() {
  if (polling || !S.rec || !["waiting", "due"].includes(S.phase) || S.boss.busy) return;
  polling = true;
  const before = `${S.phase}|${S.rec.status}|${S.rec.eff}`;
  try {
    await syncClock().catch(() => {});
    await loadRecord(S.rec.id);
    if (`${S.phase}|${S.rec.status}|${S.rec.eff}` !== before) {
      if (S.phase === "done") { S.showFour = true; await loadTxs(S.rec.id).catch(() => {}); loadEvidence(); }
      render();
    }
  } catch { /* try again next round */ }
  polling = false;
}

// ---------- worker phone ----------
function bars(rep) {
  const max = Math.max(rep.att, rep.pay, 1), aw = (rep.att / max) * 100, pw = (rep.pay / max) * 100;
  return `<div class="bars" role="img" aria-label="出勤 ${rep.att} 小時，薪資單 ${rep.pay} 小時，少算 ${rep.diff} 小時">
    <span>出勤</span><svg aria-hidden="true"><rect width="${aw}%" height="12" rx="6" fill="#0e0f0c"/></svg><span class="v">${rep.att} 小時</span>
    <span>薪資單</span><svg aria-hidden="true"><defs><pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="2.5" height="6" fill="#d03238"/></pattern></defs>
      <rect width="${aw}%" height="12" rx="6" fill="url(#hatch)"/>${pw > 0 ? `<rect width="${pw}%" height="12" rx="6" fill="#0e0f0c"/>` : ""}</svg><span class="v">${rep.pay} 小時</span>
  </div>`;
}
function levelBadge(addr, okText) {
  const lv = levels[addr] || "wait";
  if (lv === "one" || lv === "two") return `<span class="badge ok">${I.shieldOk()}${okText || "ME ID 已驗證"}</span>`;
  if (lv === "none") return `<span class="badge no">${I.shieldNo()}沒有 ME ID</span>`;
  return `<span class="badge wait">ME ID ${LV[lv]}</span>`;
}
function receipt(rec) {
  if (!rec) return "";
  const t = S.txs, row = (k, who) => t[k] ? `${who}簽名・區塊 <span class="mono">${num(t[k].height)}</span>${t[k].fee ? `・手續費 <span class="mono">${mec(t[k].fee, 4)}</span> MEC` : ""}<br>${ext(txUrl(t[k].hash), `交易 <span class="mono">${short(t[k].hash)}</span>`)}` : "";
  const reply = t.confirm ? ["補發", row("confirm", "老闆")] : t.dispute ? ["異議", row("dispute", "老闆")] : t.mark_expired ? ["逾期", row("mark_expired", "勞工")] : null;
  return `<details class="receipt" data-ph="${S.phase}"${(S.openReceipt ?? (S.phase === "waiting" && !isNarrow())) ? " open" : ""}><summary>鏈上收據 ${I.chev()}</summary><dl class="kv">
    <dt>補薪單</dt><dd class="mono">#${rec.id}</dd>
    <dt>送出</dt><dd>${row("submit", "勞工") || "讀取中…"}</dd>
    ${reply ? `<dt>${reply[0]}</dt><dd>${reply[1]}</dd>` : ""}
    <dt>老闆 ME ID</dt><dd>${esc(LV[rec.employer_level] || rec.employer_level || "—")}（送出當下合約查的）</dd>
    ${rec.claim && rec.claim !== "0" ? `<dt>要求補發</dt><dd><span class="mono">${mec(rec.claim)}</span> MEC（示範換算）</dd>` : ""}
    <dt>報告指紋</dt><dd class="mono" title="${esc(rec.report_hash)}">${short(rec.report_hash, 12, 8)}</dd>
    <dt>原始資料</dt><dd>${ext(smartUrl({ record: { id: rec.id } }), "看合約回傳")}</dd>
  </dl></details>`;
}

function workerHtml() {
  const rep = reports[S.rep];
  if (S.phase === "fatal") return `<div class="alert"><h3>${I.alert()}示範伺服器沒有回應</h3><p>請稍後重新整理這一頁。</p></div>`;
  if (!rep) return `<p class="why">讀取中…</p>`;
  const top = `<h3 class="title">${rep.month} 月薪水少算了</h3>${amtHtml(rep.short)}<p class="why">${esc(rep.why)}</p>`;

  if (S.phase === "loading" || S.phase === "draft") {
    const unv = S.emp === "unverified";
    const to = unv ? info?.employers?.unverified : info?.employer;
    return `${top}${bars(rep)}
      <div class="field"><span class="lab">送給</span>
        <div class="to"><b>${unv ? UNVERIFIED_NAME : esc(rep.employer)}</b>${to ? levelBadge(to) : `<span class="badge wait">查詢中</span>`}</div>
        <button class="link" type="button" data-act="emp">${unv ? "改回已驗證的公司" : "試試看：沒有 ME ID 的公司"}</button></div>
      <div class="field"><span class="lab" id="winLab">回覆期限</span>
        <div class="seg" role="radiogroup" aria-labelledby="winLab">${[[30, "30 秒"], [60, "1 分鐘"], [3600, "1 小時"]].map(([v, t]) =>
          `<label><input type="radio" name="win" value="${v}"${S.win === v ? " checked" : ""}><span>${t}</span></label>`).join("")}</div></div>
      <button class="link" type="button" data-act="rep">${esc(reports[(S.rep + 1) % reports.length].swap)}</button>
      <p class="fine">${I.lock()}薪資單和打卡紀錄不上傳，只送指紋。</p>
      <div class="grow"></div>
      ${unv ? `<p class="warnline">${I.alert()}合約會擋下這張</p>` : ""}
      ${S.sendErr ? `<p class="err" role="alert">${esc(S.sendErr)}</p>` : ""}
      <button class="btn primary" type="button" data-act="submit"${S.phase === "loading" ? " disabled" : ""}>${S.phase === "loading" ? "讀取中…" : `請老闆補發 ${ntd(rep.short)}`}</button>`;
  }

  if (S.phase === "sending") {
    const st = (n, text) => `<li class="${S.sendStep > n ? "done" : S.sendStep === n ? "now" : ""}"><span class="dot">${S.sendStep > n ? I.check() : S.sendStep === n ? `<span class="spin"></span>` : ""}</span>${text}</li>`;
    return `${top}<ol class="steps" aria-live="polite">${st(1, "算出報告的指紋")}${st(2, "寫上 ME Network")}${st(3, `等出塊　<span class="mono" data-since="${S.sendAt}"></span> 秒`)}</ol>
      <div class="grow"></div><button class="btn primary" type="button" disabled><span class="spin"></span>送出中…</button>`;
  }

  if (S.phase === "blocked") {
    const j = S.blocked || {};
    return `<p class="eyebrow">${I.store()}送給 ${UNVERIFIED_NAME}・${ntd(rep.short)}</p>
      <div class="alert" role="alert"><h3>${I.shieldNo()}被合約擋下，補薪單沒有送出</h3>
        <p>這家公司沒有通過 ME ID 真人驗證。</p>
        <p>合約規定只有真人驗證過的老闆才能收補薪單，避免有人假冒老闆自己按確認。</p>
        ${j.rejectProofUrl ? ext(j.rejectProofUrl, "看鏈上被拒的那筆交易") : ""}</div>
      ${j.contractMessage ? `<p class="note">合約原文：<code>${esc(j.contractMessage)}</code></p>` : ""}
      <div class="grow"></div>
      <button class="btn primary" type="button" data-act="fixEmp">改送給已驗證的公司</button>`;
  }

  const rec = S.rec, r = repOfRec(rec) || rep, twd = rec?.claim && rec.claim !== "0" ? twdOf(rec.claim) : r.short;
  if (["waiting", "due", "marking"].includes(S.phase)) {
    const due = S.phase !== "waiting";
    return `<p class="eyebrow">${I.store()}補薪單 #${rec.id}・送給 ${esc(r.employer)}</p>${amtHtml(twd, "amt md")}
      <ol class="track">
        <li class="done"><span class="dot">${I.check()}</span><div><b>已送出</b><span class="sub">${hms(rec.submitted_at)}${S.txs.submit ? `・區塊 <span class="mono">${num(S.txs.submit.height)}</span>` : ""}</span></div></li>
        ${due ? `<li class="late done"><span class="dot">${I.clock()}</span><div><b>老闆沒回應</b><span class="sub">期限 ${hms(rec.deadline)} 已經過了</span></div></li>
          <li class="${S.phase === "marking" ? "wait" : "todo"}"><span class="dot"></span><div><b>記為逾期</b><span class="sub">寫上鏈之後，老闆就不能再回覆</span></div></li>`
        : `<li class="wait"><span class="dot">${I.clock()}</span><div><b>等老闆回覆</b><span class="sub"><span class="mono" data-left="${rec.deadline}"></span> 內回覆，過了記為逾期</span></div></li>
          <li class="todo"><span class="dot"></span><div><b>補發或異議</b></div></li>`}
      </ol>
      ${receipt(rec)}
      <div class="grow"></div>
      ${S.workerErr ? `<p class="err" role="alert">${esc(S.workerErr)}</p>` : ""}
      ${S.phase === "waiting" ? `<p class="hint">已經送到${isNarrow() ? "" : "右邊"}老闆的手機，等他回覆</p>`
        : S.phase === "marking" ? `<button class="btn primary" type="button" disabled><span class="spin"></span>寫上 ME Network…</button>`
        : `<button class="btn primary" type="button" data-act="expire">記為逾期</button>`}`;
  }

  // done: the result the contract recorded
  const st = rec?.status;
  let body;
  if (st === "confirmed") {
    const paid = rec.settled && rec.settled !== "0";
    const b = S.bal;
    body = `<div class="big paid">${I.check()}</div><h3 class="res">已補發 ${ntd(twd)}</h3>
      ${paid ? `<p class="why">${mec(rec.settled)} MEC 已轉進你的帳戶（示範換算）</p>
      <div class="bal"><span class="lab">你的帳戶</span>${b.before != null && b.after != null
        ? `<span class="mono">${mec(b.before)} → <b>${mec(b.after)}</b> MEC</span><span class="plus">補發前後各讀一次餘額：多了 ${mec(b.after - b.before)} MEC</span>`
        : `<span class="mono">+ <b>${mec(rec.settled)}</b> MEC</span>`}</div>` : `<p class="why">老闆確認了這筆差額。</p>`}
      ${S.txs.confirm ? ext(txUrl(S.txs.confirm.hash), "查證這筆補發") : ""}`;
  } else if (st === "disputed") {
    const reason = reasonOf(rec.id);
    body = `<div class="big disputed">${I.flag()}</div><h3 class="res">老闆有異議</h3>
      ${reason ? `<p class="quote">「${esc(reason)}」</p>` : ""}
      <p class="why" style="margin-top:12px">理由的指紋已上鏈，可以帶去勞工局調解。</p>
      ${S.txs.dispute ? ext(txUrl(S.txs.dispute.hash), "查證這筆異議") : ""}`;
  } else {
    body = `<div class="big expired">${I.clock()}</div><h3 class="res">已記為逾期</h3>
      <p class="why" style="margin-top:8px">老闆在期限內沒有回應，已記錄在鏈上。</p>
      ${S.txs.mark_expired ? ext(txUrl(S.txs.mark_expired.hash), "查證這筆紀錄") : ""}`;
  }
  return `<p class="eyebrow">${I.store()}補薪單 #${rec.id}・${esc(r.employer)}</p>${body}${receipt(rec)}
    <div class="grow"></div>${S.tried ? `<button class="btn second" type="button" data-act="again">再送一張</button>`
      : `<button class="btn primary" type="button" data-act="four">試試看：沒有 ME ID 的公司</button><button class="link c" type="button" data-act="again">再送一張</button>`}`;
}

// ---------- boss phone ----------
function bossHtml() {
  const rec = S.rec, open = rec && ["waiting", "due", "marking", "done"].includes(S.phase);
  const r = (open && repOfRec(rec)) || reports[S.rep];
  const bossAddr = info?.employer;
  const head = `<div class="btop"><span class="name">${I.store()}<span>${esc(r?.employer || "")}</span></span>${bossAddr ? levelBadge(bossAddr, `你的 ME ID：${LV[levels[bossAddr]] || ""}`) : ""}</div>`;
  if (!open) {
    return `${head}<div class="empty">${I.inbox()}<p>目前沒有待處理的補薪單</p><p>${isNarrow() ? "勞工送出後" : "左邊的勞工送出後"}，補薪單會出現在這裡</p>
      ${r ? `<div class="ghost" aria-hidden="true"><span class="gtag">預覽</span><p class="geb">${esc(r.worker)} 請你補發</p><p class="gamt"><small>NT$</small>${r.short.toLocaleString("en-US")}</p>
        <dl><div><dt>出勤</dt><dd>${r.att} 小時</dd></div><div><dt>薪資單</dt><dd>${r.pay} 小時</dd></div>${r.basis ? `<div><dt>算法</dt><dd>${esc(basisTxt(r.basis))}</dd></div>` : ""}</dl>
        <p class="gwill">老闆可以補發，或提出異議</p></div>` : ""}</div>`;
  }
  const twd = rec.claim && rec.claim !== "0" ? twdOf(rec.claim) : r.short;
  const intro = `<p class="eyebrow">${I.user()}${esc(r.worker)} 送來一張補薪單・${hm(rec.submitted_at)}</p>${amtHtml(twd)}<p class="why">${esc(r.bossWhy)}</p>`;
  const lines = `<dl class="lines"><div><dt>出勤</dt><dd>${r.att} 小時</dd></div><div><dt>薪資單</dt><dd>${r.pay} 小時</dd></div><div><dt>時薪</dt><dd>${ntd(r.wage)}</dd></div></dl>`;
  const bill = `<dl class="lines bill-lines"><div><dt>出勤</dt><dd>${r.att} 小時</dd></div><div><dt>薪資單</dt><dd>${r.pay} 小時</dd></div><div><dt>時薪</dt><dd>${ntd(r.wage)}</dd></div>${r.basis ? `<div><dt>算法</dt><dd>${esc(basisTxt(r.basis))}</dd></div>` : ""}<div class="tot"><dt>應補發</dt><dd>${ntd(twd)}</dd></div></dl>`;

  if (S.phase === "waiting") {
    const b = S.boss, busy = !!b.busy;
    const who = `<div class="bill-head"><span class="av" aria-hidden="true">${esc(initial(r.worker))}</span>
        <p class="bill-from">${esc(r.worker)} 請你補發</p><p class="bill-why">${esc(r.bossWhy)}・${hm(rec.submitted_at)} 送出</p>
        ${amtHtml(twd, "amt c")}<p class="due">${I.clock()}<span class="mono" data-left="${rec.deadline}"></span> 內回覆，過了會記為逾期</p></div>`;
    if (b.open) return `${head}${who}<div class="grow"></div>
      <div class="dispute"><label for="reason">不同意的理由</label>
        <input id="reason" maxlength="200" autocomplete="off" placeholder="例如：那 2 小時是自願留下" value="${esc(b.reason)}"${b.reasonErr ? ' aria-invalid="true" aria-describedby="reasonErr"' : ""}${busy ? " disabled" : ""}>
        ${b.reasonErr ? `<p class="err" id="reasonErr" role="alert" style="margin:0">寫一句理由</p>` : ""}
        <p class="fine">不付款。鏈上只存理由的指紋，不公開內容。</p>
        ${b.err ? `<p class="err" role="alert">${esc(b.err)}</p>` : ""}
        <div class="pair"><button class="btn second" type="button" data-act="closeDispute"${busy ? " disabled" : ""}>取消</button>
        <button class="btn ink" type="button" data-act="dispute"${busy ? " disabled" : ""}>${b.busy === "dispute" ? `<span class="spin"></span>送出中 <span class="mono" data-since="${b.at}"></span> 秒` : "送出異議"}</button></div></div>`;
    return `${head}${who}${bill}<div class="grow"></div>
      ${b.err ? `<p class="err" role="alert">${esc(b.err)}</p>` : ""}
      <div class="pair"><button class="btn second" type="button" data-act="openDispute"${busy ? " disabled" : ""}>我有異議</button>
      <button class="btn primary" type="button" data-act="confirm"${busy ? " disabled" : ""}>${b.busy === "confirm" ? `<span class="spin"></span>補發中 <span class="mono" data-since="${b.at}"></span> 秒` : `補發 ${ntd(twd)}`}</button></div>
      ${rec.claim && rec.claim !== "0" ? `<p class="fine c">同一筆交易用 ${mec(rec.claim)} MEC 轉給員工（示範換算）</p>` : ""}`;
  }
  if (S.phase === "due" || S.phase === "marking") {
    return `${head}${intro}<p class="state" style="color:var(--body)">${I.clock()}已過回覆期限</p>
      <p class="why" style="margin-top:4px">你沒有在期限內回覆，不能再補發或異議。</p>${lines}<div class="grow"></div>`;
  }
  // done
  const st = rec.status, t = S.txs[st === "confirmed" ? "confirm" : st === "disputed" ? "dispute" : "mark_expired"];
  const kv = t ? `<dl class="lines bill-lines"><div><dt>時間</dt><dd>${hms(t.time)}</dd></div><div><dt>區塊</dt><dd>${num(t.height)}</dd></div><div><dt>交易</dt><dd>${ext(txUrl(t.hash), `<span class="mono">${short(t.hash)}</span>`)}</dd></div></dl>` : "";
  if (st === "confirmed") return `${head}<div class="grow"></div><div class="bill-head"><div class="big paid">${I.check()}</div><h3 class="res">已補發 ${ntd(twd)}</h3>
    ${rec.settled && rec.settled !== "0" ? `<p class="why">合約把 ${mec(rec.settled)} MEC 轉給員工（示範換算）</p>` : ""}</div>${kv}<div class="grow"></div>`;
  if (st === "disputed") { const reason = reasonOf(rec.id); return `${head}<div class="grow"></div><div class="bill-head"><div class="big disputed">${I.flag()}</div><h3 class="res">已送出異議</h3>
    ${reason ? `<p class="quote">「${esc(reason)}」</p>` : ""}<p class="why" style="margin-top:10px">沒有付款。理由的指紋已上鏈。</p></div>${kv}<div class="grow"></div>`; }
  return `${head}<div class="grow"></div><div class="bill-head"><div class="big expired">${I.clock()}</div><h3 class="res">這張已逾期</h3><p class="why" style="margin-top:8px">你沒有在期限內回覆，鏈上已記錄。</p></div>${kv}<div class="grow"></div>`;
}

// ---------- guide + dock ----------
const STEPS = [["勞工送出補薪單", "送出"], ["老闆補發或異議", "老闆回覆"], ["看鏈上收據", "看收據"]];
function guideState() {
  const nar = isNarrow(), v = S.view;
  // where the next button is: desktop says left / right; a phone says "below" or names the switch button
  const go = (side, btn, extra = "") => {
    if (!nar) return `現在按${side === "worker" ? "左邊" : "右邊"}的「<b>${btn}</b>」${extra}`;
    if (v === side) return `現在按下面的「<b>${btn}</b>」${extra}`;
    const dock = side === "boss" ? (S.phase === "waiting" ? "換成老闆看看" : "") : (S.phase === "due" ? "回勞工記為逾期" : "");
    return dock ? `按下面的「<b>${dock}</b>」` : `先按上方的「${side === "worker" ? "勞工" : "老闆"}」，再按「${btn}」`;
  };
  const rep = reports[S.rep];
  switch (S.phase) {
    case "loading": return [0, "讀取 ME Network 測試網…"];
    case "fatal": return [0, "示範伺服器沒有回應，請稍後重新整理。"];
    case "draft": return S.emp === "unverified"
      ? [3, go("worker", `請老闆補發 ${ntd(rep.short)}`, "，看合約怎麼擋下")]
      : [0, go("worker", `請老闆補發 ${ntd(rep.short)}`)];
    case "sending": return [S.emp === "unverified" ? 3 : 0, "寫上 ME Network 中，大約 5～10 秒…"];
    case "blocked": return [3, `合約擋下了。${go("worker", "改送給已驗證的公司")}`];
    case "waiting": {
      if (S.boss.busy) return [1, "老闆的回覆寫上 ME Network 中…"];
      const twd = S.rec?.claim && S.rec.claim !== "0" ? twdOf(S.rec.claim) : rep.short;
      return [1, go("boss", `補發 ${ntd(twd)}`, "，或「我有異議」")];
    }
    case "due": return [1, `老闆沒在期限內回覆。${go("worker", "記為逾期")}`];
    case "marking": return [1, "寫上 ME Network 中…"];
    case "done": return S.tried ? [2, "完成。打開左邊的「鏈上收據」可以核對每一步"] : [2, `完成。${go("worker", "試試看：沒有 ME ID 的公司", "，看合約怎麼擋假老闆")}`];
    default: return [0, ""];
  }
}
function renderGuide() {
  const [cur, text] = guideState();
  const four = S.showFour || cur === 3;
  const li = (i, [long, sh]) => `<li class="${i < cur && cur !== 3 ? "done" : i === cur ? "on" : ""}"${i === cur ? ' aria-current="step"' : ""}><span class="n">${i < cur && cur !== 3 ? I.check() : i + 1}</span><span class="long">${long}</span><span class="short">${sh}</span></li>`;
  const fourLi = four ? `<li class="${cur === 3 ? "on" : ""}"${cur === 3 ? ' aria-current="step"' : ""}>${cur === 3 || !["done", "draft"].includes(S.phase)
    ? `<span class="n">4</span><span class="long">試試看：沒有 ME ID 的公司</span><span class="short">試擋下</span>`
    : `<button type="button" data-act="four"><span class="n">4</span><span class="long">試試看：沒有 ME ID 的公司</span><span class="short">試擋下</span></button>`}</li>` : "";
  void li; void fourLi;
  const tag = cur === 3 ? "加碼示範" : `第 ${cur + 1} 步，共 3 步`;
  $("now").innerHTML = text ? `<span class="steptag">${tag}</span><span>${text}</span>` : "";
}
function renderDock() {
  const d = $("dock");
  let btn = "";
  if (isNarrow()) {
    if (S.view === "worker" && S.phase === "waiting") btn = `<button class="btn primary" type="button" data-act="view" data-view="boss">換成老闆看看 ${I.arrow()}</button>`;
    else if (S.view === "boss" && (S.phase === "done" || S.phase === "due")) btn = `<button class="btn primary" type="button" data-act="view" data-view="worker">${S.phase === "due" ? "回勞工記為逾期" : "回勞工看結果"} ${I.arrow()}</button>`;
  }
  d.innerHTML = btn; d.hidden = !btn;
  document.body.classList.toggle("has-dock", !!btn);
}
function renderSwitch() {
  document.body.dataset.view = S.view;
  $("whoNow").textContent = `現在：${S.view === "worker" ? "勞工" : "老闆"}`;
  for (const b of document.querySelectorAll(".roles button")) b.setAttribute("aria-selected", String(b.dataset.view === S.view));
}

// ---------- evidence strip ----------
function renderEvidence() {
  if (!info) return;
  $("evhead").innerHTML = `<p class="evplain">這份合約公開在 ME Network 上，任何人都能核對</p><span class="meta">合約 <b title="${esc(info.contract)}">${short(info.contract, 9, 6)}</b>
      <button class="icon-btn" type="button" data-act="copy" aria-label="複製合約地址">${S.copied ? "已複製" : I.copy()}</button>
      <a href="${esc(smartUrl({ config: {} }))}" target="_blank" rel="noopener">查證${I.ext()}</a></span>
    <span class="meta total">${S.evTotal != null ? `ME Network 測試網・已完成 <b>${num(S.evTotal)}</b> 筆交易` : "讀取中…"}</span>`;
  const rows = [...S.evLocal, ...S.ev].sort((a, b) => b.time - a.time).slice(0, 6);
  const hd = `<div class="evrow hd" role="row"><span role="columnheader">時間</span><span role="columnheader">誰簽</span><span role="columnheader">發生了什麼</span><span role="columnheader" style="text-align:right">區塊</span><span role="columnheader">交易</span></div>`;
  const body = rows.map((r) => {
    const id = r.hash || r.key, isFresh = S.fresh.has(id);
    if (isFresh) setTimeout(() => S.fresh.delete(id), 1300);
    const link = r.hash ? `<a href="${esc(txUrl(r.hash))}" target="_blank" rel="noopener">${short(r.hash)}${I.ext()}</a>`
      : r.link ? `<a href="${esc(r.link)}" target="_blank" rel="noopener">被拒交易${I.ext()}</a>` : "";
    return `<div class="evrow${r.pend ? " pend" : ""}${r.rej ? " rej" : ""}${isFresh ? " fresh" : ""}" role="row">
      <span class="t" role="cell">${hms(r.time)}</span><span class="who" role="cell">${esc(r.who)}</span>
      <span class="what" role="cell"><b>${r.pend ? `<span class="spin"></span>` : ""}${esc(r.what)}</b>${r.mine ? `<span class="mine">這個瀏覽器</span>` : ""}<span class="s">${esc(r.sub)}</span></span>
      <span class="h" role="cell">${r.height ? `區塊 ${num(r.height)}` : r.rej ? "沒有上鏈" : ""}</span><span class="x" role="cell">${link}</span></div>`;
  }).join("");
  $("evrows").innerHTML = hd + (body || `<p class="evnote">${S.evErr ? "讀不到 ME Network 測試網，幾秒後自動重試。" : "讀取鏈上交易中…"}</p>`)
    + (S.evErr && body ? `<p class="evnote">讀不到最新交易，幾秒後自動重試。</p>` : "");
  $("foot").innerHTML = `<span>ME Network 測試網上的真實交易・示範資料人名公司皆虛構・示範換算非真實匯率</span>
    <a href="${esc(smartUrl({ list: { limit: 30 } }))}" target="_blank" rel="noopener">所有鏈上紀錄${S.count != null ? `（${num(S.count)} 筆）` : ""}${I.ext()}</a>
    <details${S.rulesOpen ? " open" : ""} data-rules><summary>合約規則</summary><ul>
      <li>老闆的 ME ID 至少要「${LV[info.minEmployerLevel] || "真人驗證"}」，不然合約不收補薪單。</li>
      <li>老闆補發時，要在同一筆交易付剛好的 MEC，合約直接轉給勞工。</li>
      <li>過了回覆期限，老闆就不能回覆；任何人都能把它記為逾期。</li>
      <li>上鏈的只有報告和理由的指紋，內容留在自己手上。</li></ul>
      <a href="${esc(smartUrl({ config: {} }))}" target="_blank" rel="noopener">看合約設定${I.ext()}</a></details>`;
}

// ---------- render ----------
let lastW = "", lastB = "";
const stable = (h) => h.replace(/(data-(?:left|since)="[^"]*">)[^<]*/g, "$1");
function renderWorker() {
  const h = workerHtml();
  if (stable(h) === lastW) return;
  lastW = stable(h);
  const el = $("worker"), d = el.querySelector("details.receipt");
  S.openReceipt = d && d.dataset.ph === S.phase ? d.open : null; // keep a manual toggle only within the same step
  el.innerHTML = h;
  tick();
}
function renderBoss() {
  const h = bossHtml();
  if (stable(h) === lastB) return;
  lastB = stable(h);
  const el = $("boss"), focused = document.activeElement?.id === "reason";
  el.innerHTML = h;
  if (focused && $("reason")) { const i = $("reason"); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }
  tick();
}
function render() { renderSwitch(); renderGuide(); renderWorker(); renderBoss(); renderDock(); }
function arrive() {
  const b = $("boss");
  b.classList.remove("arrive"); void b.offsetWidth; b.classList.add("arrive");
  setTimeout(() => b.classList.remove("arrive"), 700);
}

let lastPollAt = 0;
function tick() {
  const now = chainNow();
  for (const el of document.querySelectorAll("[data-left]")) el.textContent = clockText(Number(el.dataset.left) - now);
  for (const el of document.querySelectorAll("[data-since]")) el.textContent = Math.max(0, Math.floor((Date.now() - Number(el.dataset.since)) / 1000));
  if (S.phase === "waiting" && S.rec && now >= S.rec.deadline && Date.now() - lastPollAt > 1500) { lastPollAt = Date.now(); poll(); }
}

// ---------- events ----------
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-act]");
  if (!b || b.disabled) return;
  const act = b.dataset.act;
  if (act === "submit") return submit();
  if (act === "confirm") return confirmPay();
  if (act === "dispute") return dispute();
  if (act === "expire") return markExpired();
  if (act === "emp") { S.emp = S.emp === "verified" ? "unverified" : "verified"; if (S.emp === "unverified") S.showFour = true; S.sendErr = null; }
  else if (act === "rep") { S.rep = (S.rep + 1) % reports.length; S.sendErr = null; }
  else if (act === "fixEmp") { S.emp = "verified"; S.phase = "draft"; S.blocked = null; }
  else if (act === "again") { fresh(); S.emp = "verified"; }
  else if (act === "four") { fresh(); S.emp = "unverified"; S.view = "worker"; }
  else if (act === "openDispute") { S.boss.open = true; S.boss.err = null; render(); $("reason")?.focus(); return; }
  else if (act === "closeDispute") { S.boss.open = false; S.boss.reasonErr = false; }
  else if (act === "view") { S.view = b.dataset.view; render(); window.scrollTo({ top: 0 }); return; }
  else if (act === "copy") {
    navigator.clipboard?.writeText(info.contract).then(() => { S.copied = true; renderEvidence(); setTimeout(() => { S.copied = false; renderEvidence(); }, 1500); }).catch(() => {});
    return;
  }
  render();
});
document.addEventListener("change", (e) => { if (e.target.name === "win") { S.win = Number(e.target.value); renderWorker(); } });
document.addEventListener("input", (e) => {
  if (e.target.id === "reason") { S.boss.reason = e.target.value; if (S.boss.reasonErr && S.boss.reason.trim()) { S.boss.reasonErr = false; renderBoss(); } }
});
document.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.id === "reason") dispute(); });
document.addEventListener("toggle", (e) => { if (e.target.matches?.("[data-rules]")) S.rulesOpen = e.target.open; }, true);
window.matchMedia("(max-width: 1023px)").addEventListener("change", () => { lastB = ""; render(); });

async function init() {
  render();
  try { await loadReports(); } catch { /* shown below */ }
  render();
  try { info = await getJson("/api/demo"); } catch { S.phase = "fatal"; render(); return; }
  if (!info.worker || !info.employer) { S.phase = "fatal"; render(); return; }
  await Promise.all([syncClock().catch(() => {}), loadLevel(info.employer), loadLevel(info.employers.unverified)]);
  // resume only a claim this browser sent that is still open; otherwise start fresh (shared demo accounts)
  const last = mine().slice(-1)[0];
  S.phase = "draft";
  if (last) {
    try {
      await loadRecord(last);
      if (S.rec.status !== "pending") fresh(); else await loadTxs(last).catch(() => {});
    } catch { fresh(); }
  }
  render();
  loadEvidence();
  setInterval(tick, 1000);
  setInterval(poll, 4000);
  setInterval(() => { if (!document.hidden) loadEvidence(); }, 20000);
}
init();
})();
