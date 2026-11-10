// Demo page logic. Local Hardhat chain only (accounts 0 = worker, 1 = employer).
// The page never decides a status itself: it reads effectiveStatus() from the contract,
// and the contract rejects anything the rules do not allow.
const { ethers } = window;
const LOCAL_RPC = "http://127.0.0.1:8545";
const LABEL = ["—", "等待雇主回應", "雇主已確認", "雇主已異議", "逾期未回應"];
const $ = (id) => document.getElementById(id);
const log = (m) => { $("log").textContent = `[${new Date().toLocaleTimeString()}] ${m}\n` + $("log").textContent; };

let provider, contract, signers = {}, role = "worker", reportHash, meidRest;

async function sha256Hex(bytes) {
  const d = await crypto.subtle.digest("SHA-256", bytes);
  return "0x" + [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function init() {
  const net = await (await fetch("/config/network.json")).json();
  meidRest = net.hub.rest;
  const raw = new Uint8Array(await (await fetch("/demo/synthetic-report.json")).arrayBuffer());
  const report = JSON.parse(new TextDecoder().decode(raw));
  reportHash = await sha256Hex(raw);
  $("reportHash").textContent = reportHash;
  $("reportSummary").textContent = `${report.period}｜${report.worker.displayName} × ${report.employer.displayName}｜${report.summary}`;

  provider = new ethers.JsonRpcProvider(LOCAL_RPC);
  signers.worker = await provider.getSigner(0);
  signers.employer = await provider.getSigner(1);
  const dep = await (await fetch("/deployments/localhost.json")).json();
  const abi = (await (await fetch("/abi/WageProof.json")).json()).abi;
  contract = new ethers.Contract(dep.address, abi, provider);
  log(`連上本機鏈，合約 ${dep.address}`);
  setRole("worker");
}

function setRole(r) {
  role = r;
  $("roleWorker").setAttribute("aria-pressed", r === "worker");
  $("roleEmployer").setAttribute("aria-pressed", r === "employer");
  $("submitBtn").disabled = r !== "worker";
  signers[r].getAddress().then((a) => { $("me").textContent = `${r === "worker" ? "勞工" : "雇主"} ${a}`; });
  refresh();
}

async function send(label, fn) {
  try {
    const tx = await fn(contract.connect(signers[role]));
    const rc = await tx.wait();
    log(`${label} 成功，tx ${rc.hash}，區塊 ${rc.blockNumber}`);
  } catch (e) {
    const name = e?.revert?.name || e?.shortMessage || e?.message;
    log(`${label} 被合約拒絕：${name}`);
  }
  refresh();
}

async function refresh() {
  if (!contract) return;
  const n = Number(await contract.recordCount());
  const latest = await provider.getBlock("latest");
  if (n === 0) { $("rows").innerHTML = `<tr><td colspan="5">尚無紀錄</td></tr>`; return; }
  const rows = [];
  for (let id = n; id >= 1; id--) {
    const r = await contract.getRecord(id);
    const eff = Number(await contract.effectiveStatus(id));
    const left = Number(r.deadline) - latest.timestamp;
    const deadlineText = eff === 1 ? `剩 ${left} 秒（鏈上時間）` : new Date(Number(r.deadline) * 1000).toLocaleString();
    const canRespond = role === "employer" && eff === 1;
    const canExpire = eff === 4 && Number(r.status) === 1;
    rows.push(`<tr>
      <td>${id}</td>
      <td><span class="pill s${eff}">${LABEL[eff]}</span>${eff === 4 && Number(r.status) === 1 ? "（尚未寫入）" : ""}</td>
      <td>${deadlineText}</td>
      <td><code>${r.reportHash.slice(0, 18)}…</code></td>
      <td>
        <button class="act" data-a="confirm" data-id="${id}" ${canRespond ? "" : "disabled"}>確認</button>
        <button class="act secondary" data-a="dispute" data-id="${id}" ${canRespond ? "" : "disabled"}>異議</button>
        <button class="act secondary" data-a="expire" data-id="${id}" ${canExpire ? "" : "disabled"}>記錄逾期</button>
      </td></tr>`);
  }
  $("rows").innerHTML = rows.join("");
}

$("roleWorker").onclick = () => setRole("worker");
$("roleEmployer").onclick = () => setRole("employer");
$("submitBtn").onclick = async () => {
  const secs = BigInt($("deadline").value || "60");
  const employer = await signers.employer.getAddress();
  send("登記", (c) => c.submit(reportHash, employer, secs));
};
$("rows").onclick = async (ev) => {
  const b = ev.target.closest("button[data-a]");
  if (!b) return;
  const id = BigInt(b.dataset.id);
  if (b.dataset.a === "confirm") send(`確認 #${id}`, (c) => c.confirm(id));
  if (b.dataset.a === "dispute") {
    const reason = await sha256Hex(new TextEncoder().encode("示範用合成異議理由：加班時數已以補休抵銷（虛構）"));
    send(`異議 #${id}`, (c) => c.dispute(id, reason));
  }
  if (b.dataset.a === "expire") send(`記錄逾期 #${id}`, (c) => c.markExpired(id));
};
$("ffBtn").onclick = async () => {
  await provider.send("evm_increaseTime", [60]);
  await provider.send("evm_mine", []);
  log("本機鏈時間快轉 60 秒");
  refresh();
};
$("meidBtn").onclick = async () => {
  const a = $("meidAddr").value.trim();
  if (!/^me1[0-9a-z]{38}$/.test(a)) { $("meidOut").textContent = "請輸入 me1 開頭的地址"; return; }
  $("meidOut").textContent = "查詢中…";
  try {
    const res = await fetch(`${meidRest}/metaearth/did/did?address=${encodeURIComponent(a)}`);
    const body = await res.json();
    if (res.ok && body.info?.did) {
      $("meidOut").textContent = `有 ME ID（狀態 ${body.info.status}，等級 ${body.info.kycLevel}）`;
    } else if (String(body.message || "").includes("DID not found")) {
      $("meidOut").textContent = `沒有 ME ID（節點回 HTTP ${res.status}：DID not found）`;
    } else {
      $("meidOut").textContent = `無法判斷：HTTP ${res.status}`;
    }
  } catch (e) { $("meidOut").textContent = `查詢失敗：${e.message}`; }
};

init().catch((e) => log(`初始化失敗：${e.message}（本機鏈與部署是否已啟動？）`));
