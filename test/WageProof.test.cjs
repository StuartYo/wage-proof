const assert = require("node:assert/strict");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

const S = { None: 0n, Pending: 1n, Confirmed: 2n, Disputed: 3n, Expired: 4n };
const H = (s) => ethers.keccak256(ethers.toUtf8Bytes(s));
const REPORT = H("synthetic demo report v1");
const REASON = H("synthetic employer reason");

async function rejects(p, errorName) {
  await assert.rejects(p, (e) => {
    const msg = String(e.message);
    assert.ok(msg.includes(errorName), `expected ${errorName}, got: ${msg.slice(0, 200)}`);
    return true;
  });
}

describe("WageProof", function () {
  let c, worker, employer, stranger;

  beforeEach(async function () {
    [worker, employer, stranger] = await ethers.getSigners();
    c = await (await ethers.getContractFactory("WageProof")).deploy();
  });

  async function submit(window = 600n) {
    await (await c.connect(worker).submit(REPORT, employer.address, window)).wait();
    return await c.recordCount();
  }

  it("submit stores hash, parties, deadline and emits Submitted", async function () {
    const tx = c.connect(worker).submit(REPORT, employer.address, 600);
    const rc = await (await tx).wait();
    const ev = rc.logs.map((l) => c.interface.parseLog(l)).find((x) => x.name === "Submitted");
    assert.equal(ev.args.id, 1n);
    const r = await c.getRecord(1);
    assert.equal(r.worker, worker.address);
    assert.equal(r.employer, employer.address);
    assert.equal(r.reportHash, REPORT);
    assert.equal(r.status, S.Pending);
    assert.equal(r.deadline - r.submittedAt, 600n);
    assert.deepEqual([...(await c.idsForReport(REPORT))], [1n]);
  });

  it("submit rejects zero hash, bad employer, window out of range", async function () {
    await rejects(c.submit(ethers.ZeroHash, employer.address, 600), "ZeroHash");
    await rejects(c.submit(REPORT, ethers.ZeroAddress, 600), "BadEmployer");
    await rejects(c.connect(worker).submit(REPORT, worker.address, 600), "BadEmployer");
    await rejects(c.submit(REPORT, employer.address, 29), "BadWindow");
    await rejects(c.submit(REPORT, employer.address, 90 * 24 * 3600 + 1), "BadWindow");
  });

  it("employer confirms within deadline", async function () {
    const id = await submit();
    await (await c.connect(employer).confirm(id)).wait();
    const r = await c.getRecord(id);
    assert.equal(r.status, S.Confirmed);
    assert.ok(r.closedAt > 0n);
  });

  it("employer disputes with a reason hash", async function () {
    const id = await submit();
    await rejects(c.connect(employer).dispute(id, ethers.ZeroHash), "ZeroHash");
    await (await c.connect(employer).dispute(id, REASON)).wait();
    const r = await c.getRecord(id);
    assert.equal(r.status, S.Disputed);
    assert.equal(r.reasonHash, REASON);
  });

  it("only the named employer may confirm or dispute", async function () {
    const id = await submit();
    await rejects(c.connect(stranger).confirm(id), "NotEmployer");
    await rejects(c.connect(worker).confirm(id), "NotEmployer");
    await rejects(c.connect(stranger).dispute(id, REASON), "NotEmployer");
    assert.equal((await c.getRecord(id)).status, S.Pending);
  });

  it("a record cannot be handled twice", async function () {
    const id = await submit();
    await (await c.connect(employer).confirm(id)).wait();
    await rejects(c.connect(employer).confirm(id), "NotPending");
    await rejects(c.connect(employer).dispute(id, REASON), "NotPending");
    await time.increase(601);
    await rejects(c.markExpired(id), "NotPending");
  });

  it("after the deadline the employer can no longer respond; anyone can mark it expired", async function () {
    const id = await submit(60n);
    await rejects(c.markExpired(id), "DeadlineNotPassed");
    await time.increase(61);
    assert.equal(await c.effectiveStatus(id), S.Expired);
    assert.equal((await c.getRecord(id)).status, S.Pending);
    await rejects(c.connect(employer).confirm(id), "DeadlinePassed");
    await rejects(c.connect(employer).dispute(id, REASON), "DeadlinePassed");
    const rc = await (await c.connect(stranger).markExpired(id)).wait();
    const ev = rc.logs.map((l) => c.interface.parseLog(l)).find((x) => x.name === "Expired");
    assert.equal(ev.args.caller, stranger.address);
    assert.equal((await c.getRecord(id)).status, S.Expired);
    await rejects(c.markExpired(id), "NotPending");
  });

  it("response exactly at the deadline second is still accepted", async function () {
    const id = await submit(60n);
    const r = await c.getRecord(id);
    await time.setNextBlockTimestamp(r.deadline);
    await (await c.connect(employer).confirm(id)).wait();
    assert.equal((await c.getRecord(id)).status, S.Confirmed);
  });

  it("unknown ids are rejected", async function () {
    await rejects(c.getRecord(99), "NoSuchRecord");
    await rejects(c.connect(employer).confirm(99), "NoSuchRecord");
    await rejects(c.markExpired(99), "NoSuchRecord");
  });

  it("same report can be submitted again and both ids are listed", async function () {
    await submit();
    await submit();
    assert.deepEqual([...(await c.idsForReport(REPORT))], [1n, 2n]);
  });
});
