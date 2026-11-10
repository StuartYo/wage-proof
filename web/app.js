// Online demo page. Reads ONLY from chain (through /api/rpc, a read-only relay);
// writes go through /api/demo, where the server signs with two testnet-only demo accounts.
// The page never decides a status: it shows effectiveStatus() and getRecord() from the contract.
(() => {
"use strict";
const ethers = window.ethers;
const $ = (id) => document.getElementById(id);
const LABEL = ["—", "等待雇主回應 Pending", "雇主已確認 Confirmed", "雇主已異議 Disputed", "逾期未回應 Expired"];
const REPORTS = ["/demo/synthetic-report.json", "/demo/synthetic-report-2.json"];
const DEPLOY_TX = "0xfa017bd543ed4fc014f454e2a82bf869e1146af95d6e7b0fdf2b035b043fc407";
const DEPLOY_BLOCK = 5248543;
const SHOW = 10;
const ERR_ZH = {
  NotEmployer: "只有這筆紀錄指定的雇主能回應",
  NotPending: "這筆已經結案，不能再改",
  DeadlinePassed: "已過期限，雇主不能再回應",
  DeadlineNotPassed: "期限還沒到，還不能記為逾期",
  NoSuchRecord: "沒有這筆紀錄",
  BadWindow: "期限不在合約允許範圍",
  ZeroHash: "指紋不能是全 0",
  BadEmployer: "雇主地址不合法",
};

let info, provider, contract, role = "worker", reportHash = null, employerChoice = "verified";
let clockOffset = 0;                 // chain time - local time (seconds)
let records = [];                    // last read from chain
const txByRecord = new Map();        // id -> [{label, hash}]
let refreshing = false, timer = null;

const short = (a) => (a ? `${a.slice(0, 8)}…${a.slice(-6)}` : "—");
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const verifyUrl = (h) => `${info.hubRest}/cosmos/tx/v1beta1/txs?events=${encodeURIComponent(`ethereum_tx.ethereumTxHash='${h}'`)}`;

// ---------- ME ID level, read straight from ME testnet Hub REST in the browser ----------
// Same rule as the server (api/_lib.mjs meIdLevel): active DID + KYC_LEVEL_TWO = Advanced,
// KYC_LEVEL_ONE = Real-person, "DID not found" = None, anything else = lookup failed (never guessed).
const LV = { two: "進階驗證 Advanced", one: "真人驗證 Real-person", none: "未驗證 None", err: "查詢失敗", wait: "查詢中…" };
const B32 = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
function toMe1(evm) {
  const bytes = evm.slice(2).match(/../g).map((h) => parseInt(h, 16));
  const words = []; let acc = 0, bits = 0;
  for (const b of bytes) { acc = (acc << 8) | b; bits += 8; while (bits >= 5) { bits -= 5; words.push((acc >>> bits) & 31); } }
  if (bits) words.push((acc << (5 - bits)) & 31);
  const G = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const v of [3, 3, 0, 13, 5, ...words, 0, 0, 0, 0, 0, 0]) {           // hrp "me" expanded = [3,3,0,13,5]
    const top = chk >>> 25; chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((top >>> i) & 1) chk ^= G[i];
  }
  chk ^= 1;
  return "me1" + [...words, ...[0, 1, 2, 3, 4, 5].map((i) => (chk >>> (5 * (5 - i))) & 31)].map((w) => B32[w]).join("");
}
const levels = new Map();          // me1 -> { at, state, raw, url }
const meIdUrl = (me1) => `${info.hubRest}/metaearth/did/did?address=${encodeURIComponent(me1)}`;
let levelRender = null;
async function queryLevel(me1) {
  const url = meIdUrl(me1);
  try {
    const res = await fetch(url, { cache: "no-store" });
    const body = await res.json().catch(() => null);
    const i = body?.info;
    if (res.ok && i?.did) {
      const lv = i.status === "DID_STATUS_ACTIVE" ? ({ KYC_LEVEL_TWO: "two", KYC_LEVEL_ONE: "one" }[i.kycLevel] || "none") : "none";
      return { state: lv, raw: `${i.kycLevel ?? "（未提供等級）"}，${i.status ?? ""}`, url };
    }
    if (String(body?.message || "").includes("DID not found")) return { state: "none", raw: "DID not found", url };
    return { state: "err", raw: `節點回 HTTP ${res.status}`, url };
  } catch (e) { return { state: "err", raw: `連不上 Hub：${e.message}`, url }; }
}
function levelOf(addr) {
  const me1 = addr.startsWith("0x") ? toMe1(addr) : addr;
  const c = levels.get(me1);
  if (!c || (!c.pending && Date.now() - c.at > 30000)) {
    levels.set(me1, { state: c && c.state !== "err" ? c.state : "wait", raw: c?.raw, at: Date.now(), url: meIdUrl(me1), pending: true });
    queryLevel(me1).then((r) => {
      levels.set(me1, { ...r, at: Date.now() });
      clearTimeout(levelRender); levelRender = setTimeout(render, 50);
    });
  }
  return levels.get(me1);
}
function badge(addr) {
  const c = levelOf(addr);
  return `<span class="lvl ${c.state}" title="${esc(c.raw || "")}">${LV[c.state]}</span> <a class="lvlrow" href="${esc(c.url)}" target="_blank" rel="noopener">在鏈上查證</a>`;
}

function log(html) {
  const line = document.createElement("div");
  line.innerHTML = `[${new Date().toLocaleTimeString("zh-TW", { hour12: false })}] ${html}`;
  $("log").prepend(line);
}

async function sha256Hex(bytes) {
  const d = await crypto.subtle.digest("SHA-256", bytes);
  return "0x" + [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function loadReports() {
  const box = $("reports");
  box.innerHTML = "";
  for (const [i, url] of REPORTS.entries()) {
    const raw = new Uint8Array(await (await fetch(url, { cache: "no-store" })).arrayBuffer());
    const r = JSON.parse(new TextDecoder().decode(raw));
    const h = await sha256Hex(raw);
    const lab = document.createElement("label");
    lab.className = "opt";
    lab.innerHTML = `<input type="radio" name="rep" value="${h}" ${i === 0 ? "checked" : ""}>
      <span><span class="t">${esc(r.period)}｜${esc(r.worker.displayName)} × ${esc(r.employer.displayName)}</span><br>
      <span class="d">${esc(r.summary)}</span><br><span class="d">檔案 <a href="${url}" target="_blank" rel="noopener">${url.split("/").pop()}</a></span></span>`;
    box.append(lab);
    if (i === 0) reportHash = h;
  }
  box.onchange = (e) => { if (e.target.name === "rep") { reportHash = e.target.value; $("reportHash").textContent = reportHash; } };
  $("reportHash").textContent = reportHash;
}

function setRole(r) {
  role = r;
  $("roleWorker").setAttribute("aria-pressed", String(r === "worker"));
  $("roleEmployer").setAttribute("aria-pressed", String(r === "employer"));
  $("workerPanel").hidden = r !== "worker";
  $("employerPanel").hidden = r !== "employer";
  const addr = r === "worker" ? info.worker : info.employer;
  $("me").innerHTML = `${r === "worker" ? "勞工 Worker" : "雇主 Employer"} <code>${esc(addr || "未設定")}</code>（線上示範帳號，伺服器代簽）`;
  render();
}

async function callDemo(body, btn) {
  if (btn) { btn.disabled = true; btn.classList.add("busy"); }
  const label = { submit: "登記", confirm: `確認 #${body.id}`, dispute: `異議 #${body.id}`, markExpired: `記為逾期 #${body.id}` }[body.action];
  log(`${label}：送出中…（等出塊約 5～10 秒）`);
  try {
    const res = await fetch("/api/demo", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = await res.json().catch(() => ({}));
    if (body.action === "submit") showSubmitResult(j);
    if (j.ok) {
      const id = j.id ?? body.id;
      if (id) { const l = txByRecord.get(id) || []; l.push({ label, hash: j.txHash }); txByRecord.set(id, l); }
      log(`${label} 成功${id ? `（紀錄 #${id}）` : ""}，區塊 ${j.blockNumber ?? "未出塊"}，鏈上狀態 ${esc(j.status ?? "—")}<br>交易 <code>${esc(j.txHash)}</code>　<a href="${esc(j.verifyUrl)}" target="_blank" rel="noopener">在鏈上查證</a>`);
    } else if (j.code === "employer_not_verified") {
      const e = j.meId.employer;
      log(`${label} 被擋下，沒有送出交易：雇主 <code>${esc(e.address)}</code> 的 ME ID 等級是「${esc(e.label)}」（節點回：${esc(e.kycLevel ?? e.status)}），規則要求至少「${esc(LV[j.meId.minEmployerLevel])}」。<a href="${esc(e.queryUrl)}" target="_blank" rel="noopener">在鏈上查證</a>`);
    } else if (j.code === "meid_lookup_failed") {
      log(`${label} 沒有送出：查不到雇主的 ME ID 等級（${esc(j.meId?.employer?.message || "")}），無法判斷，所以不送交易。`);
    } else if (j.code === "contract_rejected") {
      log(`${label} 被合約拒絕：${esc(j.contractError)}（${esc(ERR_ZH[j.contractError] || "合約規則不允許")}）。沒有送出交易。`);
    } else {
      log(`${label} 沒有送出：${esc(j.message || `HTTP ${res.status}`)}`);
    }
  } catch (e) {
    log(`${label} 失敗：${esc(e.message)}`);
  } finally {
    if (btn) { btn.classList.remove("busy"); btn.disabled = false; }
    refresh();
  }
}

function partyLine(who, p) {
  if (!p) return "";
  const lv = p.ok ? p.level : "err";
  return `<p>${who} <code>${esc(p.address)}</code>：<span class="lvl ${lv}">${LV[lv]}</span>　節點回：${esc(p.ok ? (p.kycLevel ?? p.status) : p.message)}　<a href="${esc(p.queryUrl)}" target="_blank" rel="noopener">在鏈上查證</a></p>`;
}
function showSubmitResult(j) {
  const box = $("submitResult");
  const m = j.meId;
  if (!m) { box.innerHTML = ""; return; }
  const time = m.employer.checkedAt ? new Date(m.employer.checkedAt).toLocaleTimeString("zh-TW", { hour12: false }) : "";
  if (j.code === "employer_not_verified") {
    box.innerHTML = `<div class="blocked"><h3>沒有送出：指定的雇主沒有通過真人驗證</h3>
      <p>規則：雇主的 ME ID 等級至少要「${esc(LV[m.minEmployerLevel])}」，伺服器才會送出登記交易。這次查到的是「${esc(m.employer.label)}」，所以沒有產生任何交易，鏈上紀錄數不變。</p>
      ${partyLine("雇主", m.employer)}${partyLine("勞工", m.worker)}
      <p>查詢時間 ${esc(time)}，資料來源：ME 測試網 Hub。測試網的 ME ID 是模擬身分。</p></div>`;
  } else if (j.code === "meid_lookup_failed") {
    box.innerHTML = `<div class="blocked"><h3>沒有送出：查不到雇主的 ME ID 等級</h3>
      <p>ME 測試網 Hub 沒有正常回應，伺服器不猜「有」或「沒有」，所以這次不送交易。請稍後再試。</p>${partyLine("雇主", m.employer)}</div>`;
  } else {
    box.innerHTML = `<div class="passed"><p><b>真人檢查通過${j.ok ? "，已送出登記" : ""}</b>（查詢時間 ${esc(time)}）</p>${partyLine("雇主", m.employer)}${partyLine("勞工", m.worker)}</div>`;
  }
}

async function refresh() {
  if (refreshing) return;
  refreshing = true;
  try {
    const latest = await provider.getBlock("latest");
    clockOffset = latest.timestamp - Date.now() / 1000;
    const n = Number(await contract.recordCount());
    const ids = [];
    for (let id = n; id >= 1 && ids.length < SHOW; id--) ids.push(id);
    const got = await Promise.all(ids.map(async (id) => {
      const [r, eff] = await Promise.all([contract.getRecord(id), contract.effectiveStatus(id)]);
      return { id, worker: r.worker, employer: r.employer, reportHash: r.reportHash, reasonHash: r.reasonHash,
        submittedAt: Number(r.submittedAt), deadline: Number(r.deadline), closedAt: Number(r.closedAt), stored: Number(r.status), eff: Number(eff) };
    }));
    records = got;
    await loadTxs(latest.number).catch(() => {});
    render();
  } catch (e) {
    $("rows").innerHTML = `<p class="empty">讀取鏈上資料失敗：${esc(e.shortMessage || e.message)}</p>`;
  } finally {
    refreshing = false;
    clearTimeout(timer);
    timer = setTimeout(refresh, records.some((r) => r.stored === 1) ? 6000 : 20000);
  }
}

// transaction hashes of each record, from the contract's own events (not from page memory)
async function loadTxs(latestBlock) {
  const logs = await provider.getLogs({ address: info.contract, fromBlock: Math.max(DEPLOY_BLOCK, latestBlock - 40000), toBlock: latestBlock });
  const iface = contract.interface;
  const name = { Submitted: "登記", Confirmed: "確認", Disputed: "異議", Expired: "記為逾期" };
  for (const l of logs) {
    let ev; try { ev = iface.parseLog(l); } catch { continue; }
    if (!ev) continue;
    const id = Number(l.topics[1]);
    const list = txByRecord.get(id) || [];
    if (!list.some((x) => x.hash === l.transactionHash)) list.push({ label: name[ev.name] || ev.name, hash: l.transactionHash });
    txByRecord.set(id, list);
  }
}

function left(r) { return Math.max(0, Math.round(r.deadline - (Date.now() / 1000 + clockOffset))); }
function fmtLeft(s) { const m = Math.floor(s / 60), x = s % 60; return m ? `${m} 分 ${String(x).padStart(2, "0")} 秒` : `${x} 秒`; }

function recordHtml(r, mode) {
  const statusText = LABEL[r.eff] + (r.eff === 4 && r.stored === 1 ? "（已過期限，尚未寫入鏈上）" : "");
  const timeText = r.eff === 1 ? `剩餘 <span class="count" data-deadline="${r.deadline}">${fmtLeft(left(r))}</span>`
    : `期限 ${new Date(r.deadline * 1000).toLocaleString("zh-TW", { hour12: false })}`;
  const isDemoEmployer = info.employer && r.employer.toLowerCase() === info.employer.toLowerCase();
  let acts = "";
  if (mode === "pending") {
    acts = `<div class="acts">
      <button class="btn" data-a="confirm" data-id="${r.id}">確認 Confirm</button>
      <input id="reason-${r.id}" maxlength="200" placeholder="異議理由一句話（只送出它的指紋）" value="">
      <button class="btn ghost" data-a="dispute" data-id="${r.id}">異議 Dispute</button></div>`;
  } else if (r.eff === 4 && r.stored === 1) {
    acts = `<div class="acts"><button class="btn ink" data-a="markExpired" data-id="${r.id}">記為逾期未回應 Mark expired</button>
      <span class="kv">任何角色都能按</span></div>`;
  }
  const txs = (txByRecord.get(r.id) || []).map((t) =>
    `<div>${esc(t.label)}　<code>${short(t.hash)}</code>　<a href="${verifyUrl(t.hash)}" target="_blank" rel="noopener">在鏈上查證</a></div>`).join("");
  return `<div class="rec s${r.eff}">
    <div class="id">#${r.id}</div>
    <div><div class="st">${statusText}</div><div class="kv">${timeText}</div>
      <div class="kv">報告指紋 <code>${short(r.reportHash)}</code></div>
      ${r.eff === 3 ? `<div class="kv">理由指紋 <code>${short(r.reasonHash)}</code></div>` : ""}</div>
    <div><div class="kv">勞工 <b class="mono">${short(r.worker)}</b>${info.worker && r.worker.toLowerCase() === info.worker.toLowerCase() ? "（示範勞工）" : ""} ${badge(r.worker)}</div>
      <div class="kv">雇主 <b class="mono">${short(r.employer)}</b>${isDemoEmployer ? "（示範雇主）" : ""} ${badge(r.employer)}</div></div>
    ${txs ? `<div class="txs">${txs}</div>` : ""}
    ${acts}
  </div>`;
}

function renderEmployers() {
  const box = $("employers");
  if (!info.employers) { box.innerHTML = `<p class="empty">示範帳號未設定。</p>`; return; }
  const items = [
    ["verified", "示範雇主（已進階驗證）", "伺服器代簽的示範雇主帳號，在 ME 測試網有 ME ID。"],
    ["unverified", "未驗證的地址（示範被擋下）", "一個沒有 ME ID 的測試網地址。選它按登記，伺服器查到等級不夠就擋下，不送交易。"],
  ];
  box.innerHTML = items.map(([k, t, d]) => `<label class="opt emp"><input type="radio" name="emp" value="${k}" ${employerChoice === k ? "checked" : ""}>
    <span><span class="t">${t}</span><br><span class="d"><code>${esc(info.employers[k])}</code> ${badge(info.employers[k])}</span><br><span class="d">${d}</span></span></label>`).join("");
}

function render() {
  if (!info) return;
  renderEmployers();
  $("rows").innerHTML = records.length ? records.map((r) => recordHtml(r, "list")).join("") : `<p class="empty">還沒有紀錄。</p>`;
  const mine = records.filter((r) => r.eff === 1 && info.employer && r.employer.toLowerCase() === info.employer.toLowerCase());
  // keep what the user is typing across the periodic re-render
  const typed = {}; for (const el of document.querySelectorAll("#pending input[id^=reason-]")) typed[el.id] = el.value;
  const focused = document.activeElement?.id;
  $("pending").innerHTML = mine.length ? mine.map((r) => recordHtml(r, "pending")).join("")
    : `<p class="empty">目前沒有待回應的紀錄。先切到「勞工」登記一筆。</p>`;
  for (const [k, v] of Object.entries(typed)) { const el = $(k); if (el) el.value = v; }
  if (focused && focused.startsWith("reason-") && $(focused)) $(focused).focus();
}

function tick() {
  for (const el of document.querySelectorAll(".count[data-deadline]")) {
    const s = Math.max(0, Math.round(Number(el.dataset.deadline) - (Date.now() / 1000 + clockOffset)));
    el.textContent = s ? fmtLeft(s) : "0 秒（等待鏈上更新）";
  }
}

async function onAction(ev) {
  const b = ev.target.closest("button[data-a]");
  if (!b) return;
  const id = Number(b.dataset.id);
  if (b.dataset.a === "dispute") {
    const text = ($(`reason-${id}`)?.value || "").trim();
    if (!text) { log(`異議 #${id}：請先寫一句理由（只會送出它的指紋）`); return; }
    const reasonHash = await sha256Hex(new TextEncoder().encode(text));
    return callDemo({ action: "dispute", id, reasonHash }, b);
  }
  return callDemo({ action: b.dataset.a, id }, b);
}

async function lookupMeId() {
  const a = $("meidAddr").value.trim();
  const out = $("meidOut");
  let me1 = a;
  if (/^0x[0-9a-fA-F]{40}$/.test(a)) me1 = toMe1(a);
  else if (!/^me1[0-9a-z]{38}$/.test(a)) { out.textContent = "請輸入 me1 開頭、共 41 個字元的地址，或 0x 開頭、共 42 個字元的地址。"; return; }
  out.innerHTML = `<span class="lvl wait">${LV.wait}</span>`;
  const r = await queryLevel(me1);
  levels.set(me1, { ...r, at: Date.now() });
  out.innerHTML = `${me1 !== a ? `<code>${esc(me1)}</code><br>` : ""}<span class="lvl ${r.state}">${LV[r.state]}</span>　節點回：${esc(r.raw)}　<a href="${esc(r.url)}" target="_blank" rel="noopener">在鏈上查證</a>`;
}

async function init() {
  info = await (await fetch("/api/demo", { cache: "no-store" })).json();
  provider = new ethers.JsonRpcProvider(`${location.origin}/api/rpc`, info.chainId, { staticNetwork: true, batchMaxCount: 10 });
  contract = new ethers.Contract(info.contract, info.abi, provider);
  $("contractAddr").textContent = info.contract;
  $("contractLink").href = verifyUrl(DEPLOY_TX);
  $("contractLink").textContent = "部署交易在鏈上查證";
  $("roleWorker").onclick = () => setRole("worker");
  $("roleEmployer").onclick = () => setRole("employer");
  $("submitBtn").onclick = (e) => {
    const secs = Number(document.querySelector("input[name=win]:checked").value);
    callDemo({ action: "submit", reportHash, deadlineSeconds: secs, employer: employerChoice }, e.currentTarget);
  };
  $("rows").onclick = onAction;
  $("pending").onclick = onAction;
  $("meidBtn").onclick = lookupMeId;
  $("employers").onchange = (e) => { if (e.target.name === "emp") { employerChoice = e.target.value; $("submitResult").innerHTML = ""; } };
  $("meidAddr").onkeydown = (e) => { if (e.key === "Enter") lookupMeId(); };
  await loadReports();
  setRole("worker");
  log(`連上 ME 測試網（鏈 ID ${info.chainId}），合約 <code>${esc(info.contract)}</code>`);
  setInterval(tick, 1000);
  refresh();
}

init().catch((e) => log(`初始化失敗：${esc(e.message)}`));
})();
