//! Unit tests. A fake querier answers the ME ID Stargate query the way ME Hub does:
//! level two / level one as proto-JSON, "not found" as `codespace: did, code: 111`,
//! and an unrelated error for "upstream failure".
use std::marker::PhantomData;

use cosmwasm_std::testing::{mock_env, mock_info, MockApi, MockStorage};
use cosmwasm_std::{
    from_json, to_json_binary, Binary, ContractResult, Empty, Env, OwnedDeps, Querier, QuerierResult,
    QueryRequest, StdResult, SystemError, SystemResult,
};

use crate::meid::{Level, DID_QUERY_PATH};
use crate::*;

const EMP_TWO: &str = "me1employertwo";
const EMP_ONE: &str = "me1employerone";
const NOBODY: &str = "me1nobody";
const BROKEN: &str = "me1upstreamfail";
const WORKER: &str = "me1worker"; // no ME ID
const WORKER_ONE: &str = "me1workerone";
const STRANGER: &str = "me1stranger";
const REPORT: &str = "8f434346648f6b96df89dda901c5176b10a6d83961dd3c1ac88b59b2dc327aa4";
const REASON: &str = "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90";

struct DidQuerier;

fn decode_addr(data: &[u8]) -> String {
    // QueryDid { address = 1 } : 0x0a, len (single byte for short test addresses), bytes
    assert_eq!(data[0], 0x0a);
    String::from_utf8(data[2..2 + data[1] as usize].to_vec()).unwrap()
}

fn did_json(kyc: &str) -> Binary {
    Binary(
        format!(r#"{{"info":{{"did":"did:me:x","address":"","pubkey":"","status":"DID_STATUS_ACTIVE","regionId":"","kycLevel":"{kyc}","sub_account":""}}}}"#)
            .into_bytes(),
    )
}

impl Querier for DidQuerier {
    fn raw_query(&self, bin: &[u8]) -> QuerierResult {
        let req: QueryRequest<Empty> = from_json(bin).unwrap();
        match req {
            QueryRequest::Stargate { path, data } if path == DID_QUERY_PATH => {
                match decode_addr(data.as_slice()).as_str() {
                    EMP_TWO => SystemResult::Ok(ContractResult::Ok(did_json("KYC_LEVEL_TWO"))),
                    EMP_ONE | WORKER_ONE => SystemResult::Ok(ContractResult::Ok(did_json("KYC_LEVEL_ONE"))),
                    BROKEN => SystemResult::Ok(ContractResult::Err("rpc error: code = Unavailable desc = connection refused".into())),
                    _ => SystemResult::Ok(ContractResult::Err("codespace: did, code: 111".into())),
                }
            }
            _ => SystemResult::Err(SystemError::UnsupportedRequest { kind: "other".into() }),
        }
    }
}

type Deps_ = OwnedDeps<MockStorage, MockApi, DidQuerier>;

fn setup(min: Option<Level>) -> Deps_ {
    let mut deps = OwnedDeps { storage: MockStorage::default(), api: MockApi::default(), querier: DidQuerier, custom_query_type: PhantomData };
    instantiate(deps.as_mut(), mock_env(), mock_info("me1admin", &[]), InstantiateMsg { min_employer_level: min }).unwrap();
    deps
}

fn env_at(t: u64) -> Env {
    let mut e = mock_env();
    e.block.time = cosmwasm_std::Timestamp::from_seconds(t);
    e
}
const T0: u64 = 1_700_000_000;

fn exec(deps: &mut Deps_, t: u64, sender: &str, msg: ExecuteMsg) -> StdResult<cosmwasm_std::Response> {
    execute(deps.as_mut(), env_at(t), mock_info(sender, &[]), msg)
}
fn submit_msg(employer: &str, window: u64) -> ExecuteMsg {
    ExecuteMsg::Submit { report_hash: REPORT.into(), employer: employer.into(), deadline_seconds: window }
}
fn submit_ok(deps: &mut Deps_, employer: &str, window: u64) -> u64 {
    let res = exec(deps, T0, WORKER, submit_msg(employer, window)).unwrap();
    attr(&res, "id").parse().unwrap()
}
fn attr(res: &cosmwasm_std::Response, k: &str) -> String {
    res.attributes.iter().find(|a| a.key == k).unwrap().value.clone()
}
fn record(deps: &Deps_, id: u64) -> Record {
    from_json(query(deps.as_ref(), mock_env(), QueryMsg::Record { id }).unwrap()).unwrap()
}
fn eff(deps: &Deps_, t: u64, id: u64) -> Status {
    from_json(query(deps.as_ref(), env_at(t), QueryMsg::EffectiveStatus { id }).unwrap()).unwrap()
}
fn err_of(r: StdResult<cosmwasm_std::Response>) -> String {
    r.unwrap_err().to_string()
}

// ---- Solidity parity (test/WageProof.test.cjs) ----

#[test]
fn s01_submit_stores_hash_parties_deadline_and_emits_event() {
    let mut d = setup(None);
    let res = exec(&mut d, T0, WORKER, submit_msg(EMP_TWO, 600)).unwrap();
    assert_eq!(attr(&res, "action"), "submit");
    assert_eq!(attr(&res, "id"), "1");
    assert_eq!(attr(&res, "worker"), WORKER);
    assert_eq!(attr(&res, "employer"), EMP_TWO);
    assert_eq!(attr(&res, "deadline"), (T0 + 600).to_string());
    let r = record(&d, 1);
    assert_eq!((r.report_hash.as_str(), r.worker.as_str(), r.employer.as_str()), (REPORT, WORKER, EMP_TWO));
    assert_eq!((r.submitted_at, r.deadline, r.status, r.reason_hash, r.closed_at), (T0, T0 + 600, Status::Pending, None, None));
    let n: u64 = from_json(query(d.as_ref(), mock_env(), QueryMsg::Count {}).unwrap()).unwrap();
    assert_eq!(n, 1);
}

#[test]
fn s02_submit_rejects_bad_hash_bad_employer_window_out_of_range() {
    let mut d = setup(None);
    let zero = "0".repeat(64);
    let m = |h: &str, e: &str, w: u64| ExecuteMsg::Submit { report_hash: h.into(), employer: e.into(), deadline_seconds: w };
    assert!(err_of(exec(&mut d, T0, WORKER, m(&zero, EMP_TWO, 600))).contains("ZeroHash"));
    assert!(err_of(exec(&mut d, T0, WORKER, m("abc", EMP_TWO, 600))).contains("BadHash"));
    assert!(err_of(exec(&mut d, T0, WORKER, m(&format!("0x{}", &REPORT[2..]), EMP_TWO, 600))).contains("BadHash"));
    assert!(err_of(exec(&mut d, T0, WORKER, m(&"g".repeat(64), EMP_TWO, 600))).contains("BadHash"));
    assert!(err_of(exec(&mut d, T0, WORKER, m(REPORT, "", 600))).contains("BadEmployer"));
    assert!(err_of(exec(&mut d, T0, WORKER, m(REPORT, "ME1UPPER", 600))).contains("BadEmployer"));
    assert!(err_of(exec(&mut d, T0, EMP_TWO, m(REPORT, EMP_TWO, 600))).contains("BadEmployer"));
    assert!(err_of(exec(&mut d, T0, WORKER, m(REPORT, EMP_TWO, 29))).contains("BadWindow"));
    assert!(err_of(exec(&mut d, T0, WORKER, m(REPORT, EMP_TWO, MAX_WINDOW + 1))).contains("BadWindow"));
    // edges are accepted
    exec(&mut d, T0, WORKER, m(REPORT, EMP_TWO, 30)).unwrap();
    exec(&mut d, T0, WORKER, m(REPORT, EMP_TWO, MAX_WINDOW)).unwrap();
}

#[test]
fn s03_employer_confirms_within_deadline() {
    let mut d = setup(None);
    let id = submit_ok(&mut d, EMP_TWO, 600);
    let res = exec(&mut d, T0 + 10, EMP_TWO, ExecuteMsg::Confirm { id }).unwrap();
    assert_eq!((attr(&res, "action"), attr(&res, "employer_level")), ("confirm".into(), "two".into()));
    let r = record(&d, id);
    assert_eq!((r.status, r.closed_at, r.closed_by.unwrap().as_str()), (Status::Confirmed, Some(T0 + 10), EMP_TWO));
}

#[test]
fn s04_employer_disputes_with_reason_hash() {
    let mut d = setup(None);
    let id = submit_ok(&mut d, EMP_TWO, 600);
    let bad = ExecuteMsg::Dispute { id, reason_hash: "0".repeat(64) };
    assert!(err_of(exec(&mut d, T0 + 5, EMP_TWO, bad)).contains("ZeroHash"));
    let res = exec(&mut d, T0 + 5, EMP_TWO, ExecuteMsg::Dispute { id, reason_hash: REASON.to_uppercase() }).unwrap();
    assert_eq!((attr(&res, "action"), attr(&res, "reason_hash")), ("dispute".into(), REASON.into()));
    let r = record(&d, id);
    assert_eq!((r.status, r.reason_hash.as_deref()), (Status::Disputed, Some(REASON)));
}

#[test]
fn s05_only_the_named_employer_may_confirm_or_dispute() {
    let mut d = setup(None);
    let id = submit_ok(&mut d, EMP_TWO, 600);
    for who in [WORKER, STRANGER, EMP_ONE] {
        assert!(err_of(exec(&mut d, T0 + 1, who, ExecuteMsg::Confirm { id })).contains("NotEmployer"));
        assert!(err_of(exec(&mut d, T0 + 1, who, ExecuteMsg::Dispute { id, reason_hash: REASON.into() })).contains("NotEmployer"));
    }
    assert_eq!(record(&d, id).status, Status::Pending);
}

#[test]
fn s06_a_record_cannot_be_handled_twice() {
    let mut d = setup(None);
    let id = submit_ok(&mut d, EMP_TWO, 600);
    exec(&mut d, T0 + 1, EMP_TWO, ExecuteMsg::Confirm { id }).unwrap();
    assert!(err_of(exec(&mut d, T0 + 2, EMP_TWO, ExecuteMsg::Confirm { id })).contains("NotPending"));
    assert!(err_of(exec(&mut d, T0 + 2, EMP_TWO, ExecuteMsg::Dispute { id, reason_hash: REASON.into() })).contains("NotPending"));
    assert!(err_of(exec(&mut d, T0 + 999, STRANGER, ExecuteMsg::MarkExpired { id })).contains("NotPending"));
    let id2 = submit_ok(&mut d, EMP_TWO, 600);
    exec(&mut d, T0 + 1, EMP_TWO, ExecuteMsg::Dispute { id: id2, reason_hash: REASON.into() }).unwrap();
    assert!(err_of(exec(&mut d, T0 + 2, EMP_TWO, ExecuteMsg::Confirm { id: id2 })).contains("NotPending"));
}

#[test]
fn s07_after_deadline_no_response_and_anyone_marks_expired() {
    let mut d = setup(None);
    let id = submit_ok(&mut d, EMP_TWO, 60);
    assert!(err_of(exec(&mut d, T0 + 60, STRANGER, ExecuteMsg::MarkExpired { id })).contains("DeadlineNotPassed"));
    assert_eq!(eff(&d, T0 + 60, id), Status::Pending);
    assert_eq!(eff(&d, T0 + 61, id), Status::Expired);
    assert_eq!(record(&d, id).status, Status::Pending);
    assert!(err_of(exec(&mut d, T0 + 61, EMP_TWO, ExecuteMsg::Confirm { id })).contains("DeadlinePassed"));
    assert!(err_of(exec(&mut d, T0 + 61, EMP_TWO, ExecuteMsg::Dispute { id, reason_hash: REASON.into() })).contains("DeadlinePassed"));
    let res = exec(&mut d, T0 + 61, STRANGER, ExecuteMsg::MarkExpired { id }).unwrap();
    assert_eq!((attr(&res, "action"), attr(&res, "caller")), ("mark_expired".into(), STRANGER.into()));
    let r = record(&d, id);
    assert_eq!((r.status, r.closed_by.unwrap().as_str()), (Status::Expired, STRANGER));
    assert!(err_of(exec(&mut d, T0 + 62, STRANGER, ExecuteMsg::MarkExpired { id })).contains("NotPending"));
}

#[test]
fn s08_response_exactly_at_the_deadline_second_is_accepted() {
    let mut d = setup(None);
    let id = submit_ok(&mut d, EMP_TWO, 60);
    exec(&mut d, T0 + 60, EMP_TWO, ExecuteMsg::Confirm { id }).unwrap();
    assert_eq!(record(&d, id).status, Status::Confirmed);
}

#[test]
fn s09_unknown_ids_are_rejected() {
    let mut d = setup(None);
    assert!(query(d.as_ref(), mock_env(), QueryMsg::Record { id: 99 }).unwrap_err().to_string().contains("NoSuchRecord"));
    assert!(query(d.as_ref(), mock_env(), QueryMsg::EffectiveStatus { id: 99 }).unwrap_err().to_string().contains("NoSuchRecord"));
    assert!(err_of(exec(&mut d, T0, EMP_TWO, ExecuteMsg::Confirm { id: 99 })).contains("NoSuchRecord"));
    assert!(err_of(exec(&mut d, T0, EMP_TWO, ExecuteMsg::Dispute { id: 99, reason_hash: REASON.into() })).contains("NoSuchRecord"));
    assert!(err_of(exec(&mut d, T0, STRANGER, ExecuteMsg::MarkExpired { id: 99 })).contains("NoSuchRecord"));
    assert!(err_of(exec(&mut d, T0, STRANGER, ExecuteMsg::MarkExpired { id: 0 })).contains("NoSuchRecord"));
}

#[test]
fn s10_same_report_submitted_again_and_both_ids_listed() {
    let mut d = setup(None);
    submit_ok(&mut d, EMP_TWO, 600);
    submit_ok(&mut d, EMP_ONE, 600);
    let other = "1".repeat(64);
    exec(&mut d, T0, WORKER, ExecuteMsg::Submit { report_hash: other, employer: EMP_TWO.into(), deadline_seconds: 600 }).unwrap();
    let ids: Vec<u64> = from_json(query(d.as_ref(), mock_env(), QueryMsg::RecordsForReport { report_hash: REPORT.to_uppercase() }).unwrap()).unwrap();
    assert_eq!(ids, vec![1, 2]);
}

// ---- ME ID rules (only the CosmWasm version can enforce these on chain) ----

#[test]
fn m01_employer_without_me_id_is_rejected_with_level() {
    let mut d = setup(None);
    let e = err_of(exec(&mut d, T0, WORKER, submit_msg(NOBODY, 600)));
    assert!(e.contains("EmployerNotVerified") && e.contains("level none is below required one") && e.contains("not_found"), "{e}");
    let n: u64 = from_json(query(d.as_ref(), mock_env(), QueryMsg::Count {}).unwrap()).unwrap();
    assert_eq!(n, 0);
}

#[test]
fn m02_employer_lookup_upstream_failure_is_rejected_not_verified() {
    let mut d = setup(None);
    let e = err_of(exec(&mut d, T0, WORKER, submit_msg(BROKEN, 600)));
    assert!(e.contains("MeIdLookupFailed") && e.contains("employer") && e.contains("connection refused"), "{e}");
    assert!(!e.contains("EmployerNotVerified"));
}

#[test]
fn m03_worker_lookup_upstream_failure_is_rejected() {
    let mut d = setup(None);
    let e = err_of(exec(&mut d, T0, BROKEN, submit_msg(EMP_TWO, 600)));
    assert!(e.contains("MeIdLookupFailed") && e.contains("worker"), "{e}");
}

#[test]
fn m04_levels_are_stored_in_record_and_events() {
    let mut d = setup(None);
    let res = exec(&mut d, T0, WORKER, submit_msg(EMP_TWO, 600)).unwrap();
    assert_eq!((attr(&res, "employer_level"), attr(&res, "worker_level")), ("two".into(), "none".into()));
    let r = record(&d, 1);
    assert_eq!((r.employer_level, r.worker_level), (Level::Two, Level::None));
    let res = exec(&mut d, T0, WORKER_ONE, submit_msg(EMP_ONE, 600)).unwrap();
    assert_eq!((attr(&res, "employer_level"), attr(&res, "worker_level")), ("one".into(), "one".into()));
    let r = record(&d, 2);
    assert_eq!((r.employer_level, r.worker_level), (Level::One, Level::One));
}

#[test]
fn m05_min_level_two_rejects_level_one_and_none_is_not_allowed_as_min() {
    let mut d = setup(Some(Level::Two));
    let e = err_of(exec(&mut d, T0, WORKER, submit_msg(EMP_ONE, 600)));
    assert!(e.contains("level one is below required two"), "{e}");
    submit_ok(&mut d, EMP_TWO, 600);
    let c: Config = from_json(query(d.as_ref(), mock_env(), QueryMsg::Config {}).unwrap()).unwrap();
    assert_eq!(c.min_employer_level, Level::Two);
    let mut deps = OwnedDeps { storage: MockStorage::default(), api: MockApi::default(), querier: DidQuerier, custom_query_type: PhantomData::<Empty> };
    let e = instantiate(deps.as_mut(), mock_env(), mock_info("me1admin", &[]), InstantiateMsg { min_employer_level: Some(Level::None) });
    assert!(e.unwrap_err().to_string().contains("BadConfig"));
    let d1 = setup(None);
    let c: Config = from_json(query(d1.as_ref(), mock_env(), QueryMsg::Config {}).unwrap()).unwrap();
    assert_eq!(c.min_employer_level, Level::One);
}

#[test]
fn m06_me_id_query_reports_all_four_cases() {
    let d = setup(None);
    let q = |a: &str| query(d.as_ref(), mock_env(), QueryMsg::MeId { address: a.into() });
    let two: MeIdInfo = from_json(q(EMP_TWO).unwrap()).unwrap();
    let one: MeIdInfo = from_json(q(EMP_ONE).unwrap()).unwrap();
    let none: MeIdInfo = from_json(q(NOBODY).unwrap()).unwrap();
    assert_eq!((two.level, two.source.as_str()), (Level::Two, "found"));
    assert_eq!(one.level, Level::One);
    assert_eq!((none.level, none.source.as_str(), none.raw_error.as_str()), (Level::None, "not_found", "codespace: did, code: 111"));
    assert!(q(BROKEN).unwrap_err().to_string().contains("ME ID lookup failed"));
}

#[test]
fn m07_list_is_newest_first_paged_and_capped_at_30() {
    let mut d = setup(None);
    for _ in 0..35 {
        submit_ok(&mut d, EMP_TWO, 600);
    }
    let list = |s: Option<u64>, l: Option<u32>| -> Vec<u64> {
        let v: Vec<Record> = from_json(query(d.as_ref(), mock_env(), QueryMsg::List { start_after: s, limit: l }).unwrap()).unwrap();
        v.into_iter().map(|r| r.id).collect()
    };
    assert_eq!(list(None, None), (26..=35).rev().collect::<Vec<_>>());
    assert_eq!(list(None, Some(100)).len(), 30);
    assert_eq!(list(None, Some(100))[29], 6);
    assert_eq!(list(Some(26), Some(3)), vec![25, 24, 23]);
    assert_eq!(list(Some(3), None), vec![2, 1]);
    assert_eq!(list(Some(1), None), Vec::<u64>::new());
    assert_eq!(list(Some(999), Some(2)), vec![35, 34]);
    assert_eq!(list(None, Some(0)), Vec::<u64>::new());
}

#[test]
fn m08_storage_holds_no_personal_data_fields() {
    // the record serializes to exactly these keys: hashes, addresses, times, status, levels
    let mut d = setup(None);
    submit_ok(&mut d, EMP_TWO, 600);
    let v: serde_json_keys::Obj = from_json(to_json_binary(&record(&d, 1)).unwrap()).unwrap();
    let mut keys: Vec<_> = v.0.into_iter().collect();
    keys.sort();
    assert_eq!(keys, ["closed_at", "closed_by", "deadline", "employer", "employer_level", "id", "reason_hash", "report_hash", "status", "submitted_at", "worker", "worker_level"]);
}

mod serde_json_keys {
    use serde::de::{Deserializer, IgnoredAny, MapAccess, Visitor};
    pub struct Obj(pub Vec<String>);
    impl<'de> serde::Deserialize<'de> for Obj {
        fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
            struct V;
            impl<'de> Visitor<'de> for V {
                type Value = Obj;
                fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
                    f.write_str("object")
                }
                fn visit_map<A: MapAccess<'de>>(self, mut m: A) -> Result<Obj, A::Error> {
                    let mut k = vec![];
                    while let Some((key, _)) = m.next_entry::<String, IgnoredAny>()? {
                        k.push(key);
                    }
                    Ok(Obj(k))
                }
            }
            d.deserialize_map(V)
        }
    }
}
