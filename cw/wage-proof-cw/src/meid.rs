//! Read a ME ID (DID) from inside a CosmWasm contract.
//!
//! ME Hub whitelists exactly one DID query for contracts (Stargate query plugin,
//! `me-hub/app/keepers/wasm_me_query.go`): path `/metaearth.did.Query/Did`,
//! request `QueryDid { string address = 1; }`, response `QueryDidResponse { DidInfo info = 1; }`
//! (`proto/metaearth/did/query.proto`, `did.proto`).
//!
//! wasmd 0.43 returns Stargate responses as proto-JSON; we also accept raw protobuf so the
//! contract keeps working if a chain upgrade switches the encoding.
//!
//! "Not found" is answered by the node with an error (REST: `codespace did code 111: DID not
//! found`; wasmd redacts query errors to `codespace: did, code: 111`). Only that error maps to
//! level `none`. Every other error is an upstream failure and is returned as an error, never
//! treated as "verified" or as "none".

use cosmwasm_schema::cw_serde;
use cosmwasm_std::{
    to_json_vec, Binary, ContractResult, Empty, QuerierWrapper, QueryRequest, StdError, StdResult,
    SystemResult,
};
use serde::Deserialize;

pub const DID_QUERY_PATH: &str = "/metaearth.did.Query/Did";

#[cw_serde]
#[derive(Copy, Eq, PartialOrd, Ord)]
pub enum Level {
    None,
    One,
    Two,
}

impl Level {
    pub fn as_str(&self) -> &'static str {
        match self {
            Level::None => "none",
            Level::One => "one",
            Level::Two => "two",
        }
    }
}

#[cw_serde]
pub struct MeIdInfo {
    pub address: String,
    /// none / one / two (KYC_LEVEL_ONE -> one, KYC_LEVEL_TWO -> two, anything else -> none)
    pub level: Level,
    /// raw values from the node; empty when the DID does not exist
    pub kyc_level: String,
    pub status: String,
    pub did: String,
    /// "found" or "not_found"
    pub source: String,
    /// raw node error for "not_found", empty otherwise
    pub raw_error: String,
}

/// protobuf encoding of `QueryDid { address }` (field 1, wire type 2)
pub fn encode_query_did(address: &str) -> Vec<u8> {
    let mut out = vec![0x0a];
    put_varint(&mut out, address.len() as u64);
    out.extend_from_slice(address.as_bytes());
    out
}

fn put_varint(out: &mut Vec<u8>, mut v: u64) {
    while v >= 0x80 {
        out.push((v as u8) | 0x80);
        v >>= 7;
    }
    out.push(v as u8);
}

pub fn is_not_found(err: &str) -> bool {
    err.contains("DID not found") || err.contains("codespace: did, code: 111")
}

pub fn level_from(kyc_level: &str, status: &str) -> Level {
    if status != "DID_STATUS_ACTIVE" {
        return Level::None;
    }
    match kyc_level {
        "KYC_LEVEL_ONE" => Level::One,
        "KYC_LEVEL_TWO" => Level::Two,
        _ => Level::None,
    }
}

pub fn query_me_id(querier: &QuerierWrapper, address: &str) -> StdResult<MeIdInfo> {
    let req: QueryRequest<Empty> = QueryRequest::Stargate {
        path: DID_QUERY_PATH.to_string(),
        data: Binary(encode_query_did(address)),
    };
    let raw = to_json_vec(&req)?;
    match querier.raw_query(&raw) {
        SystemResult::Err(e) => classify_error(address, format!("system error: {e}")),
        SystemResult::Ok(ContractResult::Err(e)) => classify_error(address, e),
        SystemResult::Ok(ContractResult::Ok(bin)) => parse_response(address, bin.as_slice()),
    }
}

fn classify_error(address: &str, err: String) -> StdResult<MeIdInfo> {
    if is_not_found(&err) {
        Ok(MeIdInfo {
            address: address.to_string(),
            level: Level::None,
            kyc_level: String::new(),
            status: String::new(),
            did: String::new(),
            source: "not_found".to_string(),
            raw_error: err,
        })
    } else {
        Err(StdError::generic_err(format!("ME ID lookup failed: {err}")))
    }
}

#[derive(Deserialize)]
struct JsonResp {
    info: JsonInfo,
}

#[derive(Deserialize)]
struct JsonInfo {
    #[serde(default)]
    did: String,
    #[serde(default)]
    status: String,
    #[serde(default, alias = "kyc_level")]
    #[serde(rename = "kycLevel")]
    kyc_level: String,
}

pub fn parse_response(address: &str, bytes: &[u8]) -> StdResult<MeIdInfo> {
    let (did, status, kyc_level) = if bytes.first() == Some(&b'{') {
        let r: JsonResp = cosmwasm_std::from_json(bytes)
            .map_err(|e| StdError::generic_err(format!("ME ID lookup failed: bad JSON response: {e}")))?;
        (r.info.did, r.info.status, r.info.kyc_level)
    } else {
        decode_proto(bytes)
            .ok_or_else(|| StdError::generic_err("ME ID lookup failed: unreadable response"))?
    };
    Ok(MeIdInfo {
        address: address.to_string(),
        level: level_from(&kyc_level, &status),
        kyc_level,
        status,
        did,
        source: "found".to_string(),
        raw_error: String::new(),
    })
}

// ---- minimal protobuf reader for QueryDidResponse / DidInfo ----

fn read_varint(b: &[u8], i: &mut usize) -> Option<u64> {
    let mut v: u64 = 0;
    for shift in (0..64).step_by(7) {
        let byte = *b.get(*i)?;
        *i += 1;
        v |= ((byte & 0x7f) as u64) << shift;
        if byte < 0x80 {
            return Some(v);
        }
    }
    None
}

/// Walk fields; returns (field number, wire type, varint value or bytes)
fn fields(b: &[u8]) -> Option<Vec<(u64, Result<u64, &[u8]>)>> {
    let mut i = 0;
    let mut out = vec![];
    while i < b.len() {
        let key = read_varint(b, &mut i)?;
        let (num, wt) = (key >> 3, key & 7);
        match wt {
            0 => out.push((num, Ok(read_varint(b, &mut i)?))),
            2 => {
                let len = read_varint(b, &mut i)? as usize;
                let end = i.checked_add(len)?;
                out.push((num, Err(b.get(i..end)?)));
                i = end;
            }
            _ => return None,
        }
    }
    Some(out)
}

fn kyc_name(v: u64) -> String {
    match v {
        0 => "KYC_LEVEL_NONE",
        1 => "KYC_LEVEL_ONE",
        2 => "KYC_LEVEL_TWO",
        3 => "KYC_LEVEL_THREE",
        4 => "KYC_LEVEL_FOUR",
        _ => "KYC_LEVEL_UNKNOWN",
    }
    .to_string()
}

fn status_name(v: u64) -> String {
    match v {
        1 => "DID_STATUS_ACTIVE",
        0 => "DID_STATUS_INACTIVE",
        _ => "DID_STATUS_UNKNOWN",
    }
    .to_string()
}

pub fn decode_proto(b: &[u8]) -> Option<(String, String, String)> {
    let info = fields(b)?.into_iter().find(|(n, _)| *n == 1)?.1.err()?;
    let (mut did, mut status, mut kyc) = (String::new(), status_name(0), kyc_name(0));
    for (n, v) in fields(info)? {
        match (n, v) {
            (1, Err(s)) => did = String::from_utf8(s.to_vec()).ok()?,
            (4, Ok(x)) => status = status_name(x),
            (6, Ok(x)) => kyc = kyc_name(x),
            _ => {}
        }
    }
    Some((did, status, kyc))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encodes_query_did() {
        let b = encode_query_did("me1abc");
        assert_eq!(b, [&[0x0a, 6][..], b"me1abc"].concat());
    }

    #[test]
    fn only_did_not_found_means_none() {
        assert!(is_not_found("codespace: did, code: 111"));
        assert!(is_not_found("codespace did code 111: DID not found"));
        assert!(!is_not_found("Stargate queries are disabled"));
        let e = classify_error("me1x", "Unsupported query type: Stargate queries are disabled".into());
        assert!(e.unwrap_err().to_string().contains("ME ID lookup failed"));
        assert_eq!(classify_error("me1x", "codespace: did, code: 111".into()).unwrap().level, Level::None);
    }

    #[test]
    fn parses_proto_json() {
        let j = br#"{"info":{"did":"did:me:1","address":"me1x","pubkey":"","status":"DID_STATUS_ACTIVE","regionId":"","kycLevel":"KYC_LEVEL_TWO","sub_account":""}}"#;
        let r = parse_response("me1x", j).unwrap();
        assert_eq!((r.level, r.kyc_level.as_str(), r.status.as_str()), (Level::Two, "KYC_LEVEL_TWO", "DID_STATUS_ACTIVE"));
    }

    #[test]
    fn parses_raw_protobuf_and_inactive_is_none() {
        // info{did="d", status=1, kycLevel=1}
        let info = [0x0a, 1, b'd', 0x20, 1, 0x30, 1];
        let resp = [&[0x0a, info.len() as u8][..], &info].concat();
        assert_eq!(parse_response("me1x", &resp).unwrap().level, Level::One);
        let inactive = [0x0a, 1, b'd', 0x30, 2]; // status default 0 = INACTIVE
        let resp = [&[0x0a, inactive.len() as u8][..], &inactive].concat();
        assert_eq!(parse_response("me1x", &resp).unwrap().level, Level::None);
        assert!(parse_response("me1x", &[0xff]).is_err());
    }
}
