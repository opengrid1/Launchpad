//! The launchpad factory. Publishes the coin code once as a NEAR global
//! contract and creates one account per coin that points at it, so every coin
//! runs exactly the same bytes. Keeps the pair list and the registry the site
//! lists from, and the platform's admin controls.

use near_sdk::json_types::{Base58CryptoHash, U128};
use near_sdk::store::{IterableMap, LookupMap};
use near_sdk::{
    env, log, near, require, AccountId, BorshStorageKey, CryptoHash, Gas, NearToken, PanicOnDefault,
    Promise, PromiseResult,
};

const GAS_FOR_NEW: Gas = Gas::from_tgas(30);
const GAS_FOR_INITIAL_BUY: Gas = Gas::from_tgas(30);
const GAS_FOR_PAIR_REGISTER: Gas = Gas::from_tgas(10);
const GAS_FOR_CALLBACK: Gas = Gas::from_tgas(10);
const GAS_FOR_ADMIN_CALL: Gas = Gas::from_tgas(25);
/// NEAR the coin account is created with, for its state.
const COIN_STATE_DEPOSIT: u128 = 500_000_000_000_000_000_000_000; // 0.5 NEAR
/// Storage deposit the factory pays on a NEP-141 pair so the coin can hold it.
const PAIR_REGISTER_DEPOSIT: u128 = 12_500_000_000_000_000_000_000; // 0.0125 NEAR

#[derive(BorshStorageKey)]
#[near]
enum StorageKey {
    Coins,
    Versions,
    Pairs,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Split {
    pub creator_bps: u32,
    pub dividends_bps: u32,
    pub burn_bps: u32,
    pub liquidity_bps: u32,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Links {
    pub website: Option<String>,
    pub x: Option<String>,
    pub telegram: Option<String>,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum PairAsset {
    Near,
    Token { account_id: AccountId, symbol: String, decimals: u8 },
}

/// A pair coins can be made in. `virtual_reserve` is the curve's starting
/// reserve in the pair's units; a coin graduates at twice it.
#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct Pair {
    pub key: String,
    pub asset: PairAsset,
    pub name: String,
    pub virtual_reserve: U128,
    pub enabled: bool,
}

/// What a creator fills in. Everything here is fixed at launch.
#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct LaunchParams {
    pub name: String,
    pub symbol: String,
    pub icon: Option<String>,
    pub description: String,
    pub links: Links,
    /// A pair key from `list_pairs`. Defaults to NEAR.
    pub pair: Option<String>,
    pub buy_tax_bps: u32,
    pub sell_tax_bps: u32,
    pub split: Split,
    /// Where creator fees go. Defaults to the creator.
    pub fee_wallet: Option<AccountId>,
    /// Optional first trade in yoctoNEAR, NEAR coins only, before anyone else can buy.
    pub initial_buy: Option<U128>,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct Coin {
    pub id: u64,
    pub account_id: AccountId,
    pub name: String,
    pub symbol: String,
    pub pair: String,
    pub creator: AccountId,
    pub created_at_ms: u64,
    pub code_version: String,
    pub hidden: bool,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct Version {
    pub version: String,
    pub code_hash: Base58CryptoHash,
    pub published_at_block: u64,
}

#[near(serializers = [json])]
pub struct Config {
    pub owner: AccountId,
    pub treasury: AccountId,
    pub launch_fee: U128,
    pub coin_state_deposit: U128,
    pub paused: bool,
    pub current_version: Option<Version>,
    pub count: u64,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Factory {
    owner: AccountId,
    treasury: AccountId,
    launch_fee: u128,
    paused: bool,
    coins: IterableMap<u64, Coin>,
    versions: LookupMap<String, Version>,
    pairs: IterableMap<String, Pair>,
    current_version: Option<String>,
    next_id: u64,
}

#[near]
impl Factory {
    #[init]
    pub fn new(owner: AccountId, treasury: AccountId, launch_fee: U128, near_virtual_reserve: U128) -> Self {
        let mut pairs = IterableMap::new(StorageKey::Pairs);
        pairs.insert("NEAR".to_string(), Pair {
            key: "NEAR".to_string(),
            asset: PairAsset::Near,
            name: "NEAR".to_string(),
            virtual_reserve: near_virtual_reserve,
            enabled: true,
        });
        Self {
            owner,
            treasury,
            launch_fee: launch_fee.0,
            paused: false,
            coins: IterableMap::new(StorageKey::Coins),
            versions: LookupMap::new(StorageKey::Versions),
            pairs,
            current_version: None,
            next_id: 1,
        }
    }

    // ------------------------------------------------------------------
    // Launching
    // ------------------------------------------------------------------

    /// Creates a coin. Attach the launch fee, the coin's state deposit and the
    /// initial buy, if any. Anything over is refunded.
    #[payable]
    pub fn create(&mut self, params: LaunchParams) -> Promise {
        require!(!self.paused, "new launches are paused");
        let version = self.current_version.clone().expect("no launch code published");
        let ver = self.versions.get(&version).expect("version").clone();
        let pair_key = params.pair.clone().unwrap_or_else(|| "NEAR".to_string());
        let pair = self.pairs.get(&pair_key).unwrap_or_else(|| env::panic_str("unknown pair")).clone();
        require!(pair.enabled, "this pair is not taking new launches");
        let creator = env::predecessor_account_id();
        let initial_buy = params.initial_buy.map(|b| b.0).unwrap_or(0);
        require!(initial_buy == 0 || pair.asset == PairAsset::Near, "initial buy is for NEAR coins");
        let need = self.launch_fee + COIN_STATE_DEPOSIT + initial_buy
            + if pair.asset == PairAsset::Near { 0 } else { PAIR_REGISTER_DEPOSIT };
        let attached = env::attached_deposit().as_yoctonear();
        require!(attached >= need, "attach the launch fee, the state deposit and the initial buy");
        let refund = attached - need;

        let id = self.next_id;
        self.next_id += 1;
        let account_id: AccountId = format!("c{}.{}", id, env::current_account_id())
            .parse()
            .expect("account id");
        let fee_wallet = params.fee_wallet.clone().unwrap_or_else(|| creator.clone());
        let symbol = params.symbol.trim().to_uppercase();
        let init = near_sdk::serde_json::json!({
            "factory": env::current_account_id(),
            "treasury": self.treasury,
            "name": params.name.trim(),
            "symbol": symbol,
            "icon": params.icon,
            "description": params.description,
            "links": params.links,
            "creator": creator,
            "fee_wallet": fee_wallet,
            "pair": pair.asset,
            "virtual_reserve": pair.virtual_reserve,
            "buy_tax_bps": params.buy_tax_bps,
            "sell_tax_bps": params.sell_tax_bps,
            "split": params.split,
        });
        let mut p = Promise::new(account_id.clone())
            .create_account()
            .transfer(NearToken::from_yoctonear(COIN_STATE_DEPOSIT))
            .use_global_contract(CryptoHash::from(ver.code_hash))
            .function_call("new", init.to_string().into_bytes(), NearToken::from_yoctonear(0), GAS_FOR_NEW);
        if initial_buy > 0 {
            let args = near_sdk::serde_json::json!({ "min_out": null, "for_account": creator });
            p = p.function_call("buy", args.to_string().into_bytes(), NearToken::from_yoctonear(initial_buy), GAS_FOR_INITIAL_BUY);
        }
        if let PairAsset::Token { account_id: pair_token, .. } = &pair.asset {
            // The coin must be registered on its pair token to hold and pay it.
            let args = near_sdk::serde_json::json!({ "account_id": account_id, "registration_only": true });
            p = p.then(Promise::new(pair_token.clone()).function_call(
                "storage_deposit",
                args.to_string().into_bytes(),
                NearToken::from_yoctonear(PAIR_REGISTER_DEPOSIT),
                GAS_FOR_PAIR_REGISTER,
            ));
        }
        // Registered now so the coin is listed the moment its account exists;
        // the callback removes it and refunds if the launch failed.
        self.coins.insert(id, Coin {
            id,
            account_id: account_id.clone(),
            name: params.name.trim().to_string(),
            symbol,
            pair: pair_key,
            creator: creator.clone(),
            created_at_ms: env::block_timestamp_ms(),
            code_version: version,
            hidden: false,
        });
        p.then(
            Self::ext(env::current_account_id())
                .with_static_gas(GAS_FOR_CALLBACK)
                .on_created(id, creator, U128(attached), U128(refund)),
        )
    }

    #[private]
    #[allow(deprecated)]
    pub fn on_created(&mut self, id: u64, creator: AccountId, attached: U128, refund: U128) {
        // The launch batch ends in `new` or `buy`, which return different
        // things, so the result is checked for success only.
        let ok = matches!(env::promise_result(0), PromiseResult::Successful(_));
        match ok {
            true => {
                let coin = self.coins.get(&id).expect("coin");
                log!(
                    "EVENT_JSON:{{\"standard\":\"launchpad\",\"version\":\"1.0.0\",\"event\":\"created\",\"data\":{{\"id\":{},\"account_id\":\"{}\",\"creator\":\"{}\",\"pair\":\"{}\"}}}}",
                    id, coin.account_id, creator, coin.pair
                );
                // Promises scheduled here run when dropped.
                if self.launch_fee > 0 {
                    let _pay = Promise::new(self.treasury.clone()).transfer(NearToken::from_yoctonear(self.launch_fee));
                }
                if refund.0 > 0 {
                    let _refund = Promise::new(creator).transfer(NearToken::from_yoctonear(refund.0));
                }
            }
            false => {
                // The account was not created (or init failed): give everything back.
                self.coins.remove(&id);
                let _refund = Promise::new(creator).transfer(NearToken::from_yoctonear(attached.0));
            }
        }
    }

    // ------------------------------------------------------------------
    // Views
    // ------------------------------------------------------------------

    pub fn get_config(&self) -> Config {
        Config {
            owner: self.owner.clone(),
            treasury: self.treasury.clone(),
            launch_fee: U128(self.launch_fee),
            coin_state_deposit: U128(COIN_STATE_DEPOSIT),
            paused: self.paused,
            current_version: self.current_version.as_ref().and_then(|v| self.versions.get(v).cloned()),
            count: self.coins.len() as u64,
        }
    }

    pub fn get_coin(&self, id: u64) -> Option<Coin> {
        self.coins.get(&id).cloned()
    }

    /// Newest first. `from_id` is exclusive; omit it for the newest.
    pub fn list(&self, from_id: Option<u64>, limit: Option<u64>, include_hidden: Option<bool>) -> Vec<Coin> {
        let limit = limit.unwrap_or(50).min(200) as usize;
        let mut id = from_id.unwrap_or(self.next_id);
        let hidden = include_hidden.unwrap_or(false);
        let mut out = Vec::new();
        while id > 1 && out.len() < limit {
            id -= 1;
            if let Some(c) = self.coins.get(&id) {
                if hidden || !c.hidden { out.push(c.clone()); }
            }
        }
        out
    }

    pub fn list_pairs(&self) -> Vec<Pair> {
        self.pairs.values().cloned().collect()
    }

    pub fn get_pair(&self, key: String) -> Option<Pair> {
        self.pairs.get(&key).cloned()
    }

    pub fn get_version(&self, version: String) -> Option<Version> {
        self.versions.get(&version).cloned()
    }

    // ------------------------------------------------------------------
    // Admin: the platform owner.
    // ------------------------------------------------------------------

    /// Publishes coin code as a global contract, keyed by version. A version
    /// can be published once, so a version always names one set of bytes.
    /// Attach the global-contract storage cost.
    #[payable]
    pub fn publish_code(&mut self, version: String, code_hash: Base58CryptoHash, code: near_sdk::json_types::Base64VecU8) -> Promise {
        self.assert_owner();
        require!(!self.versions.contains_key(&version), "version already published");
        let code: Vec<u8> = code.into();
        require!(env::sha256_array(&code) == CryptoHash::from(code_hash), "code_hash does not match the code");
        self.versions.insert(version.clone(), Version {
            version: version.clone(),
            code_hash,
            published_at_block: env::block_height(),
        });
        self.current_version = Some(version);
        Promise::new(env::current_account_id()).deploy_global_contract(code)
    }

    /// Points new launches at an already published version.
    pub fn set_current_version(&mut self, version: String) {
        self.assert_owner();
        require!(self.versions.contains_key(&version), "unknown version");
        self.current_version = Some(version);
    }

    /// Adds or updates a pair coins can be made in. A coin already made keeps
    /// the figures it was made with.
    pub fn set_pair(&mut self, key: String, asset: PairAsset, name: String, virtual_reserve: U128, enabled: bool) {
        self.assert_owner();
        require!(!key.is_empty() && key.len() <= 16, "key");
        require!(virtual_reserve.0 > 0, "virtual reserve");
        if key == "NEAR" { require!(asset == PairAsset::Near, "NEAR is native"); }
        self.pairs.insert(key.clone(), Pair { key, asset, name, virtual_reserve, enabled });
    }

    pub fn set_owner(&mut self, owner: AccountId) {
        self.assert_owner();
        self.owner = owner;
    }

    /// Future platform fees, for the factory and every coin it is told about.
    pub fn set_treasury(&mut self, treasury: AccountId) {
        self.assert_owner();
        self.treasury = treasury;
    }

    pub fn set_launch_fee(&mut self, launch_fee: U128) {
        self.assert_owner();
        self.launch_fee = launch_fee.0;
    }

    pub fn set_paused(&mut self, paused: bool) {
        self.assert_owner();
        self.paused = paused;
    }

    /// Hides a coin from the list. It keeps trading; only the listing changes.
    pub fn set_hidden(&mut self, id: u64, hidden: bool) {
        self.assert_owner();
        let mut c = self.coins.get(&id).expect("coin").clone();
        c.hidden = hidden;
        self.coins.insert(id, c);
    }

    /// Re-points a coin's creator fees, for a community takeover.
    pub fn coin_set_fee_wallet(&mut self, id: u64, fee_wallet: AccountId, reason: Option<String>) -> Promise {
        self.assert_owner();
        let args = near_sdk::serde_json::json!({ "fee_wallet": fee_wallet, "reason": reason });
        self.call_coin(id, "set_fee_wallet", args)
    }

    pub fn coin_set_treasury(&mut self, id: u64, treasury: AccountId) -> Promise {
        self.assert_owner();
        self.call_coin(id, "set_treasury", near_sdk::serde_json::json!({ "treasury": treasury }))
    }

    pub fn coin_set_metadata(&mut self, id: u64, icon: Option<String>, description: Option<String>, links: Option<Links>) -> Promise {
        self.assert_owner();
        let args = near_sdk::serde_json::json!({ "icon": icon, "description": description, "links": links });
        self.call_coin(id, "set_metadata", args)
    }

    /// Moves `bps` of a graduated coin's Rhea LP shares to `to`, who can then
    /// remove the liquidity on Rhea. Attach 0.01 NEAR in case `to` is not yet
    /// registered on the pool. Not reversible.
    #[payable]
    pub fn coin_collect_liquidity(&mut self, id: u64, bps: u32, to: AccountId) -> Promise {
        self.assert_owner();
        let coin = self.coins.get(&id).expect("coin");
        Promise::new(coin.account_id.clone()).function_call(
            "collect_liquidity",
            near_sdk::serde_json::json!({ "bps": bps, "to": to }).to_string().into_bytes(),
            env::attached_deposit(),
            Gas::from_tgas(80),
        )
    }

    /// Pulls `bps` of what a coin's curve holds, pair and unsold tokens, to `to`.
    /// Only while the coin is on the curve. Not reversible.
    pub fn coin_collect_curve(&mut self, id: u64, bps: u32, to: AccountId) -> Promise {
        self.assert_owner();
        let coin = self.coins.get(&id).expect("coin");
        Promise::new(coin.account_id.clone()).function_call(
            "collect_curve",
            near_sdk::serde_json::json!({ "bps": bps, "to": to }).to_string().into_bytes(),
            NearToken::from_yoctonear(0),
            Gas::from_tgas(50),
        )
    }

    /// Pays the platform's share held in a coin to the treasury. Anyone may call.
    pub fn collect_platform(&mut self, id: u64) -> Promise {
        self.call_coin(id, "claim_platform", near_sdk::serde_json::json!({}))
    }

    /// Collects from several coins in one transaction. Anyone may call; each
    /// coin pays the treasury. Up to 10 at a time.
    pub fn collect_platform_many(&mut self, ids: Vec<u64>) -> Promise {
        require!(!ids.is_empty() && ids.len() <= 10, "1 to 10 coins");
        let mut it = ids.into_iter();
        let mut p = self.call_coin(it.next().unwrap(), "claim_platform", near_sdk::serde_json::json!({}));
        for id in it {
            p = p.and(self.call_coin(id, "claim_platform", near_sdk::serde_json::json!({})));
        }
        p
    }

    fn call_coin(&self, id: u64, method: &str, args: near_sdk::serde_json::Value) -> Promise {
        let coin = self.coins.get(&id).expect("coin");
        Promise::new(coin.account_id.clone()).function_call(
            method,
            args.to_string().into_bytes(),
            NearToken::from_yoctonear(0),
            GAS_FOR_ADMIN_CALL,
        )
    }

    fn assert_owner(&self) {
        require!(env::predecessor_account_id() == self.owner, "owner only");
    }
}

#[cfg(test)]
mod tests;
