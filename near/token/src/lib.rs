//! One launched coin. The token, its bonding curve, its tax and its holder
//! dividends live in this one account. When the curve fills, the coin opens a
//! pool on Rhea (the Ref exchange, `v2.ref-finance.near`) and keeps the LP.
//!
//! The coin has a pair, fixed at launch: native NEAR or any NEP-141 token (a
//! bridged Ondo stock, for instance). People pay in the pair, the curve holds
//! the pair, the Rhea pool is coin/pair, and every payout is in the pair.
//!
//! Numbers, all fixed at launch and never changed:
//! - 1,000,000,000 tokens minted once. 750,000,000 sell on the curve, the other
//!   250,000,000 seed the Rhea pool.
//! - The curve is a constant product over a virtual reserve of the pair (1,000
//!   NEAR on a NEAR coin, about that much worth on other pairs) and
//!   1,125,000,000 tokens: the last token costs nine times the first, and the
//!   curve raises exactly twice the virtual reserve.
//! - The pool opens on Rhea at the last curve price with everything the curve
//!   raised and the 250,000,000 tokens held back. The coin owns the LP shares;
//!   only the platform (through the factory) can move them.
//! - On the curve every trade pays the creator's tax (1% to 10% a side, in the
//!   pair). The platform keeps 20% of it; the creator's four shares divide the
//!   other 80%: creator, holder dividends, buyback and burn, liquidity.
//! - After graduation the same tax is taken in tokens on every transfer to or
//!   from Rhea (a sell or a buy). Anyone may call `harvest`: the burn share is
//!   burned, the rest is sold on Rhea for the pair and divided the same way,
//!   with the liquidity share added to the pool.
//! - Everything the coin owes anyone is a credit inside the contract until it
//!   is claimed. Nothing is ever pushed.

use near_contract_standards::fungible_token::core::FungibleTokenCore;
use near_contract_standards::fungible_token::metadata::{
    FungibleTokenMetadata, FungibleTokenMetadataProvider, FT_METADATA_SPEC,
};
use near_contract_standards::fungible_token::receiver::{ext_ft_receiver, FungibleTokenReceiver};
use near_contract_standards::fungible_token::resolver::FungibleTokenResolver;
use near_contract_standards::fungible_token::FungibleToken;
use near_contract_standards::storage_management::{
    StorageBalance, StorageBalanceBounds, StorageManagement,
};
use near_sdk::json_types::U128;
use near_sdk::store::LookupMap;
use near_sdk::{
    assert_one_yocto, env, ext_contract, log, near, require, AccountId, BorshStorageKey, Gas,
    NearToken, PanicOnDefault, Promise, PromiseError, PromiseOrValue, PromiseResult,
};

uint::construct_uint! {
    pub struct U256(4);
}

/// 18 decimals, like every coin on the platform.
pub const DECIMALS: u8 = 18;
const ONE: u128 = 1_000_000_000_000_000_000;
/// Minted once at launch.
pub const TOTAL_SUPPLY: u128 = 1_000_000_000 * ONE;
/// Sold on the curve.
pub const CURVE_SUPPLY: u128 = 750_000_000 * ONE;
/// Held back to seed the pool.
pub const POOL_SUPPLY: u128 = TOTAL_SUPPLY - CURVE_SUPPLY;
/// Virtual token reserve the curve starts from. The pair side is per coin.
pub const VIRTUAL_TOKENS: u128 = 1_125_000_000 * ONE;

pub const BPS: u32 = 10_000;
/// The platform's share of every tax, fixed for every coin.
pub const PLATFORM_BPS: u32 = 2_000;
pub const MIN_TAX_BPS: u32 = 100;
pub const MAX_TAX_BPS: u32 = 1_000;

/// The exchange the coin graduates to, and its wrapped NEAR.
pub const DEX: &str = "v2.ref-finance.near";
pub const WNEAR: &str = "wrap.near";
/// Rhea pool fee, in Rhea's units (30 = 0.3%). It accrues to the LP, the coin.
pub const DEX_POOL_FEE: u32 = 30;

const MILLI: u128 = 1_000_000_000_000_000_000_000;
/// NEAR the opener attaches for the pool's storage on Rhea and wrap.near.
pub const GRAD_COST: u128 = 200 * MILLI;
const DEX_STORAGE: u128 = 100 * MILLI;
const POOL_STORAGE: u128 = 50 * MILLI;
const LP_STORAGE: u128 = 30 * MILLI;
const WNEAR_STORAGE: u128 = 1_250 * MILLI / 1_000;
const LP_REGISTER: u128 = 10 * MILLI;
/// Registers the exchange on the pair token; standard tokens refund the excess.
const PAIR_REGISTER: u128 = 12_500 * MILLI / 1_000;
/// What every holder locks for their three storage entries (balance, dividend
/// debt, credit). Returned on `storage_unregister`.
pub const MIN_STORAGE: u128 = 4 * MILLI;
/// Tax tokens that must be waiting before a harvest is worth its gas.
pub const HARVEST_MIN: u128 = 1_000 * ONE;
/// A cross-contract sequence holds its lock this long; a stuck one can be retried after.
const LOCK_NS: u64 = 120 * 1_000_000_000;

/// Scale for accumulated dividends per token.
const ACC_SCALE: u128 = 1_000_000_000_000_000_000;

const GAS_CB_SMALL: Gas = Gas::from_tgas(5);
const GAS_FT_TRANSFER: Gas = Gas::from_tgas(10);
const GAS_DEX_SMALL: Gas = Gas::from_tgas(10);
const GAS_DEX_DEPOSIT: Gas = Gas::from_tgas(30);
const GAS_PAIR_DEPOSIT: Gas = Gas::from_tgas(60);
const GAS_DEX_SWAP: Gas = Gas::from_tgas(30);
const GAS_DEX_LIQUIDITY: Gas = Gas::from_tgas(30);
const GAS_DEX_WITHDRAW: Gas = Gas::from_tgas(50);
const GAS_FT_TRANSFER_CALL: Gas = Gas::from_tgas(30);
const ONE_YOCTO: NearToken = NearToken::from_yoctonear(1);

#[derive(BorshStorageKey)]
#[near]
enum StorageKey {
    Token,
    RewardDebt,
    Credits,
    Candles,
    Trades,
}

/// Five-minute price bucket, kept on chain so the chart needs no indexer.
#[near(serializers = [json, borsh])]
#[derive(Clone, Copy, Debug)]
pub struct Candle {
    /// Bucket start, unix ms.
    pub t: u64,
    pub o: U128,
    pub h: U128,
    pub l: U128,
    pub c: U128,
    /// Pair units traded in the bucket.
    pub v: U128,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct Trade {
    pub t: u64,
    pub account: AccountId,
    pub buy: bool,
    pub pair: U128,
    pub tokens: U128,
    pub price: U128,
}

/// 5 minutes.
pub const CANDLE_MS: u64 = 5 * 60 * 1000;
/// A day of five-minute candles: the curve rarely lasts longer, and the coin's
/// state deposit has to cover them.
pub const MAX_CANDLES: u32 = 288;
pub const MAX_TRADES: u32 = 100;

/// What a coin is paired with.
#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum PairAsset {
    Near,
    Token { account_id: AccountId, symbol: String, decimals: u8 },
}

/// How the creator divides the 80% of the tax that is theirs. Sums to 10,000.
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
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Phase {
    /// Selling on the curve.
    Curve,
    /// The curve sold out; the Rhea pool is being opened. Anyone may drive it.
    Graduating,
    /// Trading on Rhea.
    Pool,
}

/// Where the graduation sequence stands. Each step is idempotent, so a failed
/// one can be retried with another `open_pool` call.
#[near(serializers = [json, borsh])]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct GradState {
    pub pool_created: bool,
    pub wrapped: bool,
    pub coin_deposited: bool,
    pub pair_deposited: bool,
    pub lock_until: u64,
}

/// A harvest in flight: tax tokens deposited on Rhea, swapped, withdrawn.
#[near(serializers = [json, borsh])]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct HarvestState {
    /// 0 idle, 1 deposited on Rhea, 2 swapped, 3 withdrawn (wNEAR to unwrap).
    pub step: u8,
    pub total: U128,
    pub platform_tokens: U128,
    pub creator_tokens: U128,
    pub dividend_tokens: U128,
    pub liquidity_tokens: U128,
    pub swap_tokens: U128,
    pub out: U128,
    pub liquidity_pair: U128,
    pub lock_until: u64,
}

/// What a buyer says when paying in a NEP-141 pair through `ft_transfer_call`.
#[near(serializers = [json])]
pub struct BuyMsg {
    pub min_out: Option<U128>,
}

/// Everything the token page needs, in one view call.
#[near(serializers = [json])]
pub struct Info {
    pub factory: AccountId,
    pub treasury: AccountId,
    pub name: String,
    pub symbol: String,
    pub icon: Option<String>,
    pub description: String,
    pub links: Links,
    pub creator: AccountId,
    pub fee_wallet: AccountId,
    pub created_at_ms: u64,
    pub pair: PairAsset,
    pub virtual_reserve: U128,
    pub buy_tax_bps: u32,
    pub sell_tax_bps: u32,
    pub split: Split,
    pub phase: Phase,
    pub total_supply: U128,
    pub tokens_sold: U128,
    pub raised: U128,
    /// What seeded the Rhea pool.
    pub pool_pair: U128,
    pub pool_tokens: U128,
    /// Pair units per whole token (1e18 units). After graduation: the opening price; read Rhea for the live one.
    pub price: U128,
    pub market_cap: U128,
    pub graduation: U128,
    pub curve_supply: U128,
    pub burned: U128,
    pub buyback_spent: U128,
    pub liquidity_added: U128,
    pub dividends_total: U128,
    pub creator_fees_total: U128,
    pub platform_fees_total: U128,
    pub pending_buyback: U128,
    pub pending_liquidity: U128,
    pub platform_credit: U128,
    pub trades: u64,
    pub holders: u64,
    pub dex: AccountId,
    pub pool_id: Option<u64>,
    pub lp_shares: U128,
    pub lp_collected: U128,
    pub tax_tokens: U128,
    pub grad: GradState,
    pub harvest: HarvestState,
}

#[near(serializers = [json])]
pub struct Holder {
    pub balance: U128,
    pub claimable_dividends: U128,
    pub credit: U128,
}

#[ext_contract(ext_ft)]
trait ExtFt {
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>);
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    token: FungibleToken,
    factory: AccountId,
    treasury: AccountId,
    name: String,
    symbol: String,
    icon: Option<String>,
    description: String,
    links: Links,
    creator: AccountId,
    fee_wallet: AccountId,
    created_at_ms: u64,
    pair: PairAsset,
    /// The curve's virtual pair reserve; the curve raises twice this.
    virtual_reserve: u128,
    buy_tax_bps: u32,
    sell_tax_bps: u32,
    split: Split,
    phase: Phase,
    tokens_sold: u128,
    raised: u128,
    pool_pair: u128,
    pool_tokens: u128,
    last_price: u128,
    /// Dividends accumulated per token, scaled by ACC_SCALE.
    acc_per_token: u128,
    reward_debt: LookupMap<AccountId, u128>,
    /// Pair units the coin owes an account: sale proceeds, settled dividends, creator fees.
    credits: LookupMap<AccountId, u128>,
    platform_credit: u128,
    pending_buyback: u128,
    pending_liquidity: u128,
    burned: u128,
    buyback_spent: u128,
    liquidity_added: u128,
    dividends_total: u128,
    creator_fees_total: u128,
    platform_fees_total: u128,
    trades: u64,
    holders: u64,
    candles: near_sdk::store::Vector<Candle>,
    candles_start: u32,
    recent: near_sdk::store::Vector<Trade>,
    recent_next: u32,
    pool_id: Option<u64>,
    lp_shares: u128,
    lp_collected: u128,
    /// Tax taken in tokens since graduation, waiting for a harvest.
    tax_tokens: u128,
    grad: GradState,
    harvest: HarvestState,
}

fn mul_div(a: u128, b: u128, c: u128) -> u128 {
    (U256::from(a) * U256::from(b) / U256::from(c)).as_u128()
}

fn dex() -> AccountId {
    DEX.parse().unwrap()
}

fn wnear() -> AccountId {
    WNEAR.parse().unwrap()
}

fn args(v: near_sdk::serde_json::Value) -> Vec<u8> {
    v.to_string().into_bytes()
}

#[allow(deprecated)]
fn result_json<T: near_sdk::serde::de::DeserializeOwned>(i: u64) -> Option<T> {
    match env::promise_result(i) {
        PromiseResult::Successful(bytes) => near_sdk::serde_json::from_slice(&bytes).ok(),
        _ => None,
    }
}

#[allow(deprecated)]
fn result_ok(i: u64) -> bool {
    matches!(env::promise_result(i), PromiseResult::Successful(_))
}

#[near]
impl Contract {
    /// Called once by the factory on the fresh account.
    #[init]
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        factory: AccountId,
        treasury: AccountId,
        name: String,
        symbol: String,
        icon: Option<String>,
        description: String,
        links: Links,
        creator: AccountId,
        fee_wallet: AccountId,
        pair: PairAsset,
        virtual_reserve: U128,
        buy_tax_bps: u32,
        sell_tax_bps: u32,
        split: Split,
    ) -> Self {
        require!(env::predecessor_account_id() == factory, "only the factory launches");
        let n = name.trim().chars().count();
        require!((2..=32).contains(&n), "name: 2 to 32 characters");
        let s = symbol.trim();
        require!(
            (2..=10).contains(&s.len()) && s.chars().all(|c| c.is_ascii_alphanumeric()),
            "ticker: 2 to 10 letters or digits"
        );
        require!(description.chars().count() <= 280, "description: up to 280 characters");
        require!(virtual_reserve.0 > 0, "virtual reserve");
        if let PairAsset::Token { account_id, .. } = &pair {
            require!(account_id != &env::current_account_id() && account_id != &dex(), "pair");
        }
        require!(
            (MIN_TAX_BPS..=MAX_TAX_BPS).contains(&buy_tax_bps)
                && (MIN_TAX_BPS..=MAX_TAX_BPS).contains(&sell_tax_bps),
            "tax: 1% to 10% a side"
        );
        require!(
            split.creator_bps + split.dividends_bps + split.burn_bps + split.liquidity_bps == BPS,
            "the four shares must total 100%"
        );
        require!(
            fee_wallet != env::current_account_id() && fee_wallet != factory && fee_wallet != dex(),
            "fee wallet cannot be the coin, the factory or the exchange"
        );
        let mut token = FungibleToken::new(StorageKey::Token);
        let me = env::current_account_id();
        token.internal_register_account(&me);
        token.internal_deposit(&me, TOTAL_SUPPLY);
        let this = Self {
            token,
            factory,
            treasury,
            name: name.trim().to_string(),
            symbol: s.to_uppercase(),
            icon,
            description,
            links,
            creator,
            fee_wallet,
            created_at_ms: env::block_timestamp_ms(),
            pair,
            virtual_reserve: virtual_reserve.0,
            buy_tax_bps,
            sell_tax_bps,
            split,
            phase: Phase::Curve,
            tokens_sold: 0,
            raised: 0,
            pool_pair: 0,
            pool_tokens: 0,
            last_price: 0,
            acc_per_token: 0,
            reward_debt: LookupMap::new(StorageKey::RewardDebt),
            credits: LookupMap::new(StorageKey::Credits),
            platform_credit: 0,
            pending_buyback: 0,
            pending_liquidity: 0,
            burned: 0,
            buyback_spent: 0,
            liquidity_added: 0,
            dividends_total: 0,
            creator_fees_total: 0,
            platform_fees_total: 0,
            trades: 0,
            holders: 0,
            candles: near_sdk::store::Vector::new(StorageKey::Candles),
            candles_start: 0,
            recent: near_sdk::store::Vector::new(StorageKey::Trades),
            recent_next: 0,
            pool_id: None,
            lp_shares: 0,
            lp_collected: 0,
            tax_tokens: 0,
            grad: GradState::default(),
            harvest: HarvestState::default(),
        };
        this.emit("launch", &format!(
            "{{\"creator\":\"{}\",\"fee_wallet\":\"{}\",\"pair\":\"{}\",\"buy_tax_bps\":{},\"sell_tax_bps\":{}}}",
            this.creator, this.fee_wallet, this.pair_label(), buy_tax_bps, sell_tax_bps
        ));
        this
    }

    // ------------------------------------------------------------------
    // Trading on the curve
    // ------------------------------------------------------------------

    /// Buy a NEAR coin with the attached NEAR. Registers the buyer's storage
    /// out of the attached amount when needed. `for_account` is honoured only
    /// when the factory calls, for the creator's initial buy inside the launch.
    /// A coin in a NEP-141 pair is bought with `ft_transfer_call` on the pair.
    #[payable]
    pub fn buy(&mut self, min_out: Option<U128>, for_account: Option<AccountId>) -> U128 {
        require!(self.pair == PairAsset::Near, "pay in the pair: ft_transfer_call on the pair token");
        let caller = env::predecessor_account_id();
        let buyer = match for_account {
            Some(a) if caller == self.factory => a,
            Some(_) => env::panic_str("for_account is for the factory only"),
            None => caller,
        };
        let mut amount = env::attached_deposit().as_yoctonear();
        require!(amount > 0, "attach NEAR");
        if !self.token.accounts.contains_key(&buyer) {
            require!(amount > MIN_STORAGE, "attach more than the storage cost");
            self.token.internal_register_account(&buyer);
            amount -= MIN_STORAGE;
        }
        let out = self.execute_buy(&buyer, amount, min_out.map(|m| m.0));
        U128(out)
    }

    /// Sell tokens on the curve. What the sale brings in, after tax, is
    /// credited to you in the pair; collect it with `claim`.
    pub fn sell(&mut self, amount: U128, min_out: Option<U128>) -> U128 {
        self.assert_curve();
        let seller = env::predecessor_account_id();
        let amount = amount.0;
        require!(amount > 0, "amount");
        let gross = self.curve_sell(amount);
        let tax = gross * self.sell_tax_bps as u128 / BPS as u128;
        let net = gross - tax;
        require!(net > 0, "too small");
        if let Some(m) = min_out {
            require!(net >= m.0, "price moved: less than min_out");
        }
        self.settle(&seller);
        let me = env::current_account_id();
        let before = self.token.accounts.get(&seller).unwrap_or(0);
        self.token.internal_transfer(&seller, &me, amount, None);
        self.reset_debt(&seller);
        self.track_holders(&seller, before, before - amount);
        self.add_credit(&seller, net);
        self.distribute(tax);
        self.trades += 1;
        self.record(&seller, false, gross, amount);
        self.emit("trade", &format!(
            "{{\"side\":\"sell\",\"account\":\"{}\",\"tokens_in\":\"{}\",\"tax\":\"{}\",\"pair_out\":\"{}\",\"price\":\"{}\",\"phase\":\"{:?}\"}}",
            seller, amount, tax, net, self.price(), self.phase
        ));
        U128(net)
    }

    // ------------------------------------------------------------------
    // Graduation: open the Rhea pool
    // ------------------------------------------------------------------

    /// Opens the pool on Rhea once the curve has sold out. Anyone may call.
    /// It runs as a sequence of calls to Rhea; if one fails, calling again
    /// resumes from that step. A coin in a token pair needs 0.2 NEAR attached
    /// for the storage Rhea and wrap.near charge; a NEAR coin takes it from the raise.
    #[payable]
    pub fn open_pool(&mut self) -> Promise {
        require!(self.phase == Phase::Graduating, "the curve has not filled");
        let now = env::block_timestamp();
        require!(now >= self.grad.lock_until, "the pool is being opened; try again in a minute");
        let attached = env::attached_deposit().as_yoctonear();
        if self.pair != PairAsset::Near && !self.grad.pool_created {
            require!(attached >= GRAD_COST, "attach 0.2 NEAR for the pool's storage on Rhea");
        }
        self.grad.lock_until = now + LOCK_NS;
        if self.pool_pair == 0 {
            // First attempt: fix what the pool opens with.
            self.pool_pair = self.raised;
            self.pool_tokens = self.token.accounts.get(&env::current_account_id()).unwrap_or(0) - self.tax_tokens;
            let liq = std::mem::take(&mut self.pending_liquidity);
            self.pool_pair += liq;
            self.liquidity_added += liq;
            let bb = std::mem::take(&mut self.pending_buyback);
            if bb > 0 {
                // The buyback happens against the opening pool, before it is seeded.
                let out = mul_div(self.pool_tokens, bb, self.pool_pair + bb);
                if out > 0 && out < self.pool_tokens {
                    self.pool_pair += bb;
                    self.pool_tokens -= out;
                    let me = env::current_account_id();
                    self.token.internal_withdraw(&me, out);
                    self.burned += out;
                    self.buyback_spent += bb;
                    self.emit("burn", &format!("{{\"pair\":\"{}\",\"tokens\":\"{}\"}}", bb, out));
                } else {
                    self.pool_pair += bb;
                    self.liquidity_added += bb;
                }
            }
            if self.pair == PairAsset::Near && attached < GRAD_COST {
                let need = GRAD_COST - attached;
                require!(self.pool_pair > need, "raise");
                self.pool_pair -= need;
            }
            self.last_price = mul_div(self.pool_pair, ONE, self.pool_tokens);
        }
        self.grad_step()
    }

    fn pair_token(&self) -> AccountId {
        match &self.pair {
            PairAsset::Near => wnear(),
            PairAsset::Token { account_id, .. } => account_id.clone(),
        }
    }

    fn grad_step(&mut self) -> Promise {
        let me = env::current_account_id();
        let pair_token = self.pair_token();
        if !self.grad.pool_created {
            let a = Promise::new(dex())
                .function_call("storage_deposit".to_string(), args(near_sdk::serde_json::json!({ "account_id": me, "registration_only": false })), NearToken::from_yoctonear(DEX_STORAGE), GAS_DEX_SMALL)
                .function_call("register_tokens".to_string(), args(near_sdk::serde_json::json!({ "token_ids": [me, pair_token] })), ONE_YOCTO, GAS_DEX_SMALL)
                .function_call("add_simple_pool".to_string(), args(near_sdk::serde_json::json!({ "tokens": [me, pair_token], "fee": DEX_POOL_FEE })), NearToken::from_yoctonear(POOL_STORAGE), GAS_DEX_SMALL);
            // A NEAR coin also wraps the raise.
            let wrap_too = self.pair == PairAsset::Near && !self.grad.wrapped;
            let p = if wrap_too {
                let w = Promise::new(wnear())
                    .function_call("storage_deposit".to_string(), args(near_sdk::serde_json::json!({ "account_id": me, "registration_only": true })), NearToken::from_yoctonear(WNEAR_STORAGE), GAS_DEX_SMALL)
                    .function_call("near_deposit".to_string(), b"{}".to_vec(), NearToken::from_yoctonear(self.pool_pair), GAS_DEX_SMALL);
                a.and(w)
            } else {
                a
            };
            p.then(Self::ext(me).on_pool_created(wrap_too))
        } else if !(self.grad.coin_deposited && self.grad.pair_deposited) {
            let mut p: Option<Promise> = None;
            let coin = !self.grad.coin_deposited;
            let pair = !self.grad.pair_deposited;
            if coin {
                let d = dex();
                if !self.token.accounts.contains_key(&d) {
                    self.token.internal_register_account(&d);
                }
                self.token.internal_transfer(&me, &d, self.pool_tokens, None);
                p = Some(Promise::new(d).function_call("ft_on_transfer".to_string(), args(near_sdk::serde_json::json!({ "sender_id": me, "amount": U128(self.pool_tokens), "msg": "" })), NearToken::from_yoctonear(0), GAS_DEX_DEPOSIT));
            }
            if pair {
                // The exchange must be registered on the pair token first (a
                // refund where it already is); the same batch then deposits.
                let q = Promise::new(pair_token)
                    .function_call("storage_deposit".to_string(), args(near_sdk::serde_json::json!({ "account_id": dex(), "registration_only": true })), NearToken::from_yoctonear(PAIR_REGISTER), GAS_DEX_SMALL)
                    .function_call("ft_transfer_call".to_string(), args(near_sdk::serde_json::json!({ "receiver_id": dex(), "amount": U128(self.pool_pair), "msg": "" })), ONE_YOCTO, GAS_PAIR_DEPOSIT);
                p = Some(match p { Some(x) => x.and(q), None => q });
            }
            p.unwrap().then(Self::ext(me).on_deposited(coin, pair))
        } else {
            Promise::new(dex())
                .function_call("add_liquidity".to_string(), args(near_sdk::serde_json::json!({ "pool_id": self.pool_id.unwrap(), "amounts": [U128(self.pool_tokens), U128(self.pool_pair)], "min_amounts": null })), NearToken::from_yoctonear(LP_STORAGE), GAS_DEX_LIQUIDITY)
                .then(Self::ext(me).on_liquidity_added())
        }
    }

    #[private]
    pub fn on_pool_created(&mut self, wrap_too: bool) -> PromiseOrValue<()> {
        if let Some(id) = result_json::<u64>(0) {
            self.pool_id = Some(id);
            self.grad.pool_created = true;
            self.emit("pool_created", &format!("{{\"pool_id\":{}}}", id));
        }
        if wrap_too && result_ok(1) {
            self.grad.wrapped = true;
        }
        if self.grad.pool_created && (self.pair != PairAsset::Near || self.grad.wrapped) {
            PromiseOrValue::Promise(self.grad_step())
        } else {
            self.grad.lock_until = 0;
            PromiseOrValue::Value(())
        }
    }

    #[private]
    pub fn on_deposited(&mut self, coin: bool, pair: bool) -> PromiseOrValue<()> {
        let mut i = 0;
        if coin {
            if result_ok(i) {
                self.grad.coin_deposited = true;
            } else {
                // Rhea did not take them: back to the coin.
                let me = env::current_account_id();
                self.token.internal_transfer(&dex(), &me, self.pool_tokens, None);
            }
            i += 1;
        }
        if pair {
            let used = result_json::<U128>(i).map(|u| u.0).unwrap_or(0);
            if used > 0 {
                // Whatever Rhea took is what the pool opens with.
                self.pool_pair = used;
                self.grad.pair_deposited = true;
            }
        }
        if self.grad.coin_deposited && self.grad.pair_deposited {
            PromiseOrValue::Promise(self.grad_step())
        } else {
            self.grad.lock_until = 0;
            PromiseOrValue::Value(())
        }
    }

    #[private]
    pub fn on_liquidity_added(&mut self, #[callback_result] r: Result<U128, PromiseError>) {
        self.grad.lock_until = 0;
        if let Ok(shares) = r {
            self.lp_shares = shares.0;
            self.phase = Phase::Pool;
            self.emit("graduated", &format!(
                "{{\"pool_id\":{},\"pool_pair\":\"{}\",\"pool_tokens\":\"{}\",\"price\":\"{}\",\"lp_shares\":\"{}\"}}",
                self.pool_id.unwrap(), self.pool_pair, self.pool_tokens, self.last_price, self.lp_shares
            ));
        }
    }

    // ------------------------------------------------------------------
    // After graduation: harvest the tax taken in tokens
    // ------------------------------------------------------------------

    /// Turns the tax collected since the last harvest into payouts: the burn
    /// share is burned, the rest is sold on Rhea for the pair and divided as
    /// on the curve, and the liquidity share goes into the pool. Anyone may
    /// call; it runs as a sequence and a failed step can be retried.
    pub fn harvest(&mut self) -> Promise {
        require!(self.phase == Phase::Pool, "not graduated");
        let now = env::block_timestamp();
        require!(now >= self.harvest.lock_until, "a harvest is running; try again in a minute");
        if self.harvest.step == 0 {
            require!(self.tax_tokens >= HARVEST_MIN, "not enough tax collected yet");
        }
        self.harvest.lock_until = now + LOCK_NS;
        if self.harvest.step == 0 {
            let t = self.tax_tokens;
            let platform = t * PLATFORM_BPS as u128 / BPS as u128;
            let rest = t - platform;
            let creator = rest * self.split.creator_bps as u128 / BPS as u128;
            let burn = rest * self.split.burn_bps as u128 / BPS as u128;
            let liquidity = rest * self.split.liquidity_bps as u128 / BPS as u128;
            let dividends = rest - creator - burn - liquidity;
            let me = env::current_account_id();
            if burn > 0 {
                self.token.internal_withdraw(&me, burn);
                self.burned += burn;
                self.emit("burn", &format!("{{\"pair\":\"0\",\"tokens\":\"{}\"}}", burn));
            }
            let keep = liquidity / 2;
            let swap = platform + creator + dividends + (liquidity - keep);
            self.tax_tokens -= t;
            self.harvest = HarvestState {
                step: 0,
                total: U128(t),
                platform_tokens: U128(platform),
                creator_tokens: U128(creator),
                dividend_tokens: U128(dividends),
                liquidity_tokens: U128(keep),
                swap_tokens: U128(swap),
                out: U128(0),
                liquidity_pair: U128(0),
                lock_until: self.harvest.lock_until,
            };
            let deposit = swap + keep;
            if deposit == 0 {
                self.harvest_finish();
                return Promise::new(me);
            }
            let d = dex();
            if !self.token.accounts.contains_key(&d) {
                self.token.internal_register_account(&d);
            }
            self.token.internal_transfer(&me, &d, deposit, None);
            return Promise::new(d)
                .function_call("ft_on_transfer".to_string(), args(near_sdk::serde_json::json!({ "sender_id": me, "amount": U128(deposit), "msg": "" })), NearToken::from_yoctonear(0), GAS_DEX_DEPOSIT)
                .then(Self::ext(me).on_harvest_deposited());
        }
        self.harvest_step()
    }

    fn harvest_step(&mut self) -> Promise {
        let me = env::current_account_id();
        let h = self.harvest;
        match h.step {
            1 => Promise::new(dex())
                .function_call("swap".to_string(), args(near_sdk::serde_json::json!({ "actions": [{ "pool_id": self.pool_id.unwrap(), "token_in": me, "amount_in": h.swap_tokens, "token_out": self.pair_token(), "min_amount_out": "0" }], "referral_id": null })), ONE_YOCTO, GAS_DEX_SWAP)
                .then(Self::ext(me).on_harvest_swapped()),
            2 => {
                let take = h.out.0 - h.liquidity_pair.0;
                let mut p = Promise::new(dex());
                if h.liquidity_tokens.0 > 0 && h.liquidity_pair.0 > 0 {
                    p = p.function_call("add_liquidity".to_string(), args(near_sdk::serde_json::json!({ "pool_id": self.pool_id.unwrap(), "amounts": [h.liquidity_tokens, h.liquidity_pair], "min_amounts": null })), NearToken::from_yoctonear(LP_STORAGE), GAS_DEX_LIQUIDITY);
                }
                p.function_call("withdraw".to_string(), args(near_sdk::serde_json::json!({ "token_id": self.pair_token(), "amount": U128(take), "unregister": false, "skip_unwrap_near": true })), ONE_YOCTO, GAS_DEX_WITHDRAW)
                    .then(Self::ext(me).on_harvest_withdrawn())
            }
            3 => {
                let take = h.out.0 - h.liquidity_pair.0;
                Promise::new(wnear())
                    .function_call("near_withdraw".to_string(), args(near_sdk::serde_json::json!({ "amount": U128(take) })), ONE_YOCTO, GAS_DEX_SMALL)
                    .then(Self::ext(me).on_harvest_unwrapped())
            }
            _ => env::panic_str("nothing to do"),
        }
    }

    #[private]
    pub fn on_harvest_deposited(&mut self) -> PromiseOrValue<()> {
        if result_ok(0) {
            self.harvest.step = 1;
            PromiseOrValue::Promise(self.harvest_step())
        } else {
            // Rhea did not take the tokens: they go back to the tax pot.
            let h = self.harvest;
            let deposit = h.swap_tokens.0 + h.liquidity_tokens.0;
            let me = env::current_account_id();
            self.token.internal_transfer(&dex(), &me, deposit, None);
            self.tax_tokens += deposit;
            self.harvest = HarvestState::default();
            PromiseOrValue::Value(())
        }
    }

    #[private]
    pub fn on_harvest_swapped(&mut self, #[callback_result] r: Result<U128, PromiseError>) -> PromiseOrValue<()> {
        match r {
            Ok(out) => {
                let h = self.harvest;
                self.harvest.out = out;
                // The half of the liquidity share that was swapped bought this much of the pair.
                let swapped_for_liquidity = h.swap_tokens.0 - h.platform_tokens.0 - h.creator_tokens.0 - h.dividend_tokens.0;
                self.harvest.liquidity_pair = U128(if h.swap_tokens.0 == 0 { 0 } else { mul_div(out.0, swapped_for_liquidity, h.swap_tokens.0) });
                self.harvest.step = 2;
                PromiseOrValue::Promise(self.harvest_step())
            }
            Err(_) => {
                self.harvest.lock_until = 0;
                PromiseOrValue::Value(())
            }
        }
    }

    #[private]
    pub fn on_harvest_withdrawn(&mut self) -> PromiseOrValue<()> {
        if !result_ok(0) {
            self.harvest.lock_until = 0;
            return PromiseOrValue::Value(());
        }
        if self.harvest.liquidity_pair.0 > 0 {
            self.liquidity_added += self.harvest.liquidity_pair.0;
        }
        if self.pair == PairAsset::Near {
            self.harvest.step = 3;
            PromiseOrValue::Promise(self.harvest_step())
        } else {
            self.harvest_finish();
            PromiseOrValue::Value(())
        }
    }

    #[private]
    pub fn on_harvest_unwrapped(&mut self) {
        if result_ok(0) {
            self.harvest_finish();
        } else {
            self.harvest.lock_until = 0;
        }
    }

    /// The pair is in hand: divide it.
    fn harvest_finish(&mut self) {
        let h = std::mem::take(&mut self.harvest);
        let out = h.out.0;
        let swap = h.swap_tokens.0;
        let (platform, creator, dividends) = if swap == 0 {
            (0, 0, 0)
        } else {
            let platform = mul_div(out, h.platform_tokens.0, swap);
            let creator = mul_div(out, h.creator_tokens.0, swap);
            let dividends = out - platform - creator - h.liquidity_pair.0;
            (platform, creator, dividends)
        };
        if platform > 0 {
            self.platform_fees_total += platform;
            self.pay_platform(platform);
        }
        if creator > 0 {
            let w = self.fee_wallet.clone();
            self.add_credit(&w, creator);
            self.creator_fees_total += creator;
        }
        if dividends > 0 {
            self.pay_dividends(dividends);
        }
        self.emit("harvest", &format!(
            "{{\"tokens\":\"{}\",\"pair\":\"{}\",\"platform\":\"{}\",\"creator\":\"{}\",\"dividends\":\"{}\",\"liquidity\":\"{}\"}}",
            h.total.0, out, platform, creator, dividends, h.liquidity_pair.0
        ));
    }

    // ------------------------------------------------------------------
    // Getting paid
    // ------------------------------------------------------------------

    /// Collect everything the coin owes you, in the pair: settled dividends and credits.
    pub fn claim(&mut self) -> Promise {
        let account = env::predecessor_account_id();
        self.claim_for(account)
    }

    /// Collect on someone's behalf. It is always paid to them, never the caller.
    pub fn claim_for(&mut self, account: AccountId) -> Promise {
        self.settle(&account);
        let amount = self.credits.remove(&account).unwrap_or(0);
        require!(amount > 0, "nothing to claim");
        self.pay_pair(&account, amount).then(
            Self::ext(env::current_account_id())
                .with_static_gas(GAS_CB_SMALL)
                .on_claim(account, U128(amount)),
        )
    }

    /// Pays the platform any share that could not be delivered on the spot
    /// (a pair-token transfer that failed). Only the factory calls, and it is
    /// paid to the treasury on record. On a NEAR coin there is never anything here.
    pub fn claim_platform(&mut self) -> Promise {
        require!(env::predecessor_account_id() == self.factory, "factory only");
        let amount = std::mem::take(&mut self.platform_credit);
        require!(amount > 0, "nothing to claim");
        let treasury = self.treasury.clone();
        self.pay_pair(&treasury, amount).then(
            Self::ext(env::current_account_id())
                .with_static_gas(GAS_CB_SMALL)
                .on_claim_platform(U128(amount)),
        )
    }

    #[private]
    pub fn on_claim(&mut self, account: AccountId, amount: U128, #[callback_result] r: Result<(), PromiseError>) {
        if r.is_err() {
            // The account could not be paid (not registered on the pair token,
            // for instance); the credit is still theirs.
            self.add_credit(&account, amount.0);
        } else {
            self.emit("claim", &format!("{{\"account\":\"{}\",\"amount\":\"{}\"}}", account, amount.0));
        }
    }

    #[private]
    pub fn on_claim_platform(&mut self, amount: U128, #[callback_result] r: Result<(), PromiseError>) {
        if r.is_err() {
            self.platform_credit += amount.0;
        }
    }

    // ------------------------------------------------------------------
    // Admin: only the factory, whose owner is the platform. None of these can
    // touch balances, the supply, the tax rates or the split.
    // ------------------------------------------------------------------

    /// Re-points future creator fees, for a community takeover. Fees already
    /// credited stay with the old wallet.
    pub fn set_fee_wallet(&mut self, fee_wallet: AccountId, reason: Option<String>) {
        self.assert_factory();
        require!(
            fee_wallet != env::current_account_id()
                && fee_wallet != self.factory
                && fee_wallet != self.treasury
                && fee_wallet != self.fee_wallet
                && fee_wallet != dex(),
            "fee wallet cannot be the coin, the factory, the treasury, the exchange or the current wallet"
        );
        let old = std::mem::replace(&mut self.fee_wallet, fee_wallet);
        self.emit("fee_wallet_changed", &format!(
            "{{\"old\":\"{}\",\"new\":\"{}\",\"reason\":\"{}\"}}",
            old, self.fee_wallet, reason.unwrap_or_default().replace('"', "'")
        ));
    }

    /// Where the platform's share is paid from now on.
    pub fn set_treasury(&mut self, treasury: AccountId) {
        self.assert_factory();
        self.treasury = treasury;
    }

    /// Fixes the picture, description or links. Name and ticker never change.
    pub fn set_metadata(&mut self, icon: Option<String>, description: Option<String>, links: Option<Links>) {
        self.assert_factory();
        if let Some(i) = icon { self.icon = Some(i); }
        if let Some(d) = description {
            require!(d.chars().count() <= 280, "description: up to 280 characters");
            self.description = d;
        }
        if let Some(l) = links { self.links = l; }
        self.emit("metadata_changed", "{}");
    }

    /// Moves `bps` of the coin's Rhea LP shares to `to`, who can then remove
    /// the liquidity on Rhea. Only the factory (the platform), only once the
    /// pool is open. Attach 0.01 NEAR in case `to` is not yet registered on
    /// the pool. Not reversible.
    #[payable]
    pub fn collect_liquidity(&mut self, bps: u32, to: AccountId) -> Promise {
        self.assert_factory();
        require!(self.phase == Phase::Pool, "the pool is not open");
        require!(bps > 0 && bps <= BPS, "bps: 1 to 10000");
        require!(to != env::current_account_id() && to != dex(), "to");
        let me = env::current_account_id();
        let tid = format!(":{}", self.pool_id.unwrap());
        let p1 = Promise::new(dex()).function_call("mft_balance_of".to_string(), args(near_sdk::serde_json::json!({ "token_id": tid, "account_id": me })), NearToken::from_yoctonear(0), GAS_DEX_SMALL);
        let p2 = Promise::new(dex()).function_call("mft_has_registered".to_string(), args(near_sdk::serde_json::json!({ "token_id": tid, "account_id": to })), NearToken::from_yoctonear(0), GAS_DEX_SMALL);
        p1.and(p2).then(Self::ext(me).on_lp_checked(bps, to))
    }

    #[private]
    pub fn on_lp_checked(&mut self, bps: u32, to: AccountId) -> Promise {
        let balance = result_json::<U128>(0).map(|b| b.0).unwrap_or_else(|| env::panic_str("could not read the LP balance"));
        let registered = result_json::<bool>(1).unwrap_or(false);
        let shares = balance * bps as u128 / BPS as u128;
        require!(shares > 0, "nothing to collect");
        let tid = format!(":{}", self.pool_id.unwrap());
        let mut p = Promise::new(dex());
        if !registered {
            p = p.function_call("mft_register".to_string(), args(near_sdk::serde_json::json!({ "token_id": tid, "account_id": to })), NearToken::from_yoctonear(LP_REGISTER), GAS_DEX_SMALL);
        }
        p.function_call("mft_transfer".to_string(), args(near_sdk::serde_json::json!({ "token_id": tid, "receiver_id": to, "amount": U128(shares), "memo": null })), ONE_YOCTO, GAS_DEX_SMALL)
            .then(Self::ext(env::current_account_id()).on_lp_transferred(to, U128(shares), bps))
    }

    #[private]
    pub fn on_lp_transferred(&mut self, to: AccountId, shares: U128, bps: u32) {
        if result_ok(0) {
            self.lp_collected += shares.0;
            self.emit("liquidity_collected", &format!("{{\"to\":\"{}\",\"bps\":{},\"shares\":\"{}\"}}", to, bps, shares.0));
        } else {
            env::panic_str("the LP transfer failed");
        }
    }

    /// Pulls `bps` of what the curve holds, the pair raised so far and the
    /// tokens not yet sold, out to `to`. Only the factory (the platform), only
    /// while the coin is on the curve. The curve carries on with what is left,
    /// so the price falls with the pair taken. Not reversible.
    pub fn collect_curve(&mut self, bps: u32, to: AccountId) -> Promise {
        self.assert_factory();
        require!(self.phase == Phase::Curve, "the curve is closed");
        require!(bps > 0 && bps <= BPS, "bps: 1 to 10000");
        let me = env::current_account_id();
        require!(to != me && to != dex(), "to");
        let pair_out = self.raised * bps as u128 / BPS as u128;
        let held = self.token.accounts.get(&me).unwrap_or(0) - self.tax_tokens;
        let tokens_out = held * bps as u128 / BPS as u128;
        require!(pair_out > 0 || tokens_out > 0, "nothing to collect");
        self.raised -= pair_out;
        if tokens_out > 0 {
            if !self.token.accounts.contains_key(&to) {
                self.token.internal_register_account(&to);
            }
            self.settle(&to);
            let before = self.token.accounts.get(&to).unwrap_or(0);
            self.token.internal_transfer(&me, &to, tokens_out, None);
            self.reset_debt(&to);
            self.track_holders(&to, before, before + tokens_out);
        }
        self.emit("curve_collected", &format!(
            "{{\"to\":\"{}\",\"bps\":{},\"pair\":\"{}\",\"tokens\":\"{}\",\"price\":\"{}\"}}",
            to, bps, pair_out, tokens_out, self.price()
        ));
        if pair_out > 0 {
            self.pay_pair(&to, pair_out).then(
                Self::ext(me).with_static_gas(GAS_CB_SMALL).on_curve_collected(U128(pair_out)),
            )
        } else {
            Promise::new(to)
        }
    }

    #[private]
    pub fn on_curve_collected(&mut self, amount: U128, #[callback_result] r: Result<(), PromiseError>) {
        if r.is_err() {
            // The pair could not be delivered: it stays in the curve.
            self.raised += amount.0;
        }
    }

    fn assert_factory(&self) {
        require!(env::predecessor_account_id() == self.factory, "factory only");
    }

    fn assert_curve(&self) {
        match self.phase {
            Phase::Curve => {}
            Phase::Graduating => env::panic_str("the pool is opening; call open_pool"),
            Phase::Pool => env::panic_str("graduated: trade on Rhea"),
        }
    }

    // ------------------------------------------------------------------
    // Views
    // ------------------------------------------------------------------

    pub fn get_info(&self) -> Info {
        Info {
            factory: self.factory.clone(),
            treasury: self.treasury.clone(),
            name: self.name.clone(),
            symbol: self.symbol.clone(),
            icon: self.icon.clone(),
            description: self.description.clone(),
            links: self.links.clone(),
            creator: self.creator.clone(),
            fee_wallet: self.fee_wallet.clone(),
            created_at_ms: self.created_at_ms,
            pair: self.pair.clone(),
            virtual_reserve: U128(self.virtual_reserve),
            buy_tax_bps: self.buy_tax_bps,
            sell_tax_bps: self.sell_tax_bps,
            split: self.split,
            phase: self.phase,
            total_supply: U128(self.token.total_supply),
            tokens_sold: U128(self.tokens_sold),
            raised: U128(self.raised),
            pool_pair: U128(self.pool_pair),
            pool_tokens: U128(self.pool_tokens),
            price: U128(self.price()),
            market_cap: U128(mul_div(self.price(), self.token.total_supply, ONE)),
            graduation: U128(self.graduation()),
            curve_supply: U128(CURVE_SUPPLY),
            burned: U128(self.burned),
            buyback_spent: U128(self.buyback_spent),
            liquidity_added: U128(self.liquidity_added),
            dividends_total: U128(self.dividends_total),
            creator_fees_total: U128(self.creator_fees_total),
            platform_fees_total: U128(self.platform_fees_total),
            pending_buyback: U128(self.pending_buyback),
            pending_liquidity: U128(self.pending_liquidity),
            platform_credit: U128(self.platform_credit),
            trades: self.trades,
            holders: self.holders,
            dex: dex(),
            pool_id: self.pool_id,
            lp_shares: U128(self.lp_shares),
            lp_collected: U128(self.lp_collected),
            tax_tokens: U128(self.tax_tokens),
            grad: self.grad,
            harvest: self.harvest,
        }
    }

    pub fn get_holder(&self, account_id: AccountId) -> Holder {
        let balance = self.token.accounts.get(&account_id).unwrap_or(0);
        Holder {
            balance: U128(balance),
            claimable_dividends: U128(self.pending_dividends(&account_id, balance)),
            credit: U128(self.credits.get(&account_id).copied().unwrap_or(0)),
        }
    }

    /// Five-minute candles, oldest first. `from_t` skips buckets before it.
    pub fn get_candles(&self, from_t: Option<u64>, limit: Option<u32>) -> Vec<Candle> {
        let limit = limit.unwrap_or(MAX_CANDLES).min(MAX_CANDLES) as usize;
        let n = self.candles.len();
        let mut out = Vec::new();
        for i in 0..n {
            let idx = (self.candles_start + i) % n;
            let c = self.candles[idx];
            if from_t.map_or(true, |f| c.t >= f) {
                out.push(c);
                if out.len() >= limit { break; }
            }
        }
        out
    }

    /// The most recent trades, newest first.
    pub fn get_trades(&self, limit: Option<u32>) -> Vec<Trade> {
        let limit = limit.unwrap_or(50).min(MAX_TRADES) as usize;
        let n = self.recent.len();
        let mut out = Vec::new();
        for i in 0..n.min(limit as u32) {
            let idx = (self.recent_next + n - 1 - i) % n;
            out.push(self.recent[idx].clone());
        }
        out
    }

    /// Tokens for a pair amount, after tax, on the curve. For quotes. Zero once graduated: quote Rhea.
    pub fn quote_buy(&self, pair_in: U128) -> U128 {
        if self.phase != Phase::Curve { return U128(0); }
        let tax = pair_in.0 * self.buy_tax_bps as u128 / BPS as u128;
        let net = pair_in.0 - tax;
        let (x, y) = self.curve_reserves();
        let out = mul_div(y, net, x + net);
        U128(out.min(CURVE_SUPPLY - self.tokens_sold))
    }

    /// Pair units for a token amount, after tax, on the curve. For quotes.
    pub fn quote_sell(&self, tokens_in: U128) -> U128 {
        if self.phase != Phase::Curve || tokens_in.0 > self.tokens_sold { return U128(0); }
        let (x, y) = self.curve_reserves();
        let gross = mul_div(x, tokens_in.0, y + tokens_in.0);
        U128(gross - gross * self.sell_tax_bps as u128 / BPS as u128)
    }

    // ------------------------------------------------------------------
    // Internals
    // ------------------------------------------------------------------

    /// The shared buy path: `amount` of the pair is already in the coin's hands.
    fn execute_buy(&mut self, buyer: &AccountId, amount: u128, min_out: Option<u128>) -> u128 {
        self.assert_curve();
        require!(self.token.accounts.contains_key(buyer), "register storage first");
        require!(!self.is_exempt(buyer), "buyer");
        let tax = amount * self.buy_tax_bps as u128 / BPS as u128;
        let net = amount - tax;
        let (out, refund) = self.curve_buy(net);
        require!(out > 0, "too small");
        if let Some(m) = min_out {
            require!(out >= m, "price moved: fewer tokens than min_out");
        }
        self.settle(buyer);
        let me = env::current_account_id();
        let before = self.token.accounts.get(buyer).unwrap_or(0);
        self.token.internal_transfer(&me, buyer, out, None);
        self.reset_debt(buyer);
        self.track_holders(buyer, before, before + out);
        if refund > 0 {
            self.add_credit(buyer, refund);
        }
        self.distribute(tax);
        self.trades += 1;
        self.record(buyer, true, net, out);
        self.emit("trade", &format!(
            "{{\"side\":\"buy\",\"account\":\"{}\",\"pair_in\":\"{}\",\"tax\":\"{}\",\"tokens_out\":\"{}\",\"price\":\"{}\",\"phase\":\"{:?}\"}}",
            buyer, amount, tax, out, self.price(), self.phase
        ));
        if self.tokens_sold >= CURVE_SUPPLY {
            self.phase = Phase::Graduating;
            self.emit("curve_filled", "{}");
        }
        out
    }

    fn graduation(&self) -> u128 {
        2 * self.virtual_reserve
    }

    fn curve_reserves(&self) -> (u128, u128) {
        (self.virtual_reserve + self.raised, VIRTUAL_TOKENS - self.tokens_sold)
    }

    /// Returns (tokens out, pair refunded when the buy overshoots the curve).
    fn curve_buy(&mut self, net: u128) -> (u128, u128) {
        let (x, y) = self.curve_reserves();
        let remaining = CURVE_SUPPLY - self.tokens_sold;
        let out = mul_div(y, net, x + net);
        if out < remaining {
            self.tokens_sold += out;
            self.raised += net;
            (out, 0)
        } else {
            // Fill the curve exactly: by construction the curve raises exactly
            // its graduation amount when the last token sells, so the buyer
            // pays whatever is still missing and the rest comes back as a credit.
            let needed = self.graduation().saturating_sub(self.raised).min(net);
            self.tokens_sold = CURVE_SUPPLY;
            self.raised += needed;
            (remaining, net - needed)
        }
    }

    fn curve_sell(&mut self, amount: u128) -> u128 {
        require!(amount <= self.tokens_sold, "more than the curve has sold");
        let (x, y) = self.curve_reserves();
        let gross = mul_div(x, amount, y + amount);
        self.tokens_sold -= amount;
        self.raised -= gross;
        gross
    }

    /// Pair units per whole token.
    fn price(&self) -> u128 {
        match self.phase {
            Phase::Curve => {
                let (x, y) = self.curve_reserves();
                mul_div(x, ONE, y)
            }
            Phase::Graduating | Phase::Pool => {
                if self.last_price > 0 { self.last_price } else {
                    let (x, y) = self.curve_reserves();
                    mul_div(x, ONE, y)
                }
            }
        }
    }

    /// Divides a curve tax: 20% platform, the rest by the creator's split.
    fn distribute(&mut self, total: u128) {
        if total == 0 { return; }
        let platform = total * PLATFORM_BPS as u128 / BPS as u128;
        let rest = total - platform;
        self.platform_fees_total += platform;
        self.pay_platform(platform);
        let creator = rest * self.split.creator_bps as u128 / BPS as u128;
        let dividends = rest * self.split.dividends_bps as u128 / BPS as u128;
        let burn = rest * self.split.burn_bps as u128 / BPS as u128;
        let liquidity = rest * self.split.liquidity_bps as u128 / BPS as u128;
        if creator > 0 {
            let w = self.fee_wallet.clone();
            self.add_credit(&w, creator);
            self.creator_fees_total += creator;
        }
        if dividends > 0 {
            self.pay_dividends(dividends);
        }
        // Buyback and liquidity wait for the pool to open.
        self.pending_buyback += burn;
        self.pending_liquidity += liquidity;
        // Rounding dust stays in the contract.
    }

    /// Tokens that earn dividends: everything not held by the coin or the pool.
    fn eligible_supply(&self) -> u128 {
        self.token.total_supply
            - self.token.accounts.get(&env::current_account_id()).unwrap_or(0)
            - self.token.accounts.get(&dex()).unwrap_or(0)
    }

    /// The platform's share goes straight to the treasury. A NEAR transfer to
    /// an existing account cannot fail; a pair-token transfer can (the
    /// treasury may not be registered on it), and then the amount is held as
    /// a credit the factory can collect later.
    fn pay_platform(&mut self, amount: u128) {
        if amount == 0 { return; }
        match &self.pair {
            PairAsset::Near => {
                let _p = Promise::new(self.treasury.clone()).transfer(NearToken::from_yoctonear(amount));
            }
            PairAsset::Token { account_id, .. } => {
                let _p = ext_ft::ext(account_id.clone())
                    .with_attached_deposit(ONE_YOCTO)
                    .with_static_gas(GAS_FT_TRANSFER)
                    .ft_transfer(self.treasury.clone(), U128(amount), None)
                    .then(
                        Self::ext(env::current_account_id())
                            .with_static_gas(GAS_CB_SMALL)
                            .on_claim_platform(U128(amount)),
                    );
            }
        }
    }

    fn pay_dividends(&mut self, amount: u128) {
        let eligible = self.eligible_supply();
        if eligible == 0 {
            // Nobody holds yet: it goes to the platform rather than nowhere.
            self.platform_fees_total += amount;
            self.pay_platform(amount);
            return;
        }
        self.acc_per_token += mul_div(amount, ACC_SCALE, eligible);
        self.dividends_total += amount;
    }

    /// The coin itself and the pool never earn dividends or pay tax.
    fn is_exempt(&self, account: &AccountId) -> bool {
        account == &env::current_account_id() || account.as_str() == DEX
    }

    fn pending_dividends(&self, account: &AccountId, balance: u128) -> u128 {
        if balance == 0 || self.is_exempt(account) { return 0; }
        let accrued = mul_div(balance, self.acc_per_token, ACC_SCALE);
        accrued.saturating_sub(self.reward_debt.get(account).copied().unwrap_or(0))
    }

    /// Moves an account's dividends earned so far into its credit. Call before
    /// any change to its balance.
    fn settle(&mut self, account: &AccountId) {
        if self.is_exempt(account) { return; }
        let balance = self.token.accounts.get(account).unwrap_or(0);
        let owed = self.pending_dividends(account, balance);
        if owed > 0 {
            self.add_credit(account, owed);
        }
        self.reward_debt.insert(account.clone(), mul_div(balance, self.acc_per_token, ACC_SCALE));
    }

    /// After a balance change: debt matches the new balance.
    fn reset_debt(&mut self, account: &AccountId) {
        if self.is_exempt(account) { return; }
        let balance = self.token.accounts.get(account).unwrap_or(0);
        self.reward_debt.insert(account.clone(), mul_div(balance, self.acc_per_token, ACC_SCALE));
    }

    fn add_credit(&mut self, account: &AccountId, amount: u128) {
        let cur = self.credits.get(account).copied().unwrap_or(0);
        self.credits.insert(account.clone(), cur + amount);
    }

    /// Sends pair units to an account: a NEAR transfer, or ft_transfer on the pair token.
    fn pay_pair(&self, to: &AccountId, amount: u128) -> Promise {
        match &self.pair {
            PairAsset::Near => Promise::new(to.clone()).transfer(NearToken::from_yoctonear(amount)),
            PairAsset::Token { account_id, .. } => ext_ft::ext(account_id.clone())
                .with_attached_deposit(ONE_YOCTO)
                .with_static_gas(GAS_FT_TRANSFER)
                .ft_transfer(to.clone(), U128(amount), None),
        }
    }

    /// Adds a trade to the candles and the recent list. Ring buffers, capped.
    fn record(&mut self, account: &AccountId, buy: bool, pair: u128, tokens: u128) {
        let now = env::block_timestamp_ms();
        let price = self.price();
        let bucket = now - now % CANDLE_MS;
        let n = self.candles.len();
        let last = if n == 0 { None } else { Some((self.candles_start + n - 1) % n) };
        match last {
            Some(i) if self.candles[i].t == bucket => {
                let c = &mut self.candles[i];
                if price > c.h.0 { c.h = U128(price); }
                if price < c.l.0 { c.l = U128(price); }
                c.c = U128(price);
                c.v = U128(c.v.0 + pair);
            }
            _ => {
                let open = last.map(|i| self.candles[i].c.0).unwrap_or(price);
                let candle = Candle { t: bucket, o: U128(open), h: U128(price.max(open)), l: U128(price.min(open)), c: U128(price), v: U128(pair) };
                if n < MAX_CANDLES {
                    self.candles.push(candle);
                } else {
                    self.candles[self.candles_start] = candle;
                    self.candles_start = (self.candles_start + 1) % n;
                }
            }
        }
        let trade = Trade { t: now, account: account.clone(), buy, pair: U128(pair), tokens: U128(tokens), price: U128(price) };
        if self.recent.len() < MAX_TRADES {
            self.recent.push(trade);
        } else {
            self.recent[self.recent_next] = trade;
        }
        self.recent_next = (self.recent_next + 1) % MAX_TRADES;
    }

    fn pair_label(&self) -> String {
        match &self.pair {
            PairAsset::Near => "NEAR".to_string(),
            PairAsset::Token { symbol, .. } => symbol.clone(),
        }
    }

    fn track_holders(&mut self, account: &AccountId, before: u128, after: u128) {
        if self.is_exempt(account) { return; }
        if before == 0 && after > 0 { self.holders += 1; }
        if before > 0 && after == 0 { self.holders = self.holders.saturating_sub(1); }
    }

    /// The tax a transfer pays once graduated: a transfer into the exchange
    /// is a sell, one out of it is a buy. The coin, the platform and the
    /// factory never pay it.
    fn transfer_tax_bps(&self, sender: &AccountId, receiver: &AccountId) -> u32 {
        if self.phase != Phase::Pool { return 0; }
        let free = |a: &AccountId| a == &env::current_account_id() || a == &self.treasury || a == &self.factory;
        if receiver.as_str() == DEX && !free(sender) {
            self.sell_tax_bps
        } else if sender.as_str() == DEX && !free(receiver) {
            self.buy_tax_bps
        } else {
            0
        }
    }

    /// Moves `amount` from `sender` to `receiver` with the tax, if any, kept
    /// by the coin. Returns what the receiver got.
    fn taxed_transfer(&mut self, sender: &AccountId, receiver: &AccountId, amount: u128, memo: Option<String>) -> (u128, u128) {
        let bps = self.transfer_tax_bps(sender, receiver);
        let tax = amount * bps as u128 / BPS as u128;
        let net = amount - tax;
        self.settle(sender);
        self.settle(receiver);
        let sb = self.token.accounts.get(sender).unwrap_or(0);
        let rb = self.token.accounts.get(receiver).unwrap_or(0);
        self.token.internal_transfer(sender, receiver, net, memo);
        if tax > 0 {
            let me = env::current_account_id();
            self.token.internal_transfer(sender, &me, tax, Some("tax".to_string()));
            self.tax_tokens += tax;
            self.trades += 1;
            self.emit("tax", &format!(
                "{{\"side\":\"{}\",\"account\":\"{}\",\"tokens\":\"{}\",\"tax\":\"{}\"}}",
                if receiver.as_str() == DEX { "sell" } else { "buy" },
                if receiver.as_str() == DEX { sender } else { receiver }, amount, tax
            ));
        }
        self.reset_debt(sender);
        self.reset_debt(receiver);
        self.track_holders(sender, sb, sb - amount);
        self.track_holders(receiver, rb, rb + net);
        (net, tax)
    }

    fn emit(&self, event: &str, data: &str) {
        log!("EVENT_JSON:{{\"standard\":\"launchpad\",\"version\":\"1.0.0\",\"event\":\"{}\",\"data\":{}}}", event, data);
    }

    /// Resolves a taxed `ft_transfer_call`: what the exchange did not use goes
    /// back to the sender, with the matching part of the tax.
    #[private]
    #[allow(deprecated)]
    pub fn ft_resolve_taxed(&mut self, sender_id: AccountId, receiver_id: AccountId, net: U128, tax: U128) -> U128 {
        let unused = match env::promise_result(0) {
            PromiseResult::Successful(v) => near_sdk::serde_json::from_slice::<U128>(&v).map(|u| u.0.min(net.0)).unwrap_or(net.0),
            _ => net.0,
        };
        if unused == 0 { return net; }
        self.settle(&sender_id);
        self.settle(&receiver_id);
        let rb = self.token.accounts.get(&receiver_id).unwrap_or(0);
        let refund = unused.min(rb);
        let sb = self.token.accounts.get(&sender_id).unwrap_or(0);
        if refund > 0 {
            self.token.internal_transfer(&receiver_id, &sender_id, refund, Some("refund".to_string()));
        }
        let tax_back = if net.0 == 0 { 0 } else { mul_div(tax.0, refund, net.0) }.min(self.tax_tokens);
        if tax_back > 0 {
            let me = env::current_account_id();
            self.token.internal_transfer(&me, &sender_id, tax_back, Some("tax refund".to_string()));
            self.tax_tokens -= tax_back;
        }
        self.reset_debt(&sender_id);
        self.reset_debt(&receiver_id);
        self.track_holders(&sender_id, sb, sb + refund + tax_back);
        self.track_holders(&receiver_id, rb, rb - refund);
        U128(net.0 - refund)
    }
}

// ----------------------------------------------------------------------
// Paying in a NEP-141 pair: the pair token calls this on `ft_transfer_call`.
// ----------------------------------------------------------------------

#[near]
impl FungibleTokenReceiver for Contract {
    fn ft_on_transfer(&mut self, sender_id: AccountId, amount: U128, msg: String) -> PromiseOrValue<U128> {
        let pair = match &self.pair {
            PairAsset::Token { account_id, .. } => account_id.clone(),
            PairAsset::Near => env::panic_str("this coin is paid in NEAR: call buy"),
        };
        require!(env::predecessor_account_id() == pair, "only the pair token");
        let m: BuyMsg = if msg.trim().is_empty() {
            BuyMsg { min_out: None }
        } else {
            near_sdk::serde_json::from_str(&msg).unwrap_or_else(|_| env::panic_str("msg: {\"min_out\":\"...\"}"))
        };
        self.execute_buy(&sender_id, amount.0, m.min_out.map(|x| x.0));
        // Everything sent was used; an overshoot past the curve is a credit.
        PromiseOrValue::Value(U128(0))
    }
}

// ----------------------------------------------------------------------
// NEP-141 with dividend settlement around every balance change, and the
// tax on transfers to and from the exchange once graduated.
// ----------------------------------------------------------------------

#[near]
impl FungibleTokenCore for Contract {
    #[payable]
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>) {
        assert_one_yocto();
        let sender = env::predecessor_account_id();
        require!(receiver_id != env::current_account_id(), "use sell to trade with the coin");
        require!(amount.0 > 0, "amount");
        self.taxed_transfer(&sender, &receiver_id, amount.0, memo);
    }

    #[payable]
    fn ft_transfer_call(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>, msg: String) -> PromiseOrValue<U128> {
        assert_one_yocto();
        let sender = env::predecessor_account_id();
        require!(receiver_id != env::current_account_id(), "use sell to trade with the coin");
        require!(amount.0 > 0, "amount");
        require!(env::prepaid_gas() > GAS_FT_TRANSFER_CALL, "more gas is required");
        let (net, tax) = self.taxed_transfer(&sender, &receiver_id, amount.0, memo);
        let receiver_gas = env::prepaid_gas().saturating_sub(GAS_FT_TRANSFER_CALL);
        ext_ft_receiver::ext(receiver_id.clone())
            .with_static_gas(receiver_gas)
            .ft_on_transfer(sender.clone(), U128(net), msg)
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_CB_SMALL)
                    .ft_resolve_taxed(sender, receiver_id, U128(net), U128(tax)),
            )
            .into()
    }

    fn ft_total_supply(&self) -> U128 {
        self.token.ft_total_supply()
    }

    fn ft_balance_of(&self, account_id: AccountId) -> U128 {
        self.token.ft_balance_of(account_id)
    }
}

#[near]
impl FungibleTokenResolver for Contract {
    /// Kept for the standard's interface; every transfer-call resolves through `ft_resolve_taxed`.
    #[private]
    fn ft_resolve_transfer(&mut self, sender_id: AccountId, receiver_id: AccountId, amount: U128) -> U128 {
        self.ft_resolve_taxed(sender_id, receiver_id, amount, U128(0))
    }
}

/// Storage: every holder locks MIN_STORAGE for their entries and gets it back
/// when they unregister. There is nothing to withdraw in between.
#[near]
impl StorageManagement for Contract {
    #[payable]
    fn storage_deposit(&mut self, account_id: Option<AccountId>, registration_only: Option<bool>) -> StorageBalance {
        let _ = registration_only;
        let account = account_id.unwrap_or_else(env::predecessor_account_id);
        let amount = env::attached_deposit().as_yoctonear();
        let refund = if self.token.accounts.contains_key(&account) {
            amount
        } else {
            require!(amount >= MIN_STORAGE, "attach at least the storage cost");
            self.token.internal_register_account(&account);
            amount - MIN_STORAGE
        };
        if refund > 0 {
            let _p = Promise::new(env::predecessor_account_id()).transfer(NearToken::from_yoctonear(refund));
        }
        StorageBalance { total: NearToken::from_yoctonear(MIN_STORAGE), available: NearToken::from_yoctonear(0) }
    }

    #[payable]
    fn storage_withdraw(&mut self, amount: Option<NearToken>) -> StorageBalance {
        assert_one_yocto();
        let account = env::predecessor_account_id();
        require!(self.token.accounts.contains_key(&account), "not registered");
        require!(amount.map_or(true, |a| a.is_zero()), "nothing to withdraw: unregister to get the storage back");
        StorageBalance { total: NearToken::from_yoctonear(MIN_STORAGE), available: NearToken::from_yoctonear(0) }
    }

    #[payable]
    fn storage_unregister(&mut self, force: Option<bool>) -> bool {
        assert_one_yocto();
        let account = env::predecessor_account_id();
        require!(!self.is_exempt(&account), "account");
        let Some(balance) = self.token.accounts.get(&account) else { return false };
        self.settle(&account);
        let credit = self.credits.get(&account).copied().unwrap_or(0);
        if balance > 0 || credit > 0 {
            require!(force == Some(true), "the account holds tokens or a credit; sell and claim first, or force");
            if balance > 0 {
                self.token.internal_withdraw(&account, balance);
            }
        }
        self.token.accounts.remove(&account);
        self.reward_debt.remove(&account);
        self.credits.remove(&account);
        self.track_holders(&account, balance, 0);
        let _p = Promise::new(account).transfer(NearToken::from_yoctonear(MIN_STORAGE));
        true
    }

    fn storage_balance_bounds(&self) -> StorageBalanceBounds {
        StorageBalanceBounds { min: NearToken::from_yoctonear(MIN_STORAGE), max: Some(NearToken::from_yoctonear(MIN_STORAGE)) }
    }

    fn storage_balance_of(&self, account_id: AccountId) -> Option<StorageBalance> {
        if self.token.accounts.contains_key(&account_id) {
            Some(StorageBalance { total: NearToken::from_yoctonear(MIN_STORAGE), available: NearToken::from_yoctonear(0) })
        } else {
            None
        }
    }
}

#[near]
impl FungibleTokenMetadataProvider for Contract {
    fn ft_metadata(&self) -> FungibleTokenMetadata {
        FungibleTokenMetadata {
            spec: FT_METADATA_SPEC.to_string(),
            name: self.name.clone(),
            symbol: self.symbol.clone(),
            icon: self.icon.clone(),
            reference: None,
            reference_hash: None,
            decimals: DECIMALS,
        }
    }
}

#[cfg(test)]
mod tests;
