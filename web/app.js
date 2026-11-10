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

let info, provider, contract, role = "worker", reportHash = null;
let clockOffset = 0;                 // chain time - local time (seconds)
let records = [];                    // last read from chain
const txByRecord = new Map();        // id -> [{label, hash}]
let refreshing = false, timer = null;

const short = (a) => (a ? `${a.slice(0, 8)}…${a.slice(-6)}` : "—");
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const verifyUrl = (h) => `${info.hubRest}/cosmos/tx/v1beta1/txs?events=${encodeURIComponent(`ethereum_tx.ethereumTxHash='${h}'`)}`;

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
    if (j.ok) {
      const id = j.id ?? body.id;
      if (id) { const l = txByRecord.get(id) || []; l.push({ label, hash: j.txHash }); txByRecord.set(id, l); }
      log(`${label} 成功${id ? `（紀錄 #${id}）` : ""}，區塊 ${j.blockNumber ?? "未出塊"}，鏈上狀態 ${esc(j.status ?? "—")}<br>交易 <code>${esc(j.txHash)}</code>　<a href="${esc(j.verifyUrl)}" target="_blank" rel="noopener">在鏈上查證</a>`);
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
    <div><div class="kv">勞工 <b class="mono">${short(r.worker)}</b>${info.worker && r.worker.toLowerCase() === info.worker.toLowerCase() ? "（示範勞工）" : ""}</div>
      <div class="kv">雇主 <b class="mono">${short(r.employer)}</b>${isDemoEmployer ? "（示範雇主）" : ""}</div></div>
    ${txs ? `<div class="txs">${txs}</div>` : ""}
    ${acts}
  </div>`;
}

function render() {
  if (!info) return;
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
  if (!/^me1[0-9a-z]{38}$/.test(a)) { out.textContent = "請輸入 me1 開頭、共 41 個字元的地址。"; return; }
  out.textContent = "查詢中…";
  try {
    const res = await fetch(`${info.hubRest}/metaearth/did/did?address=${encodeURIComponent(a)}`);
    const body = await res.json().catch(() => ({}));
    if (res.ok && body.info?.did) {
      out.textContent = `有 ME ID。節點回傳：狀態 ${body.info.status ?? "（未提供）"}，等級 ${body.info.kycLevel ?? "（未提供）"}。`;
    } else if (String(body.message || "").includes("DID not found")) {
      out.textContent = "沒有 ME ID（No ME ID）。這個地址在 ME 測試網上查不到 ME ID。";
    } else {
      out.textContent = `無法判斷：節點回 HTTP ${res.status}。`;
    }
  } catch (e) { out.textContent = `連不上 ME 測試網 Hub：${e.message}`; }
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
    callDemo({ action: "submit", reportHash, deadlineSeconds: secs }, e.currentTarget);
  };
  $("rows").onclick = onAction;
  $("pending").onclick = onAction;
  $("meidBtn").onclick = lookupMeId;
  $("meidAddr").onkeydown = (e) => { if (e.key === "Enter") lookupMeId(); };
  await loadReports();
  setRole("worker");
  log(`連上 ME 測試網（鏈 ID ${info.chainId}），合約 <code>${esc(info.contract)}</code>`);
  setInterval(tick, 1000);
  refresh();
}

init().catch((e) => log(`初始化失敗：${esc(e.message)}`));
})();
