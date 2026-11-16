// Online demo page (CosmWasm contract on ME testnet Hub). Reads ONLY from chain, straight from Hub REST
// (contract smart queries, block time, tx search); writes go through /api/demo, where the server signs with
// two testnet-only demo accounts. The page never decides a status: it shows what the contract returns.
(() => {
"use strict";
const $ = (id) => document.getElementById(id);
const ST = { pending: 1, confirmed: 2, disputed: 3, expired: 4 };
const LABEL = ["—", "等待雇主回應 Pending", "雇主已確認 Confirmed", "雇主已異議 Disputed", "逾期未回應 Expired"];
const REPORTS = ["/demo/synthetic-report.json", "/demo/synthetic-report-2.json"];
const SHOW = 10;
const ERR_ZH = {
  EmployerNotVerified: "指定的雇主沒有達到合約要求的 ME ID 等級",
  NotEmployer: "只有這筆紀錄指定的雇主能回應",
  NotPending: "這筆已經結案，不能再改",
  DeadlinePassed: "已過期限，雇主不能再回應",
  DeadlineNotPassed: "期限還沒到，還不能記為逾期",
  NoSuchRecord: "沒有這筆紀錄",
  BadWindow: "期限不在合約允許範圍",
  ZeroHash: "指紋不能是全 0",
  BadHash: "指紋格式不對",
  BadEmployer: "雇主地址不合法",
  MeIdQueryFailed: "合約查不到 ME ID 模組，為了安全直接拒絕",
};

let info, role = "worker", reportHash = null, employerChoice = "verified";
let clockOffset = 0;                 // chain time - local time (seconds)
let records = [];                    // last read from chain
const txByRecord = new Map();        // id -> { status, list: [{label, hash}] }
let refreshing = false, timer = null;

const short = (a) => (a ? `${a.slice(0, 9)}…${a.slice(-6)}` : "—");
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const txUrl = (h) => `${info.hubRest}/cosmos/tx/v1beta1/txs/${h}`;
const b64 = (o) => btoa(unescape(encodeURIComponent(JSON.stringify(o))));
const smartUrl = (q) => `${info.hubRest}/cosmwasm/wasm/v1/contract/${info.contract}/smart/${encodeURIComponent(b64(q))}`;

async function getJson(url) {
  const res = await fetch(url, { cache: "no-store" });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.message || `HTTP ${res.status}`);
  return body;
}
const query = async (q) => (await getJson(smartUrl(q))).data;

// ---------- ME ID level, read straight from ME testnet Hub REST in the browser ----------
// Same mapping as the contract: active DID + KYC_LEVEL_TWO = Advanced, KYC_LEVEL_ONE = Real-person,
// "DID not found" = None, anything else = lookup failed (never guessed).
const LV = { two: "進階驗證 Advanced", one: "真人驗證 Real-person", none: "未驗證 None", err: "查詢失敗", wait: "查詢中…" };
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
function levelOf(me1) {
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
      if (id) { const t = txByRecord.get(id) || { list: [] }; if (!t.list.some((x) => x.hash === j.txHash)) t.list.push({ label: { submit: "登記", confirm: "確認", dispute: "異議", markExpired: "記為逾期" }[body.action], hash: j.txHash }); txByRecord.set(id, t); }
      const lv = j.levelsStoredOnChain ? `，合約寫入的等級：雇主 ${esc(LV[j.levelsStoredOnChain.employer] || j.levelsStoredOnChain.employer)}` : "";
      log(`${label} 成功${id ? `（紀錄 #${id}）` : ""}，區塊 ${j.blockNumber ?? "—"}，鏈上狀態 ${esc(j.status ?? "—")}${lv}<br>交易 <code>${esc(j.txHash)}</code>　<a href="${esc(j.verifyUrl)}" target="_blank" rel="noopener">在鏈上查證</a>`);
    } else if (j.code === "employer_not_verified") {
      const e = j.meId?.employer;
      log(`${label} 被合約拒絕：EmployerNotVerified（${esc(ERR_ZH.EmployerNotVerified)}）。雇主 <code>${esc(e?.address || "")}</code> 在合約眼中是「${esc(e?.label || "")}」。沒有送出交易。<a href="${esc(j.rejectProofUrl)}" target="_blank" rel="noopener">看合約在鏈上真的拒絕過的那筆交易</a>`);
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
  const min = LV[m.minEmployerLevel] || m.minEmployerLevel;
  if (j.code === "employer_not_verified") {
    box.innerHTML = `<div class="blocked"><h3>合約拒絕：指定的雇主沒有通過真人驗證</h3>
      <p>這條規則寫在鏈上的合約裡：合約自己向 ME Network 的身分模組查詢雇主的 ME ID，等級低於「${esc(min)}」就拒絕登記。這次合約查到的是「${esc(m.employer.label || "查詢失敗")}」，所以沒有產生任何交易，鏈上紀錄數不變。</p>
      <p>合約回的錯誤原文：<code>${esc(j.contractMessage || j.contractError)}</code></p>
      ${partyLine("雇主", m.employer)}${partyLine("勞工", m.worker)}
      <p>同樣的拒絕真的上過鏈：<a href="${esc(j.rejectProofUrl)}" target="_blank" rel="noopener">合約拒絕沒有 ME ID 雇主的交易</a>（結果碼 5，EmployerNotVerified）。測試網的 ME ID 是模擬身分。</p></div>`;
  } else if (j.ok) {
    const st = j.levelsStoredOnChain;
    box.innerHTML = `<div class="passed"><p><b>合約查過雇主的 ME ID，通過，已登記為 #${esc(j.id)}</b></p>${partyLine("雇主", m.employer)}${partyLine("勞工", m.worker)}
      ${st ? `<p>合約把登記當下查到的等級寫進這筆紀錄：雇主「${esc(LV[st.employer] || st.employer)}」、勞工「${esc(LV[st.worker] || st.worker)}」。之後就算身分有變，也查得到當時的狀態。</p>` : ""}</div>`;
  } else {
    box.innerHTML = "";
  }
}

async function loadTxs(r) {
  const c = txByRecord.get(r.id);
  if (c && c.status === r.status && c.full) return;
  const url = `${info.hubRest}/cosmos/tx/v1beta1/txs?events=${encodeURIComponent(`wasm._contract_address='${info.contract}'`)}&events=${encodeURIComponent(`wasm.id='${r.id}'`)}`;
  const j = await getJson(url);
  const name = { submit: "登記", confirm: "確認", dispute: "異議", mark_expired: "記為逾期" };
  const list = [];
  for (const t of j.tx_responses || []) {
    if (t.code !== 0) continue;
    const ev = (t.logs?.[0]?.events || []).find((e) => e.type === "wasm");
    const action = ev?.attributes.find((a) => a.key === "action")?.value;
    const id = ev?.attributes.find((a) => a.key === "id")?.value;
    if (Number(id) !== r.id) continue;
    list.push({ label: name[action] || action, hash: t.txhash });
  }
  txByRecord.set(r.id, { status: r.status, list, full: true });
}

async function refresh() {
  if (refreshing) return;
  refreshing = true;
  try {
    const latest = await getJson(`${info.hubRest}/cosmos/base/tendermint/v1beta1/blocks/latest`);
    clockOffset = Date.parse(latest.block.header.time) / 1000 - Date.now() / 1000;
    const list = await query({ list: { limit: SHOW } });
    records = await Promise.all(list.map(async (r) => {
      const eff = r.status === "pending" ? await query({ effective_status: { id: r.id } }).catch(() => r.status) : r.status;
      return { ...r, stored: ST[r.status], eff: ST[eff] };
    }));
    await Promise.all(records.map((r) => loadTxs(r).catch(() => {})));
    render();
  } catch (e) {
    $("rows").innerHTML = `<p class="empty">讀取鏈上資料失敗：${esc(e.message)}</p>`;
  } finally {
    refreshing = false;
    clearTimeout(timer);
    timer = setTimeout(refresh, records.some((r) => r.stored === 1) ? 6000 : 20000);
  }
}

function left(r) { return Math.max(0, Math.round(r.deadline - (Date.now() / 1000 + clockOffset))); }
function fmtLeft(s) { const m = Math.floor(s / 60), x = s % 60; return m ? `${m} 分 ${String(x).padStart(2, "0")} 秒` : `${x} 秒`; }

function recordHtml(r, mode) {
  const statusText = LABEL[r.eff] + (r.eff === 4 && r.stored === 1 ? "（已過期限，尚未寫入鏈上）" : "");
  const timeText = r.eff === 1 ? `剩餘 <span class="count" data-deadline="${r.deadline}">${fmtLeft(left(r))}</span>`
    : `期限 ${new Date(r.deadline * 1000).toLocaleString("zh-TW", { hour12: false })}`;
  const isDemoEmployer = info.employer && r.employer === info.employer;
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
  const txs = (txByRecord.get(r.id)?.list || []).map((t) =>
    `<div>${esc(t.label)}　<code>${short(t.hash)}</code>　<a href="${txUrl(t.hash)}" target="_blank" rel="noopener">在鏈上查證</a></div>`).join("");
  return `<div class="rec s${r.eff}">
    <div class="id">#${r.id}</div>
    <div><div class="st">${statusText}</div><div class="kv">${timeText}</div>
      <div class="kv">報告指紋 <code>${short(r.report_hash)}</code></div>
      ${r.eff === 3 && r.reason_hash ? `<div class="kv">理由指紋 <code>${short(r.reason_hash)}</code></div>` : ""}
      <div class="kv">登記當下合約查到的雇主等級：<b>${esc(LV[r.employer_level] || r.employer_level)}</b>（寫在紀錄裡）</div></div>
    <div><div class="kv">勞工 <b class="mono">${short(r.worker)}</b>${info.worker && r.worker === info.worker ? "（示範勞工）" : ""} ${badge(r.worker)}</div>
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
    ["unverified", "未驗證的地址（示範被合約拒絕）", "一個沒有 ME ID 的測試網地址。選它按登記，合約查到等級不夠就拒絕，不會產生紀錄。"],
  ];
  box.innerHTML = items.map(([k, t, d]) => `<label class="opt emp"><input type="radio" name="emp" value="${k}" ${employerChoice === k ? "checked" : ""}>
    <span><span class="t">${t}</span><br><span class="d"><code>${esc(info.employers[k])}</code> ${badge(info.employers[k])}</span><br><span class="d">${d}</span></span></label>`).join("");
}

function render() {
  if (!info) return;
  renderEmployers();
  $("rows").innerHTML = records.length ? records.map((r) => recordHtml(r, "list")).join("") : `<p class="empty">還沒有紀錄。</p>`;
  const mine = records.filter((r) => r.eff === 1 && info.employer && r.employer === info.employer);
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
  out.innerHTML = `<span class="lvl wait">${LV.wait}</span>`;
  const r = await queryLevel(a);
  levels.set(a, { ...r, at: Date.now() });
  out.innerHTML = `<span class="lvl ${r.state}">${LV[r.state]}</span>　節點回：${esc(r.raw)}　<a href="${esc(r.url)}" target="_blank" rel="noopener">在鏈上查證</a>`;
}

async function init() {
  info = await (await fetch("/api/demo", { cache: "no-store" })).json();
  $("contractAddr").textContent = `${info.contract}（CosmWasm，code id ${info.codeId}）`;
  $("contractLink").href = txUrl(info.instTx);
  $("contractLink").textContent = "部署交易在鏈上查證";
  $("contractConfig").href = smartUrl({ config: {} });
  $("rejectProof").href = txUrl(info.rejectProofTx);
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
  log(`連上 ME 測試網 Hub（${esc(info.chainId)}），合約 <code>${esc(info.contract)}</code>`);
  setInterval(tick, 1000);
  refresh();
}

init().catch((e) => log(`初始化失敗：${esc(e.message)}`));
})();
