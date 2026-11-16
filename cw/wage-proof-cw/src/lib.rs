//! WageProof (CosmWasm): confirm-or-dispute registry for wage evidence fingerprints on ME Hub.
//!
//! Same rules as `contracts/WageProof.sol`, plus one rule only a CosmWasm contract on ME Hub can
//! enforce by itself: on `submit` the contract reads the employer's ME ID (DID module, Stargate
//! query) and rejects the record when the level is below the configured minimum. The levels of
//! both parties at submit time are stored in the record.
//!
//! Settlement (v0.3): the worker may state a claim (an amount of the chain's native coin, in
//! base units). When the employer confirms such a record, the same transaction must carry exactly
//! that amount; the contract forwards it to the worker with a BankMsg::Send and stores it as
//! `settled`. Every other action refuses attached funds, so no coins can get stuck in the contract.
//!
//! Only fingerprints (64-char hex hashes), addresses, times, statuses, ME ID levels and amounts are
//! stored. No personal data.

pub mod meid;
mod state;
#[cfg(test)]
mod tests;

use cosmwasm_schema::{cw_serde, QueryResponses};
use cosmwasm_std::{
    coins, entry_point, to_json_binary, Addr, BankMsg, Binary, Deps, DepsMut, Env, MessageInfo, Response,
    StdError, StdResult, Uint128,
};

pub use meid::{Level, MeIdInfo};
pub use state::{Config, Record, Status};
use state::*;

/// Short windows are allowed so a judge can watch a deadline pass during a demo.
pub const MIN_WINDOW: u64 = 30;
pub const MAX_WINDOW: u64 = 90 * 24 * 3600;
pub const DEFAULT_LIST_LIMIT: u32 = 10;
pub const MAX_LIST_LIMIT: u32 = 30;
/// native coin of ME Hub testnet (bank denom of MEC); can be overridden at instantiate
pub const DEFAULT_SETTLE_DENOM: &str = "umec";

#[cw_serde]
pub struct InstantiateMsg {
    /// lowest employer ME ID level accepted by `submit` (`one` or `two`; default `one`)
    pub min_employer_level: Option<Level>,
    /// denom the employer must pay a claim in (default `umec`)
    pub settle_denom: Option<String>,
}

#[cw_serde]
pub enum ExecuteMsg {
    /// `claim`: amount (in `settle_denom` base units) the worker asks the employer to pay back;
    /// missing or 0 = no amount claimed (v0.2 behaviour)
    Submit { report_hash: String, employer: String, deadline_seconds: u64, claim: Option<Uint128> },
    Confirm { id: u64 },
    Dispute { id: u64, reason_hash: String },
    MarkExpired { id: u64 },
}

#[cw_serde]
#[derive(QueryResponses)]
pub enum QueryMsg {
    #[returns(Record)]
    Record { id: u64 },
    #[returns(Status)]
    EffectiveStatus { id: u64 },
    #[returns(Vec<u64>)]
    RecordsForReport { report_hash: String },
    #[returns(u64)]
    Count {},
    /// newest first; `start_after` = only ids lower than it; limit default 10, capped at 30
    #[returns(Vec<Record>)]
    List { start_after: Option<u64>, limit: Option<u32> },
    #[returns(MeIdInfo)]
    MeId { address: String },
    #[returns(Config)]
    Config {},
}

fn err(code: &str, msg: impl std::fmt::Display) -> StdError {
    StdError::generic_err(format!("{code}: {msg}"))
}

/// 64 hex chars, not all zero; returned lower-case so lookups are case-insensitive.
pub fn normalize_hash(field: &str, h: &str) -> StdResult<String> {
    if h.len() != 64 || !h.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err(err("BadHash", format!("{field} must be 64 hex characters")));
    }
    if h.bytes().all(|b| b == b'0') {
        return Err(err("ZeroHash", format!("{field} must not be all zero")));
    }
    Ok(h.to_ascii_lowercase())
}

#[cfg_attr(not(feature = "library"), entry_point)]
pub fn instantiate(deps: DepsMut, _env: Env, _info: MessageInfo, msg: InstantiateMsg) -> StdResult<Response> {
    let min = msg.min_employer_level.unwrap_or(Level::One);
    if min == Level::None {
        return Err(err("BadConfig", "min_employer_level must be one or two"));
    }
    let denom = msg.settle_denom.unwrap_or_else(|| DEFAULT_SETTLE_DENOM.to_string());
    if denom.is_empty() {
        return Err(err("BadConfig", "settle_denom must not be empty"));
    }
    save_config(deps.storage, &Config { min_employer_level: min, settle_denom: denom.clone() })?;
    save_count(deps.storage, 0)?;
    Ok(Response::new()
        .add_attribute("action", "instantiate")
        .add_attribute("min_employer_level", min.as_str())
        .add_attribute("settle_denom", denom))
}

#[cfg_attr(not(feature = "library"), entry_point)]
pub fn execute(deps: DepsMut, env: Env, info: MessageInfo, msg: ExecuteMsg) -> StdResult<Response> {
    let now = env.block.time.seconds();
    match msg {
        ExecuteMsg::Submit { report_hash, employer, deadline_seconds, claim } => {
            no_funds(&info, "submit")?;
            submit(deps, now, info.sender, report_hash, employer, deadline_seconds, claim.unwrap_or_default())
        }
        ExecuteMsg::Confirm { id } => respond(deps, now, info, id, None),
        ExecuteMsg::Dispute { id, reason_hash } => {
            no_funds(&info, "dispute")?;
            let reason = normalize_hash("reason_hash", &reason_hash)?;
            respond(deps, now, info, id, Some(reason))
        }
        ExecuteMsg::MarkExpired { id } => {
            no_funds(&info, "mark_expired")?;
            mark_expired(deps, now, info.sender, id)
        }
    }
}

/// Only a confirm with a claim may carry coins; anything else would be stuck in the contract.
fn no_funds(info: &MessageInfo, action: &str) -> StdResult<()> {
    if info.funds.is_empty() {
        return Ok(());
    }
    let sent: Vec<String> = info.funds.iter().map(|c| c.to_string()).collect();
    Err(err("UnexpectedFunds", format!("{action} must not carry coins (sent {})", sent.join(","))))
}

/// A confirm must carry exactly `claim` of `denom` as a single coin.
fn check_settlement(info: &MessageInfo, claim: Uint128, denom: &str) -> StdResult<()> {
    if claim.is_zero() {
        return no_funds(info, "confirm without a claim");
    }
    match info.funds.as_slice() {
        [] => Err(err("SettlementMissing", format!("confirm must carry {claim}{denom} for the worker"))),
        [c] if c.denom != denom => Err(err("WrongSettlementDenom", format!("sent {c}, claim is in {denom}"))),
        [c] if c.amount != claim => Err(err(
            "WrongSettlement",
            format!("sent {}{denom}, claim is exactly {claim}{denom}", c.amount),
        )),
        [_] => Ok(()),
        many => Err(err(
            "WrongSettlementDenom",
            format!("sent {} coins, expected only {claim}{denom}", many.len()),
        )),
    }
}

fn lookup(deps: &DepsMut, who: &str, addr: &Addr) -> StdResult<MeIdInfo> {
    meid::query_me_id(&deps.querier, addr.as_str()).map_err(|e| {
        // never treat an upstream failure as verified (or as "no ME ID")
        let raw = match e {
            StdError::GenericErr { msg, .. } => msg,
            other => other.to_string(),
        };
        err("MeIdLookupFailed", format!("{who} {addr}: {raw}"))
    })
}

fn submit(
    deps: DepsMut,
    now: u64,
    worker: Addr,
    report_hash: String,
    employer: String,
    window: u64,
    claim: Uint128,
) -> StdResult<Response> {
    let report_hash = normalize_hash("report_hash", &report_hash)?;
    let employer = deps
        .api
        .addr_validate(&employer)
        .map_err(|e| err("BadEmployer", format!("invalid employer address: {e}")))?;
    if employer == worker {
        return Err(err("BadEmployer", "employer must differ from the worker"));
    }
    if !(MIN_WINDOW..=MAX_WINDOW).contains(&window) {
        return Err(err("BadWindow", format!("deadline_seconds {window} not in {MIN_WINDOW}..={MAX_WINDOW}")));
    }

    let cfg = load_config(deps.storage)?;
    let emp = lookup(&deps, "employer", &employer)?;
    if emp.level < cfg.min_employer_level {
        return Err(err(
            "EmployerNotVerified",
            format!(
                "employer {employer} ME ID level {} is below required {} (source {})",
                emp.level.as_str(),
                cfg.min_employer_level.as_str(),
                emp.source
            ),
        ));
    }
    // the worker may have no ME ID (stored as none), but a failed lookup still rejects
    let wrk = lookup(&deps, "worker", &worker)?;

    let id = load_count(deps.storage)? + 1;
    let rec = Record {
        id,
        worker: worker.clone(),
        employer: employer.clone(),
        report_hash: report_hash.clone(),
        reason_hash: None,
        submitted_at: now,
        deadline: now + window,
        closed_at: None,
        closed_by: None,
        status: Status::Pending,
        employer_level: emp.level,
        worker_level: wrk.level,
        claim,
        settled: Uint128::zero(),
    };
    save_record(deps.storage, &rec)?;
    save_count(deps.storage, id)?;
    push_report_id(deps.storage, &report_hash, id)?;

    Ok(Response::new()
        .add_attribute("action", "submit")
        .add_attribute("id", id.to_string())
        .add_attribute("worker", worker)
        .add_attribute("employer", employer)
        .add_attribute("report_hash", report_hash)
        .add_attribute("deadline", rec.deadline.to_string())
        .add_attribute("employer_level", emp.level.as_str())
        .add_attribute("worker_level", wrk.level.as_str())
        .add_attribute("claim", claim.to_string()))
}

fn existing(deps: Deps, id: u64) -> StdResult<Record> {
    load_record(deps.storage, id)?.ok_or_else(|| err("NoSuchRecord", format!("id {id}")))
}

fn respond(deps: DepsMut, now: u64, info: MessageInfo, id: u64, reason: Option<String>) -> StdResult<Response> {
    let sender = info.sender.clone();
    let mut r = existing(deps.as_ref(), id)?;
    if sender != r.employer {
        return Err(err("NotEmployer", format!("caller {sender} is not employer {}", r.employer)));
    }
    if r.status != Status::Pending {
        return Err(err("NotPending", format!("record {id} is {}", r.status.as_str())));
    }
    if now > r.deadline {
        return Err(err("DeadlinePassed", format!("deadline {} < now {now}", r.deadline)));
    }
    let action = if reason.is_some() { "dispute" } else { "confirm" };
    let mut res = Response::new();
    if reason.is_none() {
        let denom = load_config(deps.storage)?.settle_denom;
        check_settlement(&info, r.claim, &denom)?;
        if !r.claim.is_zero() {
            r.settled = r.claim;
            res = res.add_message(BankMsg::Send {
                to_address: r.worker.to_string(),
                amount: coins(r.claim.u128(), denom),
            });
        }
    }
    r.status = if reason.is_some() { Status::Disputed } else { Status::Confirmed };
    r.reason_hash = reason.clone();
    r.closed_at = Some(now);
    r.closed_by = Some(sender);
    save_record(deps.storage, &r)?;
    res = res
        .add_attribute("action", action)
        .add_attribute("id", id.to_string())
        .add_attribute("worker", r.worker.as_str())
        .add_attribute("employer", r.employer.as_str())
        .add_attribute("employer_level", r.employer_level.as_str())
        .add_attribute("worker_level", r.worker_level.as_str())
        .add_attribute("claim", r.claim.to_string())
        .add_attribute("settled", r.settled.to_string())
        .add_attribute("at", now.to_string());
    if let Some(h) = reason {
        res = res.add_attribute("reason_hash", h);
    }
    Ok(res)
}

/// Anyone may record that the employer did not respond in time.
fn mark_expired(deps: DepsMut, now: u64, sender: Addr, id: u64) -> StdResult<Response> {
    let mut r = existing(deps.as_ref(), id)?;
    if r.status != Status::Pending {
        return Err(err("NotPending", format!("record {id} is {}", r.status.as_str())));
    }
    if now <= r.deadline {
        return Err(err("DeadlineNotPassed", format!("deadline {} >= now {now}", r.deadline)));
    }
    r.status = Status::Expired;
    r.closed_at = Some(now);
    r.closed_by = Some(sender.clone());
    save_record(deps.storage, &r)?;
    Ok(Response::new()
        .add_attribute("action", "mark_expired")
        .add_attribute("id", id.to_string())
        .add_attribute("caller", sender)
        .add_attribute("worker", r.worker.as_str())
        .add_attribute("employer", r.employer.as_str())
        .add_attribute("employer_level", r.employer_level.as_str())
        .add_attribute("worker_level", r.worker_level.as_str())
        .add_attribute("claim", r.claim.to_string())
        .add_attribute("settled", r.settled.to_string())
        .add_attribute("at", now.to_string()))
}

#[cfg_attr(not(feature = "library"), entry_point)]
pub fn query(deps: Deps, env: Env, msg: QueryMsg) -> StdResult<Binary> {
    match msg {
        QueryMsg::Record { id } => to_json_binary(&existing(deps, id)?),
        QueryMsg::EffectiveStatus { id } => {
            let r = existing(deps, id)?;
            let s = if r.status == Status::Pending && env.block.time.seconds() > r.deadline {
                Status::Expired
            } else {
                r.status
            };
            to_json_binary(&s)
        }
        QueryMsg::RecordsForReport { report_hash } => {
            let h = normalize_hash("report_hash", &report_hash)?;
            to_json_binary(&load_report_ids(deps.storage, &h)?)
        }
        QueryMsg::Count {} => to_json_binary(&load_count(deps.storage)?),
        QueryMsg::List { start_after, limit } => {
            let limit = limit.unwrap_or(DEFAULT_LIST_LIMIT).min(MAX_LIST_LIMIT) as usize;
            let count = load_count(deps.storage)?;
            let top = match start_after {
                Some(s) => s.saturating_sub(1).min(count),
                None => count,
            };
            let mut out = Vec::with_capacity(limit);
            let mut id = top;
            while id >= 1 && out.len() < limit {
                if let Some(r) = load_record(deps.storage, id)? {
                    out.push(r);
                }
                id -= 1;
            }
            to_json_binary(&out)
        }
        QueryMsg::MeId { address } => {
            let addr = deps.api.addr_validate(&address)?;
            to_json_binary(&meid::query_me_id(&deps.querier, addr.as_str())?)
        }
        QueryMsg::Config {} => to_json_binary(&load_config(deps.storage)?),
    }
}
