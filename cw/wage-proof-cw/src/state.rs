//! Storage without extra crates: JSON values under fixed byte keys.
use cosmwasm_schema::cw_serde;
use cosmwasm_std::{from_json, to_json_vec, Addr, StdResult, Storage, Uint128};

use crate::meid::Level;

#[cw_serde]
#[derive(Copy)]
pub enum Status {
    Pending,
    Confirmed,
    Disputed,
    Expired,
}

impl Status {
    pub fn as_str(&self) -> &'static str {
        match self {
            Status::Pending => "pending",
            Status::Confirmed => "confirmed",
            Status::Disputed => "disputed",
            Status::Expired => "expired",
        }
    }
}

#[cw_serde]
pub struct Config {
    pub min_employer_level: Level,
    /// denom a claim is paid in (the chain's native coin, `umec` on ME Hub)
    pub settle_denom: String,
}

#[cw_serde]
pub struct Record {
    pub id: u64,
    pub worker: Addr,
    pub employer: Addr,
    pub report_hash: String,
    /// set only on dispute (fingerprint of the employer's reason)
    pub reason_hash: Option<String>,
    pub submitted_at: u64,
    /// last second at which the employer may still respond
    pub deadline: u64,
    pub closed_at: Option<u64>,
    pub closed_by: Option<Addr>,
    pub status: Status,
    /// ME ID levels read by the contract at submit time
    pub employer_level: Level,
    pub worker_level: Level,
    /// amount (settle_denom base units) the worker asked to be paid back; 0 = none
    pub claim: Uint128,
    /// amount the employer paid to the worker through the contract on confirm; 0 = not settled
    pub settled: Uint128,
}

const CONFIG: &[u8] = b"config";
const COUNT: &[u8] = b"count";

fn rec_key(id: u64) -> Vec<u8> {
    [b"rec:".as_slice(), &id.to_be_bytes()].concat()
}
fn rpt_key(hash: &str) -> Vec<u8> {
    [b"rpt:".as_slice(), hash.as_bytes()].concat()
}

pub fn save_config(s: &mut dyn Storage, c: &Config) -> StdResult<()> {
    s.set(CONFIG, &to_json_vec(c)?);
    Ok(())
}
pub fn load_config(s: &dyn Storage) -> StdResult<Config> {
    from_json(s.get(CONFIG).unwrap_or_default())
}
pub fn save_count(s: &mut dyn Storage, n: u64) -> StdResult<()> {
    s.set(COUNT, &to_json_vec(&n)?);
    Ok(())
}
pub fn load_count(s: &dyn Storage) -> StdResult<u64> {
    s.get(COUNT).map(from_json).unwrap_or(Ok(0))
}
pub fn save_record(s: &mut dyn Storage, r: &Record) -> StdResult<()> {
    s.set(&rec_key(r.id), &to_json_vec(r)?);
    Ok(())
}
pub fn load_record(s: &dyn Storage, id: u64) -> StdResult<Option<Record>> {
    s.get(&rec_key(id)).map(from_json).transpose()
}
pub fn load_report_ids(s: &dyn Storage, hash: &str) -> StdResult<Vec<u64>> {
    s.get(&rpt_key(hash)).map(from_json).unwrap_or(Ok(vec![]))
}
pub fn push_report_id(s: &mut dyn Storage, hash: &str, id: u64) -> StdResult<()> {
    let mut ids = load_report_ids(s, hash)?;
    ids.push(id);
    s.set(&rpt_key(hash), &to_json_vec(&ids)?);
    Ok(())
}
