//! One launched coin. The token, its bonding curve, the pool it graduates into,
//! its tax and its holder dividends live in this one account.
//!
//! The coin has a pair, fixed at launch: native NEAR or any NEP-141 token (a
//! bridged Ondo stock, for instance). People pay in the pair, the curve and the
//! pool hold the pair, and every payout is in the pair.
//!
//! Numbers, all fixed at launch and never changed:
//! - 1,000,000,000 tokens minted once. 750,000,000 sell on the curve, the other
//!   250,000,000 open the pool.
//! - The curve is a constant product over a virtual reserve of the pair (1,000
//!   NEAR on a NEAR coin, about that much worth on other pairs) and
//!   1,125,000,000 tokens: the last token costs nine times the first, and the
//!   curve raises exactly twice the virtual reserve.
//! - The pool opens at the last curve price with everything the curve raised
//!   and the 250,000,000 tokens held back. The coin owns the position; nobody
//!   can pull it.
//! - Every trade pays the creator's tax (1% to 10% a side, in the pair). The
//!   platform keeps 20% of it; the creator's four shares divide the other 80%:
//!   creator, holder dividends, buyback and burn, liquidity. After graduation a
//!   1% pool fee is divided the same way.
//! - Everything the coin owes anyone is a credit inside the contract until it
//!   is claimed. Nothing is ever pushed.

use near_contract_standards::fungible_token::core::FungibleTokenCore;
use near_contract_standards::fungible_token::metadata::{
    FungibleTokenMetadata, FungibleTokenMetadataProvider, FT_METADATA_SPEC,
};
use near_contract_standards::fungible_token::receiver::FungibleTokenReceiver;
use near_contract_standards::fungible_token::resolver::FungibleTokenResolver;
use near_contract_standards::fungible_token::FungibleToken;
use near_contract_standards::storage_management::{
    StorageBalance, StorageBalanceBounds, StorageManagement,
};
use near_sdk::json_types::U128;
use near_sdk::store::LookupMap;
use near_sdk::{
    env, ext_contract, log, near, require, AccountId, BorshStorageKey, Gas, NearToken,
    PanicOnDefault, Promise, PromiseError, PromiseOrValue,
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
/// Held back to open the pool.
pub const POOL_SUPPLY: u128 = TOTAL_SUPPLY - CURVE_SUPPLY;
/// Virtual token reserve the curve starts from. The pair side is per coin.
pub const VIRTUAL_TOKENS: u128 = 1_125_000_000 * ONE;

pub const BPS: u32 = 10_000;
/// The platform's share of every tax and pool fee, fixed for every coin.
pub const PLATFORM_BPS: u32 = 2_000;
/// Pool fee once graduated, on the pair side of every trade.
pub const POOL_FEE_BPS: u32 = 100;
pub const MIN_TAX_BPS: u32 = 100;
pub const MAX_TAX_BPS: u32 = 1_000;

/// Scale for accumulated dividends per token.
const ACC_SCALE: u128 = 1_000_000_000_000_000_000;

const GAS_FOR_CLAIM_CALLBACK: Gas = Gas::from_tgas(5);
const GAS_FOR_FT_TRANSFER: Gas = Gas::from_tgas(10);
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
/// A week of five-minute candles.
pub const MAX_CANDLES: u32 = 2016;
pub const MAX_TRADES: u32 = 200;

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
    /// The curve sold out; the pool has not been opened yet. Anyone may open it.
    Graduating,
    /// Trading on the pool.
    Pool,
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
    pub pool_pair: U128,
    pub pool_tokens: U128,
    /// Pair units per whole token (1e18 units).
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
}

fn mul_div(a: u128, b: u128, c: u128) -> u128 {
    (U256::from(a) * U256::from(b) / U256::from(c)).as_u128()
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
            require!(account_id != &env::current_account_id(), "pair");
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
            fee_wallet != env::current_account_id() && fee_wallet != factory,
            "fee wallet cannot be the coin or the factory"
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
        };
        this.emit("launch", &format!(
            "{{\"creator\":\"{}\",\"fee_wallet\":\"{}\",\"pair\":\"{}\",\"buy_tax_bps\":{},\"sell_tax_bps\":{}}}",
            this.creator, this.fee_wallet, this.pair_label(), buy_tax_bps, sell_tax_bps
        ));
        this
    }

    // ------------------------------------------------------------------
    // Trading
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
            let cost = self.token.storage_balance_bounds().min.as_yoctonear();
            require!(amount > cost, "attach more than the storage cost");
            self.token.internal_register_account(&buyer);
            amount -= cost;
        }
        let out = self.execute_buy(&buyer, amount, min_out.map(|m| m.0));
        U128(out)
    }

    /// Sell tokens. What the sale brings in, after tax, is credited to you in
    /// the pair; collect it with `claim`.
    pub fn sell(&mut self, amount: U128, min_out: Option<U128>) -> U128 {
        require!(self.phase != Phase::Graduating, "the pool is opening; call open_pool");
        let seller = env::predecessor_account_id();
        let amount = amount.0;
        require!(amount > 0, "amount");
        let gross = match self.phase {
            Phase::Curve => self.curve_sell(amount),
            Phase::Pool => self.pool_sell(amount),
            Phase::Graduating => unreachable!(),
        };
        let pool_fee = if self.phase == Phase::Pool { gross * POOL_FEE_BPS as u128 / BPS as u128 } else { 0 };
        let after_fee = gross - pool_fee;
        let tax = after_fee * self.sell_tax_bps as u128 / BPS as u128;
        let net = after_fee - tax;
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
        self.distribute(tax + pool_fee);
        self.trades += 1;
        self.record(&seller, false, gross, amount);
        self.emit("trade", &format!(
            "{{\"side\":\"sell\",\"account\":\"{}\",\"tokens_in\":\"{}\",\"tax\":\"{}\",\"pair_out\":\"{}\",\"price\":\"{}\",\"phase\":\"{:?}\"}}",
            seller, amount, tax + pool_fee, net, self.price(), self.phase
        ));
        U128(net)
    }

    /// Opens the pool once the curve has sold out. Anyone may call; calling
    /// twice does nothing.
    pub fn open_pool(&mut self) {
        require!(self.phase == Phase::Graduating, "the curve has not filled");
        self.pool_pair = self.raised;
        self.pool_tokens = self.token.accounts.get(&env::current_account_id()).unwrap_or(0);
        self.phase = Phase::Pool;
        self.emit("graduated", &format!(
            "{{\"pool_pair\":\"{}\",\"pool_tokens\":\"{}\",\"price\":\"{}\"}}",
            self.pool_pair, self.pool_tokens, self.price()
        ));
        let liq = std::mem::take(&mut self.pending_liquidity);
        if liq > 0 {
            self.add_liquidity(liq);
        }
        let bb = std::mem::take(&mut self.pending_buyback);
        if bb > 0 {
            self.buyback_and_burn(bb);
        }
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
                .with_static_gas(GAS_FOR_CLAIM_CALLBACK)
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
                .with_static_gas(GAS_FOR_CLAIM_CALLBACK)
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
    // touch balances, the supply, the tax rates, the split or the pool.
    // ------------------------------------------------------------------

    /// Re-points future creator fees, for a community takeover. Fees already
    /// credited stay with the old wallet.
    pub fn set_fee_wallet(&mut self, fee_wallet: AccountId, reason: Option<String>) {
        self.assert_factory();
        require!(
            fee_wallet != env::current_account_id()
                && fee_wallet != self.factory
                && fee_wallet != self.treasury
                && fee_wallet != self.fee_wallet,
            "fee wallet cannot be the coin, the factory, the treasury or the current wallet"
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

    /// Pulls `bps` of the pool's position, pair and tokens, out to `to`. Only
    /// the factory (the platform), only once the pool is open. Not reversible.
    pub fn collect_liquidity(&mut self, bps: u32, to: AccountId) -> Promise {
        self.assert_factory();
        require!(self.phase == Phase::Pool, "the pool is not open");
        require!(bps > 0 && bps <= BPS, "bps: 1 to 10000");
        require!(to != env::current_account_id(), "to");
        let pair_out = self.pool_pair * bps as u128 / BPS as u128;
        let tokens_out = self.pool_tokens * bps as u128 / BPS as u128;
        require!(pair_out > 0 || tokens_out > 0, "nothing to collect");
        self.pool_pair -= pair_out;
        self.pool_tokens -= tokens_out;
        if tokens_out > 0 {
            if !self.token.accounts.contains_key(&to) {
                self.token.internal_register_account(&to);
            }
            self.settle(&to);
            let me = env::current_account_id();
            let before = self.token.accounts.get(&to).unwrap_or(0);
            self.token.internal_transfer(&me, &to, tokens_out, None);
            self.reset_debt(&to);
            self.track_holders(&to, before, before + tokens_out);
        }
        self.emit("liquidity_collected", &format!(
            "{{\"to\":\"{}\",\"bps\":{},\"pair\":\"{}\",\"tokens\":\"{}\"}}",
            to, bps, pair_out, tokens_out
        ));
        if pair_out > 0 {
            self.pay_pair(&to, pair_out)
        } else {
            Promise::new(to)
        }
    }

    fn assert_factory(&self) {
        require!(env::predecessor_account_id() == self.factory, "factory only");
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

    /// Tokens for a pair amount, after tax, at the current state. For quotes.
    pub fn quote_buy(&self, pair_in: U128) -> U128 {
        let tax = pair_in.0 * self.buy_tax_bps as u128 / BPS as u128;
        let mut net = pair_in.0 - tax;
        match self.phase {
            Phase::Curve => {
                let (x, y) = self.curve_reserves();
                let out = mul_div(y, net, x + net);
                U128(out.min(CURVE_SUPPLY - self.tokens_sold))
            }
            Phase::Pool => {
                net -= net * POOL_FEE_BPS as u128 / BPS as u128;
                U128(mul_div(self.pool_tokens, net, self.pool_pair + net))
            }
            Phase::Graduating => U128(0),
        }
    }

    /// Pair units for a token amount, after fee and tax. For quotes.
    pub fn quote_sell(&self, tokens_in: U128) -> U128 {
        let gross = match self.phase {
            Phase::Curve => {
                if tokens_in.0 > self.tokens_sold { return U128(0); }
                let (x, y) = self.curve_reserves();
                mul_div(x, tokens_in.0, y + tokens_in.0)
            }
            Phase::Pool => mul_div(self.pool_pair, tokens_in.0, self.pool_tokens + tokens_in.0),
            Phase::Graduating => return U128(0),
        };
        let pool_fee = if self.phase == Phase::Pool { gross * POOL_FEE_BPS as u128 / BPS as u128 } else { 0 };
        let after = gross - pool_fee;
        U128(after - after * self.sell_tax_bps as u128 / BPS as u128)
    }

    // ------------------------------------------------------------------
    // Internals
    // ------------------------------------------------------------------

    /// The shared buy path: `amount` of the pair is already in the coin's hands.
    fn execute_buy(&mut self, buyer: &AccountId, amount: u128, min_out: Option<u128>) -> u128 {
        require!(self.phase != Phase::Graduating, "the pool is opening; call open_pool");
        require!(self.token.accounts.contains_key(buyer), "register storage first");
        let tax = amount * self.buy_tax_bps as u128 / BPS as u128;
        let mut net = amount - tax;
        let pool_fee = if self.phase == Phase::Pool { net * POOL_FEE_BPS as u128 / BPS as u128 } else { 0 };
        net -= pool_fee;
        let (out, refund) = match self.phase {
            Phase::Curve => self.curve_buy(net),
            Phase::Pool => (self.pool_buy(net), 0),
            Phase::Graduating => unreachable!(),
        };
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
        self.distribute(tax + pool_fee);
        self.trades += 1;
        self.record(buyer, true, net, out);
        self.emit("trade", &format!(
            "{{\"side\":\"buy\",\"account\":\"{}\",\"pair_in\":\"{}\",\"tax\":\"{}\",\"tokens_out\":\"{}\",\"price\":\"{}\",\"phase\":\"{:?}\"}}",
            buyer, amount, tax + pool_fee, out, self.price(), self.phase
        ));
        if self.phase == Phase::Curve && self.tokens_sold >= CURVE_SUPPLY {
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

    fn pool_buy(&mut self, net: u128) -> u128 {
        let out = mul_div(self.pool_tokens, net, self.pool_pair + net);
        require!(out < self.pool_tokens, "pool");
        self.pool_pair += net;
        self.pool_tokens -= out;
        out
    }

    fn pool_sell(&mut self, amount: u128) -> u128 {
        let gross = mul_div(self.pool_pair, amount, self.pool_tokens + amount);
        require!(gross < self.pool_pair, "pool");
        self.pool_tokens += amount;
        self.pool_pair -= gross;
        gross
    }

    /// Pair units per whole token.
    fn price(&self) -> u128 {
        match self.phase {
            Phase::Curve | Phase::Graduating => {
                let (x, y) = self.curve_reserves();
                mul_div(x, ONE, y)
            }
            Phase::Pool => {
                if self.pool_tokens == 0 { 0 } else { mul_div(self.pool_pair, ONE, self.pool_tokens) }
            }
        }
    }

    /// Divides a tax or pool fee: 20% platform, the rest by the creator's split.
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
        if burn > 0 {
            if self.phase == Phase::Pool { self.buyback_and_burn(burn); } else { self.pending_buyback += burn; }
        }
        if liquidity > 0 {
            if self.phase == Phase::Pool { self.add_liquidity(liquidity); } else { self.pending_liquidity += liquidity; }
        }
        // Rounding dust stays in the contract.
    }

    fn eligible_supply(&self) -> u128 {
        self.token.total_supply - self.token.accounts.get(&env::current_account_id()).unwrap_or(0)
    }

    /// The platform's share goes straight to the treasury on every trade. A
    /// NEAR transfer to an existing account cannot fail; a pair-token transfer
    /// can (the treasury may not be registered on it), and then the amount is
    /// held as a credit the factory can collect later.
    fn pay_platform(&mut self, amount: u128) {
        if amount == 0 { return; }
        match &self.pair {
            PairAsset::Near => {
                let _p = Promise::new(self.treasury.clone()).transfer(NearToken::from_yoctonear(amount));
            }
            PairAsset::Token { account_id, .. } => {
                let _p = ext_ft::ext(account_id.clone())
                    .with_attached_deposit(ONE_YOCTO)
                    .with_static_gas(GAS_FOR_FT_TRANSFER)
                    .ft_transfer(self.treasury.clone(), U128(amount), None)
                    .then(
                        Self::ext(env::current_account_id())
                            .with_static_gas(GAS_FOR_CLAIM_CALLBACK)
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

    fn pending_dividends(&self, account: &AccountId, balance: u128) -> u128 {
        if balance == 0 || account == &env::current_account_id() { return 0; }
        let accrued = mul_div(balance, self.acc_per_token, ACC_SCALE);
        accrued.saturating_sub(self.reward_debt.get(account).copied().unwrap_or(0))
    }

    /// Moves an account's dividends earned so far into its credit. Call before
    /// any change to its balance.
    fn settle(&mut self, account: &AccountId) {
        if account == &env::current_account_id() { return; }
        let balance = self.token.accounts.get(account).unwrap_or(0);
        let owed = self.pending_dividends(account, balance);
        if owed > 0 {
            self.add_credit(account, owed);
        }
        self.reward_debt.insert(account.clone(), mul_div(balance, self.acc_per_token, ACC_SCALE));
    }

    /// After a balance change: debt matches the new balance.
    fn reset_debt(&mut self, account: &AccountId) {
        if account == &env::current_account_id() { return; }
        let balance = self.token.accounts.get(account).unwrap_or(0);
        self.reward_debt.insert(account.clone(), mul_div(balance, self.acc_per_token, ACC_SCALE));
    }

    fn add_credit(&mut self, account: &AccountId, amount: u128) {
        let cur = self.credits.get(account).copied().unwrap_or(0);
        self.credits.insert(account.clone(), cur + amount);
    }

    fn buyback_and_burn(&mut self, pair: u128) {
        if self.pool_tokens == 0 || self.pool_pair == 0 { self.pending_buyback += pair; return; }
        let out = mul_div(self.pool_tokens, pair, self.pool_pair + pair);
        if out == 0 || out >= self.pool_tokens { self.pending_buyback += pair; return; }
        self.pool_pair += pair;
        self.pool_tokens -= out;
        let me = env::current_account_id();
        self.token.internal_withdraw(&me, out);
        self.burned += out;
        self.buyback_spent += pair;
        self.emit("burn", &format!("{{\"pair\":\"{}\",\"tokens\":\"{}\"}}", pair, out));
    }

    fn add_liquidity(&mut self, pair: u128) {
        self.pool_pair += pair;
        self.liquidity_added += pair;
    }

    /// Sends pair units to an account: a NEAR transfer, or ft_transfer on the pair token.
    fn pay_pair(&self, to: &AccountId, amount: u128) -> Promise {
        match &self.pair {
            PairAsset::Near => Promise::new(to.clone()).transfer(NearToken::from_yoctonear(amount)),
            PairAsset::Token { account_id, .. } => ext_ft::ext(account_id.clone())
                .with_attached_deposit(ONE_YOCTO)
                .with_static_gas(GAS_FOR_FT_TRANSFER)
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
        if account == &env::current_account_id() { return; }
        if before == 0 && after > 0 { self.holders += 1; }
        if before > 0 && after == 0 { self.holders = self.holders.saturating_sub(1); }
    }

    fn emit(&self, event: &str, data: &str) {
        log!("EVENT_JSON:{{\"standard\":\"launchpad\",\"version\":\"1.0.0\",\"event\":\"{}\",\"data\":{}}}", event, data);
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
// NEP-141 with dividend settlement around every balance change.
// ----------------------------------------------------------------------

#[near]
impl FungibleTokenCore for Contract {
    #[payable]
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>) {
        let sender = env::predecessor_account_id();
        require!(receiver_id != env::current_account_id(), "use sell to trade with the coin");
        self.settle(&sender);
        self.settle(&receiver_id);
        let sb = self.token.accounts.get(&sender).unwrap_or(0);
        let rb = self.token.accounts.get(&receiver_id).unwrap_or(0);
        self.token.ft_transfer(receiver_id.clone(), amount, memo);
        self.reset_debt(&sender);
        self.reset_debt(&receiver_id);
        self.track_holders(&sender, sb, sb - amount.0);
        self.track_holders(&receiver_id, rb, rb + amount.0);
    }

    #[payable]
    fn ft_transfer_call(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>, msg: String) -> PromiseOrValue<U128> {
        let sender = env::predecessor_account_id();
        require!(receiver_id != env::current_account_id(), "use sell to trade with the coin");
        self.settle(&sender);
        self.settle(&receiver_id);
        let sb = self.token.accounts.get(&sender).unwrap_or(0);
        let rb = self.token.accounts.get(&receiver_id).unwrap_or(0);
        let p = self.token.ft_transfer_call(receiver_id.clone(), amount, memo, msg);
        self.reset_debt(&sender);
        self.reset_debt(&receiver_id);
        self.track_holders(&sender, sb, sb - amount.0);
        self.track_holders(&receiver_id, rb, rb + amount.0);
        p
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
    #[private]
    fn ft_resolve_transfer(&mut self, sender_id: AccountId, receiver_id: AccountId, amount: U128) -> U128 {
        self.settle(&sender_id);
        self.settle(&receiver_id);
        let sb = self.token.accounts.get(&sender_id).unwrap_or(0);
        let rb = self.token.accounts.get(&receiver_id).unwrap_or(0);
        let used = self.token.ft_resolve_transfer(sender_id.clone(), receiver_id.clone(), amount);
        self.reset_debt(&sender_id);
        self.reset_debt(&receiver_id);
        let sa = self.token.accounts.get(&sender_id).unwrap_or(0);
        let ra = self.token.accounts.get(&receiver_id).unwrap_or(0);
        self.track_holders(&sender_id, sb, sa);
        self.track_holders(&receiver_id, rb, ra);
        used
    }
}

#[near]
impl StorageManagement for Contract {
    #[payable]
    fn storage_deposit(&mut self, account_id: Option<AccountId>, registration_only: Option<bool>) -> StorageBalance {
        self.token.storage_deposit(account_id, registration_only)
    }

    #[payable]
    fn storage_withdraw(&mut self, amount: Option<NearToken>) -> StorageBalance {
        self.token.storage_withdraw(amount)
    }

    #[payable]
    fn storage_unregister(&mut self, force: Option<bool>) -> bool {
        let account = env::predecessor_account_id();
        self.settle(&account);
        let before = self.token.accounts.get(&account).unwrap_or(0);
        let ok = self.token.storage_unregister(force);
        if ok {
            self.reward_debt.remove(&account);
            self.track_holders(&account, before, 0);
        }
        ok
    }

    fn storage_balance_bounds(&self) -> StorageBalanceBounds {
        self.token.storage_balance_bounds()
    }

    fn storage_balance_of(&self, account_id: AccountId) -> Option<StorageBalance> {
        self.token.storage_balance_of(account_id)
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
