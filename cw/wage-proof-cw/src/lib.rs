//! Probe contract: instantiate + one query `me_id { address }` that reads the ME ID module
//! from inside the contract (Stargate query `/metaearth.did.Query/Did`).

pub mod meid;

use cosmwasm_schema::{cw_serde, QueryResponses};
use cosmwasm_std::{
    entry_point, to_json_binary, Binary, Deps, DepsMut, Env, MessageInfo, Response, StdResult,
};

pub use meid::{Level, MeIdInfo};

#[cw_serde]
pub struct InstantiateMsg {}

#[cw_serde]
#[derive(QueryResponses)]
pub enum QueryMsg {
    #[returns(MeIdInfo)]
    MeId { address: String },
}

#[cfg_attr(not(feature = "library"), entry_point)]
pub fn instantiate(
    _deps: DepsMut,
    _env: Env,
    _info: MessageInfo,
    _msg: InstantiateMsg,
) -> StdResult<Response> {
    Ok(Response::new().add_attribute("action", "instantiate"))
}

#[cfg_attr(not(feature = "library"), entry_point)]
pub fn query(deps: Deps, _env: Env, msg: QueryMsg) -> StdResult<Binary> {
    match msg {
        QueryMsg::MeId { address } => {
            let addr = deps.api.addr_validate(&address)?;
            to_json_binary(&meid::query_me_id(&deps.querier, addr.as_str())?)
        }
    }
}
