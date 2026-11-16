// Online demo screen (CosmWasm contract on ME testnet Hub). Reads ONLY from chain, straight from Hub REST
// (contract smart queries, block time, tx search); writes go through /api/demo, where the server signs with
// two testnet-only demo accounts. The screen never decides a status: it shows what the contract returns.
(() => {
"use strict";
const $ = (id) => document.getElementById(id);
const ST = { pending: 1, confirmed: 2, disputed: 3, expired: 4 };
const STATUS = ["—", "等待回應", "雇主確認", "雇主異議", "逾期未回應"];
const LV = { two: "進階驗證", one: "真人驗證", none: "未驗證", err: "查詢失敗", wait: "查詢中…" };
const LV_RANK = { none: 0, one: 1, two: 2 };
const REPORTS = ["/demo/synthetic-report.json", "/demo/synthetic-report-2.json"];
const LIST_MAX = 30;
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
const VIEWS = [["all", "全部"], [1, "等待回應"], [2, "雇主確認"], [3, "雇主異議"], [4, "逾期未回應"]];

let info, reportHash = null, employerChoice = "verified", windowSecs = 60;
let clockOffset = 0, lastBlock = null;   // chain time - local time (seconds); latest block seen
let records = [], total = 0, loaded = false;
let view = "all", sel = null, mode = "detail", panelOpen = false, submitting = null;
const reports = new Map();               // hash (no 0x) -> report summary
const txByRecord = new Map();            // id -> { status, list: [{action, label, hash, height, time, fee, signer}] }
let refreshing = false, again = false, timer = null;

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const short = (a, h = 8, t = 6) => (a ? `${a.slice(0, h)}…${a.slice(-t)}` : "—");
const nt = (n) => `NT$${Number(n).toLocaleString("en-US")}`;
const txUrl = (h) => `${info.hubRest}/cosmos/tx/v1beta1/txs/${h}`;
const b64 = (o) => btoa(unescape(encodeURIComponent(JSON.stringify(o))));
const smartUrl = (q) => `${info.hubRest}/cosmwasm/wasm/v1/contract/${info.contract}/smart/${encodeURIComponent(b64(q))}`;
const chainNow = () => Date.now() / 1000 + clockOffset;
const ext = (href, text) => `<a href="${esc(href)}" target="_blank" rel="noopener">${text}</a>`;
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const two = (n) => String(n).padStart(2, "0");
const hms = (s) => { const d = new Date(s * 1000); return `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`; };
const mdhm = (s) => { const d = new Date(s * 1000); return `${d.getMonth() + 1}/${d.getDate()} ${two(d.getHours())}:${two(d.getMinutes())}`; };
const isNarrow = () => window.matchMedia("(max-width: 960px)").matches;

async function getJson(url) {
  const res = await fetch(url, { cache: "no-store" });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.message || `HTTP ${res.status}`);
  return body;
}
const query = async (q) => (await getJson(smartUrl(q))).data;

function dur(s) {
  s = Math.max(0, Math.round(s));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  if (h) return `${h} 小時${m ? ` ${m} 分` : ""}`;
  return m ? `${m} 分${x ? ` ${x} 秒` : ""}` : `${x} 秒`;
}
function clockText(s) {
  s = Math.max(0, Math.ceil(s));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return h ? `${h}:${two(m)}:${two(x)}` : `${m}:${two(x)}`;
}

// ---------- who is who ----------
function nameOf(addr) {
  if (!info) return short(addr, 10, 6);
  if (addr === info.worker) return "示範勞工";
  if (addr === info.employer) return "示範雇主";
  if (addr === info.employers?.unverified) return "沒有 ME ID 的地址";
  return short(addr, 10, 6);
}
const AV = { 示範勞工: ["勞", "#d0d6e0"], 示範雇主: ["雇", "#aab1c0"], "沒有 ME ID 的地址": ["？", "#62666d"] };
function avatar(addr) {
  const [ch, bg] = AV[nameOf(addr)] || ["地", "#8a8f98"];
  return `<span class="av" style="background:${bg}" aria-hidden="true">${ch}</span>`;
}

// ---------- status icons (Linear grammar: shape + colour + text) ----------
function icon(eff, p = 0) {
  if (eff === 1) {
    const a = clamp01(p) * Math.PI * 2;
    const x = (8 + 3.6 * Math.sin(a)).toFixed(2), y = (8 - 3.6 * Math.cos(a)).toFixed(2);
    const pie = p >= 0.995 ? `<circle cx="8" cy="8" r="3.6" fill="#f2c94c"/>`
      : p <= 0.005 ? "" : `<path d="M8 8V4.4A3.6 3.6 0 ${a > Math.PI ? 1 : 0} 1 ${x} ${y}Z" fill="#f2c94c"/>`;
    return `<svg class="i pie" viewBox="0 0 16 16" role="img" aria-label="等待回應"><circle cx="8" cy="8" r="6.3" fill="none" stroke="#f2c94c" stroke-width="1.5"/>${pie}</svg>`;
  }
  if (eff === 2) return `<svg class="i" viewBox="0 0 16 16" role="img" aria-label="雇主確認"><circle cx="8" cy="8" r="7" fill="#4cb782"/><path d="M5 8.2l2 2 4-4.2" fill="none" stroke="#0f1011" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  if (eff === 3) return `<svg class="i" viewBox="0 0 16 16" role="img" aria-label="雇主異議"><circle cx="8" cy="8" r="7" fill="#eb5757"/><path d="M5.6 5.6l4.8 4.8M10.4 5.6l-4.8 4.8" stroke="#0f1011" stroke-width="1.7" stroke-linecap="round"/></svg>`;
  return `<svg class="i" viewBox="0 0 16 16" role="img" aria-label="逾期未回應"><circle cx="8" cy="8" r="6.3" fill="none" stroke="#8a8f98" stroke-width="1.5"/><path d="M8 4.8V8l2.2 1.4" fill="none" stroke="#8a8f98" stroke-width="1.5" stroke-linecap="round"/></svg>`;
}
const progress = (r) => clamp01((chainNow() - r.submitted_at) / (r.deadline - r.submitted_at));

// ---------- ME ID level, read straight from ME testnet Hub REST ----------
// Same mapping as the contract: active DID + KYC_LEVEL_TWO = Advanced, KYC_LEVEL_ONE = Real-person,
// "DID not found" = None, anything else = lookup failed (never guessed).
const levels = new Map();
const meIdUrl = (me1) => `${info.hubRest}/metaearth/did/did?address=${encodeURIComponent(me1)}`;
async function queryLevel(me1) {
  const url = meIdUrl(me1);
  try {
    const res = await fetch(url, { cache: "no-store" });
    const body = await res.json().catch(() => null);
    const i = body?.info;
    if (res.ok && i?.did) {
      const lv = i.status === "DID_STATUS_ACTIVE" ? ({ KYC_LEVEL_TWO: "two", KYC_LEVEL_ONE: "one" }[i.kycLevel] || "none") : "none";
      return { state: lv, raw: `${i.kycLevel ?? "未提供等級"}，${i.status ?? ""}`, url };
    }
    if (String(body?.message || "").includes("DID not found")) return { state: "none", raw: "DID not found", url };
    return { state: "err", raw: `節點回 HTTP ${res.status}`, url };
  } catch (e) { return { state: "err", raw: `連不上 Hub：${e.message}`, url }; }
}
function levelOf(me1) {
  const c = levels.get(me1);
  if (!c || (!c.pending && Date.now() - c.at > 30000)) {
    levels.set(me1, { state: c && c.state !== "err" ? c.state : "wait", raw: c?.raw, at: Date.now(), url: meIdUrl(me1), pending: true });
    queryLevel(me1).then((r) => { levels.set(me1, { ...r, at: Date.now() }); renderSide(); renderPanel(); });
  }
  return levels.get(me1);
}

// ---------- reports ----------
async function loadReports() {
  for (const url of REPORTS) {
    const raw = new Uint8Array(await (await fetch(url, { cache: "no-store" })).arrayBuffer());
    const r = JSON.parse(new TextDecoder().decode(raw));
    const d = await crypto.subtle.digest("SHA-256", raw);
    const h = [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
    const f = r.findings[0];
    reports.set(h, {
      url, period: r.period, employer: r.employer.displayName.replace("（虛構）", ""), worker: r.worker.displayName.replace("（虛構）", ""),
      wage: r.hourlyWageTWD, item: { "overtime hours": "加班", "rest-day work": "休息日出勤" }[f.item] || f.item,
      att: Number(f.attendance), pay: Number(f.payslip), diff: Number(f.differenceHours), short: f.estimatedShortfallTWD,
    });
    if (!reportHash) reportHash = h;
  }
}
// attendance record vs payslip, drawn to the same scale; the hatched part is what the payslip left out
function bars(rep) {
  const max = Math.max(rep.att, rep.pay, 1), aw = (rep.att / max) * 100, pw = (rep.pay / max) * 100;
  return `<div class="cmp">
    <span class="lab">出勤紀錄</span><div class="bar"><span class="a" style="width:${aw}%"></span></div><span class="val">${rep.att} 小時</span>
    <span class="lab">薪資單</span><div class="bar">${pw > 0 ? `<span class="p" style="width:${pw}%"></span>` : ""}<span class="g" style="left:${pw}%;width:${aw - pw}%"></span></div><span class="val">${rep.pay} 小時</span>
  </div>`;
}
function titleOf(r) {
  const rep = reports.get(r.report_hash);
  return rep ? { t: `${rep.item}少算`, s: rep.employer, rep } : { t: "部署時的測試紀錄", s: "只有指紋，沒有報告檔", rep: null };
}

// ---------- reading the chain ----------
async function loadTxs(r) {
  const c = txByRecord.get(r.id);
  if (c && c.status === r.status && c.full) return;
  const url = `${info.hubRest}/cosmos/tx/v1beta1/txs?events=${encodeURIComponent(`wasm._contract_address='${info.contract}'`)}&events=${encodeURIComponent(`wasm.id='${r.id}'`)}`;
  const j = await getJson(url);
  const name = { submit: "登記", confirm: "雇主確認", dispute: "雇主異議", mark_expired: "記為逾期" };
  const list = [];
  for (const t of j.tx_responses || []) {
    if (t.code !== 0) continue;
    const ev = (t.logs?.[0]?.events || []).find((e) => e.type === "wasm");
    const attr = (k) => ev?.attributes.find((a) => a.key === k)?.value;
    if (Number(attr("id")) !== r.id) continue;
    const fee = t.tx?.auth_info?.fee?.amount?.find((a) => a.denom === "umec")?.amount;
    list.push({ action: attr("action"), label: name[attr("action")] || attr("action"), hash: t.txhash, height: Number(t.height),
      time: Date.parse(t.timestamp) / 1000, fee: fee ? Number(fee) / 1e8 : null, signer: t.tx?.body?.messages?.[0]?.sender });
  }
  list.sort((a, b) => a.height - b.height);
  txByRecord.set(r.id, { status: r.status, list, full: true });
}

async function refresh() {
  if (refreshing) { again = true; return; }
  refreshing = true;
  again = false;
  try {
    const latest = await getJson(`${info.hubRest}/cosmos/base/tendermint/v1beta1/blocks/latest`);
    clockOffset = Date.parse(latest.block.header.time) / 1000 - Date.now() / 1000;
    lastBlock = { height: Number(latest.block.header.height), at: Date.now() };
    $("live").className = "livestat"; $("liveM").className = "livestat";
    const [list, count] = await Promise.all([query({ list: { limit: LIST_MAX } }), query({ count: {} })]);
    total = count;
    records = await Promise.all(list.map(async (r) => {
      const eff = r.status === "pending" ? await query({ effective_status: { id: r.id } }).catch(() => r.status) : r.status;
      return { ...r, stored: ST[r.status], eff: ST[eff] };
    }));
    loaded = true;
    if (sel == null || !records.some((r) => r.id === sel)) sel = defaultSel();
    render();
    const want = new Set([sel, ...records.filter((r) => r.stored === 1).map((r) => r.id)]);
    await Promise.all(records.filter((r) => want.has(r.id)).map((r) => loadTxs(r).catch(() => {})));
    render();
  } catch (e) {
    $("live").className = "livestat bad"; $("liveM").className = "livestat bad";
    $("liveText").textContent = "讀不到鏈上資料，稍後自動重試";
    $("liveM").textContent = "連線中斷，自動重試";
    if (!loaded) $("rows").innerHTML = `<p class="empty"><b>讀不到 ME Network 測試網。</b><br>可能是節點暫時沒有回應（${esc(e.message)}）。這頁每幾秒會自動重試，不用重新整理。</p>`;
  } finally {
    refreshing = false;
    clearTimeout(timer);
    timer = setTimeout(refresh, again ? 0 : records.some((r) => r.stored === 1) ? 5000 : 20000);
  }
}
function defaultSel() {
  const known = records.filter((r) => reports.has(r.report_hash));
  return (known.find((r) => r.eff === 1) || records.find((r) => r.eff === 1) || known[0] || records[0])?.id ?? null;
}

// ---------- writing (server signs with demo accounts) ----------
const busy = new Set();
const dis = (a, id) => (busy.has(`${a}:${id}`) ? " disabled" : "");
const LABEL = { submit: "登記", confirm: "確認", dispute: "異議", markExpired: "記為逾期" };

function toast(kind, html) {
  const t = $("toast");
  t.hidden = false;
  t.innerHTML = `${kind === "busy" ? `<span class="spin" aria-hidden="true"></span>` : icon(kind === "ok" ? 2 : 3)}<div>${html}</div><button class="btn ghost" type="button" aria-label="關閉通知">關閉</button>`;
  t.querySelector("button").onclick = () => { t.hidden = true; };
}

async function callDemo(body) {
  const key = `${body.action}:${body.id}`;
  busy.add(key);
  const started = Date.now();
  if (body.action === "submit") { submitting = { started }; renderPanel(true); }
  else { renderPanel(true); toast("busy", `${LABEL[body.action]} #${body.id}：伺服器先在節點上模擬合約，再簽名送出，等出塊約 5～10 秒`); }
  try {
    const res = await fetch("/api/demo", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = await res.json().catch(() => ({}));
    const secs = ((Date.now() - started) / 1000).toFixed(1);
    if (j.ok) {
      const id = j.id ?? body.id;
      txByRecord.delete(id);
      if (body.action === "submit") { sel = id; mode = "detail"; view = "all"; }
      toast("ok", `${LABEL[body.action]}成功，紀錄 #${id} 現在是「${esc(STATUS[ST[j.status]] || j.status || "—")}」。寫入區塊 <span class="mono">${Number(j.blockNumber).toLocaleString("en-US")}</span>，花了 ${secs} 秒。<br>${ext(j.verifyUrl, `交易 <code>${esc(short(j.txHash, 6, 4))}</code>`)}`);
    } else if (body.action === "submit") {
      submitting = { error: j, http: res.status };
    } else if (j.code === "employer_not_verified" || j.code === "contract_rejected") {
      toast("no", `合約拒絕了${LABEL[body.action]}：${esc(ERR_ZH[j.contractError] || "合約規則不允許")}（<code>${esc(j.contractError)}</code>）。沒有送出交易，也沒有花手續費。`);
    } else {
      toast("no", `${LABEL[body.action]}沒有送出：${esc(plainError(j, res.status))}`);
    }
  } catch (e) {
    if (body.action === "submit") submitting = { error: { message: e.message }, http: 0 };
    else toast("no", `${LABEL[body.action]}沒有送出：連不上伺服器，請檢查網路後再按一次。`);
  } finally {
    busy.delete(key);
    if (submitting && !submitting.error) submitting = null;
    renderPanel(true);
    refresh();
  }
}
function plainError(j, http) {
  if (j.code === "rate_limited") return j.message || "按太快了，請稍等一分鐘再試。";
  if (j.code === "daily_limit") return "今天的示範次數用完了，明天會重置。";
  if (j.code === "out_of_funds") return "示範帳號的測試幣用完了，請通知我們補幣。";
  if (j.code === "not_configured") return "伺服器的示範帳號沒有設定好。";
  if (http === 0) return "連不上伺服器，請檢查網路後再按一次。";
  return j.message || `伺服器回應 HTTP ${http}`;
}

// ---------- rendering: sidebar ----------
function counts() {
  const n = { all: records.length, 1: 0, 2: 0, 3: 0, 4: 0 };
  for (const r of records) n[r.eff]++;
  return n;
}
const VIEW_ICON = { all: `<svg class="i" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 4.5h10M3 8h10M3 11.5h10" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>` };
function renderSide() {
  if (!info) return;
  const n = counts();
  const btn = (v, t) => `<button type="button" data-view="${v}" aria-current="${String(view) === String(v)}">${VIEW_ICON[v] || icon(v, 0.5)}${t}<span class="n">${loaded ? n[v] : "–"}</span></button>`;
  $("nav").innerHTML = VIEWS.map(([v, t]) => btn(v, t)).join("");
  $("chips").innerHTML = VIEWS.map(([v, t]) => `<button type="button" data-view="${v}" aria-current="${String(view) === String(v)}">${t}<span class="mono">${loaded ? n[v] : "–"}</span></button>`).join("");
  const ids = [[info.worker, "示範勞工"], [info.employer, "示範雇主"], [info.employers?.unverified, "沒有 ME ID 的地址"]];
  $("who").innerHTML = ids.filter(([a]) => a).map(([a, t]) => {
    const c = levelOf(a);
    const role = a === info.worker ? "登記人" : c.state === "none" ? "合約會拒絕" : "合約接受";
    return `<div>${avatar(a)}<b>${t}</b><span class="${a !== info.worker && c.state === "none" ? "no" : ""}">ME ID ${esc(LV[c.state])}・${role}</span></div>`;
  }).join("");
  $("total").textContent = loaded ? `${total}` : "";
}

// ---------- rendering: list ----------
function rowHtml(r) {
  const { t, s, rep } = titleOf(r);
  let due;
  if (r.eff === 1) due = `<span class="due hot" data-left="${r.deadline}">${clockText(r.deadline - chainNow())}</span>`;
  else if (r.eff === 4) due = `<span class="due">${r.stored === 1 ? "待記逾期" : "未回應"}</span>`;
  else due = `<span class="due">${dur(r.closed_at - r.submitted_at)}回應</span>`;
  return `<div class="row" role="option" tabindex="0" data-id="${r.id}" aria-selected="${sel === r.id && mode === "detail"}">
    ${r.eff === 1 ? icon(1, progress(r)).replace('class="i pie"', `class="i pie" data-s="${r.submitted_at}" data-d="${r.deadline}"`) : icon(r.eff)}
    <span class="id">#${r.id}</span>
    <span class="t">${esc(t)}<small>${esc(s)}</small></span>
    ${rep ? `<span class="amt">${nt(rep.short)}</span>` : `<span class="amt none">—</span>`}
    ${due}
    <span class="when">${mdhm(r.submitted_at)}</span></div>`;
}
function renderList() {
  if (!loaded) return;
  const shown = records.filter((r) => view === "all" || r.eff === Number(view));
  const open = shown.filter((r) => r.eff === 1), closed = shown.filter((r) => r.eff !== 1);
  const grp = (label, list, ic) => list.length ? `<div class="grp">${ic}${label}<span class="mono">${list.length}</span></div>${list.map(rowHtml).join("")}` : "";
  const noOpen = view === "all" && !open.length && shown.length
    ? `<div class="grp">${icon(1, 0)}等待雇主回應<span class="mono">0</span></div><p class="empty line">按「登記報告」、期限選 60 秒，新紀錄會出現在這裡倒數</p>` : "";
  let html = noOpen + grp("等待雇主回應", open, icon(1, 0.5)) + grp("已結案", closed, `<svg class="i" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.3" fill="none" stroke="#62666d" stroke-width="1.5"/></svg>`);
  if (!shown.length) {
    html = view === 1 || view === "1"
      ? `<p class="empty"><b>現在沒有等雇主回應的紀錄。</b><br>按右上角「登記報告」登記一筆，期限選 60 秒，它就會出現在這裡，倒數結束前可以換雇主身分回應。</p>`
      : `<p class="empty"><b>這個分類目前沒有紀錄。</b><br>切回「全部」可以看合約裡最近 ${records.length} 筆。</p>`;
  }
  if (total > records.length) html += `<p class="empty">只顯示最近 ${records.length} 筆，合約裡共 ${total} 筆。</p>`;
  const stable = html.replace(/<svg class="i pie"[\s\S]*?<\/svg>/g, "").replace(/(data-left="\d+">)[^<]*/g, "$1");
  if (stable === listKey) return;
  listKey = stable;
  const box = $("rows"), fid = document.activeElement?.closest?.(".row")?.dataset.id;
  box.innerHTML = html;
  if (fid) box.querySelector(`.row[data-id="${fid}"]`)?.focus();
}

// ---------- rendering: panel ----------
let panelKey = "", listKey = "";
function renderPanel(force = false) {
  if (!info) return;
  const p = $("panel");
  p.classList.toggle("open", panelOpen);
  const r = records.find((x) => x.id === sel);
  const tx = txByRecord.get(sel);
  const key = [mode, sel, r?.eff, r?.stored, tx?.list.length, [...busy].join(), JSON.stringify(submitting && !submitting.started ? submitting : !!submitting),
    reportHash, employerChoice, windowSecs, [...levels.values()].map((l) => l.state).join()].join("|");
  const typing = p.contains(document.activeElement) && document.activeElement.tagName === "INPUT";
  if (!force && key === panelKey) return;
  if (!force && typing && key.split("|").slice(0, 4).join() === panelKey.split("|").slice(0, 4).join()) return;
  panelKey = key;
  const keep = {}; for (const el of p.querySelectorAll("input[type=text], input:not([type])")) keep[el.id] = el.value;
  const focused = document.activeElement?.id;
  p.innerHTML = mode === "new" ? composerHtml() : mode === "tools" ? toolsHtml() : r ? detailHtml(r) : `<div class="pb"><p class="empty">${loaded ? "從左邊選一筆紀錄。" : "讀取鏈上紀錄中…"}</p></div>`;
  for (const [k, v] of Object.entries(keep)) if (k && $(k)) $(k).value = v;
  if (focused && $(focused) && p.contains($(focused))) $(focused).focus();
}
const closeBtn = () => `<button class="btn ghost x" type="button" data-close aria-label="關閉">${isNarrow() ? "返回列表" : "關閉"}</button>`;

function detailHtml(r) {
  const { rep } = titleOf(r);
  const win = r.deadline - r.submitted_at;
  const mine = r.employer === info.employer;
  let clock, act = "";
  if (r.eff === 1) {
    const p = progress(r);
    clock = `<div class="clock"><span class="big p" data-left="${r.deadline}" data-fmt="clock">${clockText(r.deadline - chainNow())}</span><small>後到期（回應期限 ${dur(win)}）</small></div>
      <div class="track live" style="--c:#f2c94c" data-s="${r.submitted_at}" data-d="${r.deadline}"><span style="width:${p * 100}%"></span></div>`;
    act = mine ? `<div class="act"><p>換成<b>示範雇主</b>的身分回應（ME ID ${esc(LV[levelOf(info.employer).state])}）。差額屬實就確認；不同意就寫一句理由，鏈上只存理由的指紋。</p>
      <div class="r"><button class="btn" type="button" data-a="confirm" data-id="${r.id}"${dis("confirm", r.id)}>${icon(2)}確認這筆差額</button></div>
      <label for="reason-${r.id}">不同意的理由</label>
      <div class="r"><input class="field" id="reason-${r.id}" maxlength="200" placeholder="例如：那 2 小時是自願留下，不算加班">
      <button class="btn" type="button" data-a="dispute" data-id="${r.id}"${dis("dispute", r.id)}>${icon(3)}提出異議</button></div>
      <p class="ferr" id="rerr-${r.id}" role="alert" hidden></p></div>`
      : `<div class="act"><p>這筆指定的雇主不是示範帳號，只有那個地址能回應。</p></div>`;
  } else if (r.eff === 4) {
    clock = `<div class="clock"><span class="big" style="color:var(--ink-2)">逾期未回應</span><small>期限 ${dur(win)} 內雇主沒有回應</small></div>
      <div class="track" style="--c:#8a8f98"><span style="width:100%"></span></div>`;
    if (r.stored === 1) act = `<div class="act"><p>期限已過，雇主沒有回應。任何人都能把它記為逾期，這一步也會寫上鏈，之後就不能再改。</p>
      <div class="r"><button class="btn" type="button" data-a="markExpired" data-id="${r.id}"${dis("markExpired", r.id)}>${icon(4)}記為逾期</button></div></div>`;
  } else {
    const at = r.closed_at - r.submitted_at, p = clamp01(at / win), c = r.eff === 2 ? "#4cb782" : "#eb5757";
    clock = `<div class="clock"><span class="big" style="color:${c}">${STATUS[r.eff]}</span><small>登記後 ${dur(at)} 回應（期限 ${dur(win)}）</small></div>
      <div class="track" style="--c:${c}"><span style="width:${p * 100}%"></span><i style="left:${p * 100}%"></i></div>`;
  }
  const tx = txByRecord.get(r.id);
  const trail = (tx?.list || []).map((t) => `<li><span class="dot">${t.action === "submit" ? `<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="3" fill="#d0d6e0"/></svg>` : icon({ confirm: 2, dispute: 3, mark_expired: 4 }[t.action] || 4)}</span>
    <div><b>${esc(t.label)}</b>　<span class="m">由 ${esc(nameOf(t.signer))} 簽名</span>
    <div class="m">區塊 <span class="mono">${t.height.toLocaleString("en-US")}</span>・${hms(t.time)}${t.fee != null ? `・手續費 <span class="mono">${t.fee.toFixed(4)}</span> MEC` : ""}</div>
    ${t.action === "submit" ? `<div class="m">合約查到雇主 ME ID「${esc(LV[r.employer_level] || r.employer_level)}」，達到要求，寫進這筆紀錄</div>` : ""}
    <div class="m">${ext(txUrl(t.hash), `交易 <code>${esc(short(t.hash, 6, 4))}</code>`)}</div></div></li>`).join("");
  const waiting = r.eff === 1 ? `<li><span class="dot"></span><div><b style="color:var(--ink-3)">等待雇主回應</b><div class="m">期限 ${hms(r.deadline)}</div></div></li>` : "";
  return `<div class="ph">${icon(r.eff, r.eff === 1 ? progress(r) : 0)}<span>${STATUS[r.eff]}</span><span class="mono">#${r.id}</span>${closeBtn()}</div>
  <div class="pb">
    <h2>${rep ? `${esc(rep.employer)}：${esc(rep.item)}少算 ${nt(rep.short)}` : "部署時的測試紀錄"}</h2>
    <p class="lead">${rep ? `${esc(rep.period)}・${esc(rep.worker)}・時薪 ${nt(rep.wage)}・示範資料，人名與公司皆為虛構` : "部署合約時的測試紀錄，沒有對應的報告檔，鏈上只有指紋"}</p>
    ${clock}
    <div class="ends"><span>登記 ${hms(r.submitted_at)}</span><span>期限 ${hms(r.deadline)}</span></div>
    ${act}
    ${rep ? `<div class="sec"><h3>出勤紀錄對薪資單<small>${esc(rep.item)}・時薪 ${nt(rep.wage)}</small></h3>${bars(rep)}
      <div class="owed"><span>薪資單少算 ${rep.diff} 小時，估計少付</span><b>${nt(rep.short)}</b></div></div>` : ""}
    <div class="sec"><h3>這筆紀錄在鏈上的樣子</h3><dl class="props">
      <dt>雇主</dt><dd>${avatar(r.employer)}${esc(nameOf(r.employer))}<span class="tag ${r.employer_level === "none" ? "no" : "ok"}">登記時 ME ID ${esc(LV[r.employer_level] || r.employer_level)}</span></dd>
      <dt>勞工</dt><dd>${avatar(r.worker)}${esc(nameOf(r.worker))}</dd>
      <dt>報告指紋</dt><dd><code title="${esc(r.report_hash)}">${esc(short(r.report_hash, 16, 8))}</code></dd>
      <dt>報告本身</dt><dd>沒有上鏈，留在勞工手上${rep ? `（${ext(rep.url, "示範報告檔")}）` : ""}</dd>
      <dt>合約查詢</dt><dd>${ext(smartUrl({ record: { id: r.id } }), "直接看合約回傳的原始資料")}</dd></dl></div>
    <div class="sec"><h3>鏈上交易<small>${tx ? `${tx.list.length} 筆` : "讀取中"}</small></h3>
      ${tx || waiting ? `<ol class="trail">${trail}${waiting}</ol>` : `<p class="empty" style="padding:0">讀取交易中…</p>`}</div>
  </div>`;
}

function composerHtml() {
  const opts = [...reports.entries()].map(([h, rep]) => `<label class="opt"><input type="radio" name="rep" value="${h}" ${h === reportHash ? "checked" : ""}>
    <span class="t">${esc(rep.period)}　${esc(rep.employer)}<b>${nt(rep.short)}</b></span>
    <span class="s">${esc(rep.worker)}・${esc(rep.item)}・時薪 ${nt(rep.wage)}・${ext(rep.url, "報告檔")}</span>${bars(rep)}</label>`).join("");
  const min = info.minEmployerLevel || "one";
  const emp = [["verified", "示範雇主"], ["unverified", "沒有 ME ID 的地址"]].map(([k, t]) => {
    const a = info.employers?.[k];
    const c = levelOf(a);
    const known = c.state !== "wait" && c.state !== "err";
    const rank = LV_RANK[c.state] ?? -1, ok = rank >= LV_RANK[min];
    const left = `calc(${LV_RANK[min]} * 24px - 1px)`;
    return `<label class="opt ${known && !ok ? "below" : ""}"><input type="radio" name="emp" value="${k}" ${employerChoice === k ? "checked" : ""}>
      <span class="emp-opt"><span class="t">${t}</span>
      <span class="gate">${known ? `<span class="steps" aria-hidden="true">${[0, 1, 2].map((i) => `<span class="${i <= rank ? "on" : ""}"></span>`).join("")}<i style="left:${left}"></i></span>
        <small>ME ID ${esc(LV[c.state])}・${ok ? "達到合約要求" : "合約會拒絕"}</small>` : `<small style="color:var(--ink-3)">${esc(LV[c.state])}</small>`}</span>
      <span class="a">${esc(a)}</span></span></label>`;
  }).join("");
  let note = "";
  if (submitting?.started) note = `<div class="note"><div class="prog"><span class="spin" aria-hidden="true"></span><span>伺服器正在節點上模擬合約、用示範勞工帳號簽名、等待出塊。已經 <span class="mono" data-since="${submitting.started}">0</span> 秒，通常 5～10 秒。</span></div></div>`;
  else if (submitting?.error) {
    const j = submitting.error;
    if (j.code === "employer_not_verified") {
      const m = j.meId;
      note = `<div class="note no"><b>合約拒絕了這次登記，沒有產生紀錄。</b><br>合約自己向 ME Network 查了雇主地址：${m ? `ME ID「${esc(LV[m.employer.level] || "查詢失敗")}」，低於合約要求的「${esc(LV[m.minEmployerLevel] || m.minEmployerLevel)}」` : "沒有達到合約要求的等級"}。伺服器改不了這條規則。<br>
        合約原文：<code>${esc(j.contractMessage || j.contractError)}</code><br>${ext(j.rejectProofUrl, "看同樣的拒絕真的上過鏈的那筆交易")}</div>`;
    } else if (j.code === "contract_rejected") {
      note = `<div class="note no"><b>合約拒絕：${esc(ERR_ZH[j.contractError] || "合約規則不允許")}。</b>沒有送出交易。<br><code>${esc(j.contractError)}</code></div>`;
    } else note = `<div class="note no"><b>沒有送出。</b>${esc(plainError(j, submitting.http))}</div>`;
  }
  const busyNow = !!submitting?.started;
  return `<div class="ph"><svg class="i" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3 8h10" stroke="#d0d6e0" stroke-width="1.6" stroke-linecap="round"/></svg><span>登記一份比對報告</span>${closeBtn()}</div>
  <div class="pb">
    <span class="flabel">報告（示範資料，報告本身不上鏈）</span>
    <div class="opts" id="repOpts">${opts || `<p class="empty" style="padding:0">示範報告讀取失敗，請重新整理。</p>`}</div>
    <p class="hint">上鏈的只有這份報告的 SHA-256 指紋：<code>${esc(reportHash || "—")}</code></p>
    <span class="flabel">雇主回應期限</span>
    <div class="seg" role="radiogroup" aria-label="雇主回應期限">${[[30, "30 秒"], [60, "60 秒"], [3600, "1 小時"]].map(([v, t]) =>
      `<label><input type="radio" name="win" value="${v}" ${windowSecs === v ? "checked" : ""}><span>${t}</span></label>`).join("")}</div>
    <p class="hint">示範用短期限，60 秒就能看到雇主回應或逾期。</p>
    <span class="flabel">指定雇主（合約會向 ME Network 查他的 ME ID）</span>
    <div class="opts" id="empOpts">${emp}</div>
    <div class="submit"><button class="btn primary lg" type="button" id="submitBtn"${busyNow || !reportHash ? " disabled" : ""}>${busyNow ? "登記中…" : "登記這份報告"}</button>
      <p>伺服器用示範勞工帳號代簽，不用錢包、不用測試幣</p></div>
    ${note}
  </div>`;
}

function toolsHtml() {
  return `<div class="ph"><span>規則與 ME ID 查詢</span>${closeBtn()}</div>
  <div class="pb">
    <h2>合約怎麼用 ME ID</h2>
    <p class="lead">登記時，合約自己向 ME Network 的身分模組查雇主地址；等級不到就拒絕，查到的等級寫進紀錄。這條規則寫在合約裡，網頁和伺服器都改不了。</p>
    <dl class="props">
      <dt>雇主最低等級</dt><dd><span class="tag ok">ME ID ${esc(LV[info.minEmployerLevel] || "—")}</span>${ext(smartUrl({ config: {} }), "看合約設定")}</dd>
      <dt>合約地址</dt><dd><code title="${esc(info.contract)}">${esc(short(info.contract, 12, 6))}</code></dd>
      <dt>部署交易</dt><dd>${ext(txUrl(info.instTx), `<code>${esc(short(info.instTx, 8, 4))}</code>`)}</dd>
      <dt>拒絕紀錄</dt><dd>${ext(txUrl(info.rejectProofTx), `<code>${esc(short(info.rejectProofTx, 8, 4))}</code>`)}　合約退回沒有 ME ID 的雇主</dd>
      <dt>網路</dt><dd>ME Network 測試網 <code>${esc(info.chainId)}</code>・CosmWasm code ${esc(info.codeId)}</dd>
    </dl>
    <div class="sec"><h3>查任一地址的 ME ID</h3>
      <div class="lookup"><input class="field" id="meidAddr" placeholder="貼上 me1 開頭的地址" autocomplete="off" spellcheck="false" aria-label="me1 地址">
      <button class="btn" type="button" id="meidBtn">查詢</button></div>
      <p id="meidOut" aria-live="polite"></p>
      <p class="hint">直接問測試網節點，和合約看到的是同一份資料。</p></div>
    <p class="foot-note">示範資料：報告裡的人名、公司、金額全部虛構。資料寫在 ME Network 測試網，測試幣沒有價值；測試網的 ME ID 是官方提供的模擬身分，不代表真實的法律身分驗證。原型作品，不構成法律意見。字型 Geist（SIL Open Font License）。</p>
  </div>`;
}

function render() {
  if (!info) return;
  renderSide();
  renderList();
  renderPanel();
}

function tick() {
  const now = chainNow();
  for (const el of document.querySelectorAll("svg.pie[data-s]")) {
    const s = Number(el.dataset.s), d = Number(el.dataset.d);
    el.outerHTML = icon(1, clamp01((now - s) / (d - s))).replace('class="i pie"', `class="i pie" data-s="${s}" data-d="${d}"`);
  }
  for (const el of document.querySelectorAll(".track.live[data-s]")) {
    const s = Number(el.dataset.s), d = Number(el.dataset.d);
    el.querySelector("span").style.width = `${clamp01((now - s) / (d - s)) * 100}%`;
  }
  for (const el of document.querySelectorAll("[data-left]")) {
    const left = Number(el.dataset.left) - now;
    el.textContent = left > 0 ? clockText(left) : "0:00";
  }
  for (const el of document.querySelectorAll("[data-since]")) el.textContent = Math.floor((Date.now() - Number(el.dataset.since)) / 1000);
  if (lastBlock && !$("live").classList.contains("bad")) {
    $("liveText").textContent = `區塊 ${lastBlock.height.toLocaleString("en-US")}・${Math.round((Date.now() - lastBlock.at) / 1000)} 秒前`;
    $("liveM").textContent = `測試網・區塊 ${lastBlock.height.toLocaleString("en-US")}`;
  }
}

// ---------- events ----------
function openPanel(m, id) {
  mode = m;
  if (id != null) sel = id;
  panelOpen = true;
  if (m === "new" && submitting?.error) submitting = null;
  renderList();
  renderPanel(true);
  $("panel").scrollTop = 0;
}
async function onPanelClick(e) {
  if (e.target.closest("[data-close]")) { panelOpen = false; if (mode !== "detail") mode = "detail"; renderList(); renderPanel(true); return; }
  if (e.target.id === "submitBtn") return callDemo({ action: "submit", reportHash: "0x" + reportHash, deadlineSeconds: windowSecs, employer: employerChoice });
  if (e.target.id === "meidBtn") return lookupMeId();
  const b = e.target.closest("button[data-a]");
  if (!b) return;
  const id = Number(b.dataset.id);
  if (b.dataset.a === "dispute") {
    const input = $(`reason-${id}`);
    const text = (input?.value || "").trim();
    if (!text) { input?.focus(); input?.setAttribute("aria-invalid", "true");
      const err = $(`rerr-${id}`); if (err) { err.hidden = false; err.textContent = "請先寫一句不同意的理由。鏈上只會存它的指紋，不會公開內容。"; } return; }
    const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    const reasonHash = "0x" + [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, "0")).join("");
    return callDemo({ action: "dispute", id, reasonHash });
  }
  return callDemo({ action: b.dataset.a, id });
}
function onPanelChange(e) {
  if (e.target.name === "rep") reportHash = e.target.value;
  if (e.target.name === "win") windowSecs = Number(e.target.value);
  if (e.target.name === "emp") employerChoice = e.target.value;
  if (submitting?.error) submitting = null;
  renderPanel(true);
}
function onView(e) {
  const b = e.target.closest("button[data-view]");
  if (!b) return;
  view = b.dataset.view === "all" ? "all" : Number(b.dataset.view);
  renderSide();
  renderList();
}

async function lookupMeId() {
  const a = $("meidAddr").value.trim();
  const out = $("meidOut");
  if (!/^me1[0-9a-z]{38}$/.test(a)) { out.textContent = "地址格式不對：要是 me1 開頭、共 41 個字元，例如左邊示範帳號的地址。"; $("meidAddr").setAttribute("aria-invalid", "true"); return; }
  $("meidAddr").removeAttribute("aria-invalid");
  out.textContent = "查詢中…";
  const r = await queryLevel(a);
  levels.set(a, { ...r, at: Date.now() });
  out.innerHTML = `ME ID <b>${esc(LV[r.state])}</b>・節點回：${esc(r.raw)}・${ext(r.url, "看原始回應")}`;
}

async function init() {
  info = await (await fetch("/api/demo", { cache: "no-store" })).json();
  $("newBtn").onclick = () => openPanel("new");
  $("openTools").onclick = () => openPanel("tools");
  $("openToolsM").onclick = () => openPanel("tools");
  $("nav").onclick = onView;
  $("chips").onclick = onView;
  $("rows").onclick = (e) => { const row = e.target.closest(".row"); if (row) openPanel("detail", Number(row.dataset.id)); };
  $("rows").onkeydown = (e) => {
    const row = e.target.closest(".row");
    if (!row) return;
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openPanel("detail", Number(row.dataset.id)); }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); (e.key === "ArrowDown" ? row.nextElementSibling : row.previousElementSibling)?.closest?.(".row")?.focus(); }
  };
  $("panel").onclick = onPanelClick;
  $("panel").onchange = onPanelChange;
  $("panel").onkeydown = (e) => { if (e.key === "Enter" && e.target.id === "meidAddr") lookupMeId(); };
  try { await loadReports(); } catch { /* composer shows the failure */ }
  renderSide();
  renderPanel(true);
  setInterval(tick, 1000);
  refresh();
}

init().catch((e) => { $("rows").innerHTML = `<p class="empty"><b>示範伺服器沒有回應。</b><br>${esc(e.message)}。請稍後重新整理。</p>`; });
})();
