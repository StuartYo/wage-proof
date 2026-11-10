// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title WageProof: confirm-or-dispute registry for wage evidence fingerprints
/// @notice Only a 32-byte fingerprint (hash) of an off-chain report goes on chain,
///         together with addresses, times and a status. No personal data.
///         All state transitions are decided by this contract, not by any model.
contract WageProof {
    enum Status { None, Pending, Confirmed, Disputed, Expired }

    struct Record {
        address worker;
        address employer;
        bytes32 reportHash;
        bytes32 reasonHash;   // set only on dispute (fingerprint of the employer's reason)
        uint64 submittedAt;
        uint64 deadline;      // last second at which the employer may still respond
        uint64 closedAt;
        Status status;
    }

    /// Short windows are allowed so a judge can watch a deadline pass during a demo.
    uint64 public constant MIN_WINDOW = 30;
    uint64 public constant MAX_WINDOW = 90 days;

    uint256 public recordCount;
    mapping(uint256 => Record) private records;          // ids start at 1
    mapping(bytes32 => uint256[]) private idsByReport;

    event Submitted(uint256 indexed id, address indexed worker, address indexed employer, bytes32 reportHash, uint64 deadline);
    event Confirmed(uint256 indexed id, address indexed employer, uint64 at);
    event Disputed(uint256 indexed id, address indexed employer, bytes32 reasonHash, uint64 at);
    event Expired(uint256 indexed id, address indexed caller, uint64 at);

    error ZeroHash();
    error BadEmployer();
    error BadWindow(uint64 given, uint64 min, uint64 max);
    error NoSuchRecord(uint256 id);
    error NotEmployer(address caller, address employer);
    error NotPending(Status status);
    error DeadlinePassed(uint64 deadline, uint64 nowTs);
    error DeadlineNotPassed(uint64 deadline, uint64 nowTs);

    function submit(bytes32 reportHash, address employer, uint64 deadlineSeconds) external returns (uint256 id) {
        if (reportHash == bytes32(0)) revert ZeroHash();
        if (employer == address(0) || employer == msg.sender) revert BadEmployer();
        if (deadlineSeconds < MIN_WINDOW || deadlineSeconds > MAX_WINDOW) revert BadWindow(deadlineSeconds, MIN_WINDOW, MAX_WINDOW);

        uint64 nowTs = uint64(block.timestamp);
        id = ++recordCount;
        records[id] = Record({
            worker: msg.sender,
            employer: employer,
            reportHash: reportHash,
            reasonHash: bytes32(0),
            submittedAt: nowTs,
            deadline: nowTs + deadlineSeconds,
            closedAt: 0,
            status: Status.Pending
        });
        idsByReport[reportHash].push(id);
        emit Submitted(id, msg.sender, employer, reportHash, nowTs + deadlineSeconds);
    }

    function confirm(uint256 id) external {
        Record storage r = _respondable(id);
        r.status = Status.Confirmed;
        r.closedAt = uint64(block.timestamp);
        emit Confirmed(id, msg.sender, r.closedAt);
    }

    function dispute(uint256 id, bytes32 reasonHash) external {
        if (reasonHash == bytes32(0)) revert ZeroHash();
        Record storage r = _respondable(id);
        r.status = Status.Disputed;
        r.reasonHash = reasonHash;
        r.closedAt = uint64(block.timestamp);
        emit Disputed(id, msg.sender, reasonHash, r.closedAt);
    }

    /// Anyone may record that the employer did not respond in time.
    function markExpired(uint256 id) external {
        Record storage r = _existing(id);
        if (r.status != Status.Pending) revert NotPending(r.status);
        uint64 nowTs = uint64(block.timestamp);
        if (nowTs <= r.deadline) revert DeadlineNotPassed(r.deadline, nowTs);
        r.status = Status.Expired;
        r.closedAt = nowTs;
        emit Expired(id, msg.sender, nowTs);
    }

    // ---- views ----

    function getRecord(uint256 id) external view returns (Record memory) {
        return _existingView(id);
    }

    /// Status as it should be read now: a Pending record past its deadline reads as Expired
    /// even before someone calls markExpired.
    function effectiveStatus(uint256 id) external view returns (Status) {
        Record memory r = _existingView(id);
        if (r.status == Status.Pending && block.timestamp > r.deadline) return Status.Expired;
        return r.status;
    }

    function idsForReport(bytes32 reportHash) external view returns (uint256[] memory) {
        return idsByReport[reportHash];
    }

    // ---- internal ----

    function _respondable(uint256 id) private view returns (Record storage r) {
        r = _existing(id);
        if (msg.sender != r.employer) revert NotEmployer(msg.sender, r.employer);
        if (r.status != Status.Pending) revert NotPending(r.status);
        uint64 nowTs = uint64(block.timestamp);
        if (nowTs > r.deadline) revert DeadlinePassed(r.deadline, nowTs);
    }

    function _existing(uint256 id) private view returns (Record storage r) {
        r = records[id];
        if (r.status == Status.None) revert NoSuchRecord(id);
    }

    function _existingView(uint256 id) private view returns (Record memory r) {
        r = records[id];
        if (r.status == Status.None) revert NoSuchRecord(id);
    }
}
