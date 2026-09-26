use super::*;
use near_sdk::test_utils::{accounts, VMContextBuilder};
use near_sdk::testing_env;

const NEAR: u128 = 1_000_000_000_000_000_000_000_000;

fn factory() -> AccountId { accounts(0) }
fn treasury() -> AccountId { accounts(1) }
fn alice() -> AccountId { accounts(2) }
fn bob() -> AccountId { accounts(3) }
fn coin() -> AccountId { "c1.factory.near".parse().unwrap() }

fn ctx(predecessor: AccountId, deposit: u128) -> VMContextBuilder {
    let mut b = VMContextBuilder::new();
    b.current_account_id(coin())
        .predecessor_account_id(predecessor)
        .attached_deposit(NearToken::from_yoctonear(deposit))
        .account_balance(NearToken::from_near(5000))
        .prepaid_gas(Gas::from_tgas(300));
    b
}

/// A callback context: the coin calling itself with the given promise results.
fn cb_env(results: Vec<PromiseResult>) {
    testing_env!(ctx(coin(), 0).build(), near_sdk::test_vm_config(), near_sdk::RuntimeFeesConfig::test(), Default::default(), results);
}

fn ok(json: &str) -> PromiseResult { PromiseResult::Successful(json.as_bytes().to_vec()) }

fn split(creator: u32, dividends: u32, burn: u32, liquidity: u32) -> Split {
    Split { creator_bps: creator, dividends_bps: dividends, burn_bps: burn, liquidity_bps: liquidity }
}

fn launch(s: Split, buy_tax: u32, sell_tax: u32) -> Contract {
    testing_env!(ctx(factory(), 0).build());
    Contract::new(
        factory(), treasury(), "Test Coin".into(), "test".into(), None, "desc".into(),
        Links { website: None, x: None, telegram: None },
        alice(), alice(), PairAsset::Near, U128(1000 * NEAR), buy_tax, sell_tax, s,
    )
}

fn storage_cost(_c: &Contract) -> u128 { MIN_STORAGE }

/// Dividend accounting rounds down by a few yocto per settlement.
fn approx(actual: u128, expected: u128) {
    let tol: u128 = 1_000_000_000_000; // 1e-12 NEAR
    assert!(actual <= expected && actual + tol >= expected, "actual {} expected {}", actual, expected);
}

/// Fills the curve with one whale buy and walks the graduation callbacks as
/// if Rhea had answered each step.
fn graduate(c: &mut Contract) {
    let cost = storage_cost(c);
    testing_env!(ctx(bob(), 3000 * NEAR + cost).build());
    c.buy(None, None);
    assert_eq!(c.get_info().phase, Phase::Graduating);
    testing_env!(ctx(alice(), 0).build());
    c.open_pool();
    let i = c.get_info();
    assert!(i.grad.lock_until > 0);
    cb_env(vec![ok("7"), ok("")]);
    c.on_pool_created(true);
    let i = c.get_info();
    assert_eq!(i.pool_id, Some(7));
    assert!(i.grad.pool_created && i.grad.wrapped);
    cb_env(vec![ok("\"0\""), ok(&format!("\"{}\"", i.pool_pair.0))]);
    c.on_deposited(true, true);
    let i = c.get_info();
    assert!(i.grad.coin_deposited && i.grad.pair_deposited);
    assert_eq!(c.get_holder(dex()).balance.0, i.pool_tokens.0, "the pool tokens sit with the exchange");
    cb_env(vec![ok("\"123456\"")]);
    c.on_liquidity_added(Ok(U128(123456)));
    let i = c.get_info();
    assert_eq!(i.phase, Phase::Pool);
    assert_eq!(i.lp_shares.0, 123456);
    assert_eq!(i.grad.lock_until, 0);
}

#[test]
fn opens_at_888_near_market_cap_and_graduates_at_2000() {
    let c = launch(split(0, 10000, 0, 0), 300, 300);
    let info = c.get_info();
    assert_eq!(info.total_supply.0, TOTAL_SUPPLY);
    // first token price 0.000000888889 NEAR
    assert_eq!(info.price.0, 888_888_888_888_888_888);
    assert!((888 * NEAR..889 * NEAR).contains(&info.market_cap.0));
    assert_eq!(info.graduation.0, 2000 * NEAR);
    assert_eq!(c.eligible_supply(), 0);
    assert_eq!(info.dex.as_str(), DEX);
}

#[test]
fn buy_charges_tax_and_credits_platform_creator_dividends() {
    let mut c = launch(split(4000, 3000, 2000, 1000), 300, 300);
    let cost = storage_cost(&c);
    testing_env!(ctx(bob(), 100 * NEAR + cost).build());
    let out = c.buy(None, None).0;
    assert!(out > 0);
    let info = c.get_info();
    // 3% of 100 NEAR = 3 NEAR tax: 0.6 platform, 2.4 to the four shares
    assert_eq!(info.platform_fees_total.0, 6 * NEAR / 10);
    assert_eq!(info.creator_fees_total.0, 96 * NEAR / 100);
    // the 0.72 NEAR of dividends went to bob, the only holder once his buy landed
    assert_eq!(info.pending_buyback.0, 48 * NEAR / 100);
    assert_eq!(info.pending_liquidity.0, 24 * NEAR / 100);
    assert_eq!(info.raised.0, 97 * NEAR);
    assert_eq!(info.holders, 1);
    assert_eq!(c.get_holder(alice()).credit.0, 96 * NEAR / 100);
    approx(c.get_holder(bob()).claimable_dividends.0, 72 * NEAR / 100);
}

#[test]
fn dividends_go_to_existing_holders_pro_rata() {
    let mut c = launch(split(0, 10000, 0, 0), 1000, 1000);
    let cost = storage_cost(&c);
    testing_env!(ctx(bob(), 100 * NEAR + cost).build());
    let bob_tokens = c.buy(None, None).0;
    testing_env!(ctx(alice(), 100 * NEAR + cost).build());
    c.buy(None, None);
    let hb = c.get_holder(bob());
    let ha = c.get_holder(alice());
    assert_eq!(hb.balance.0, bob_tokens);
    assert!(hb.claimable_dividends.0 > 8 * NEAR && hb.claimable_dividends.0 < 16 * NEAR, "{}", hb.claimable_dividends.0);
    assert!(ha.claimable_dividends.0 > 0 && ha.claimable_dividends.0 < 8 * NEAR, "{}", ha.claimable_dividends.0);
    approx(hb.claimable_dividends.0 + ha.claimable_dividends.0, 16 * NEAR);
}

#[test]
fn sell_credits_near_and_claim_moves_it() {
    let mut c = launch(split(0, 10000, 0, 0), 100, 100);
    let cost = storage_cost(&c);
    testing_env!(ctx(bob(), 10 * NEAR + cost).build());
    let got = c.buy(None, None).0;
    testing_env!(ctx(bob(), 0).build());
    let near_out = c.sell(U128(got), None).0;
    // buy 1% tax, sell 1% tax: back to roughly 98% of 10 NEAR
    assert!(near_out > 97 * NEAR / 10 && near_out < 99 * NEAR / 10, "{}", near_out);
    // credit = sale proceeds + the dividends from his own buy tax (80% of 0.1 NEAR)
    approx(c.get_holder(bob()).credit.0, near_out + 8 * NEAR / 100);
    assert_eq!(c.get_holder(bob()).balance.0, 0);
    assert_eq!(c.get_info().holders, 0);
    c.claim();
    assert_eq!(c.get_holder(bob()).credit.0, 0);
}

#[test]
fn curve_fills_at_exactly_2000_near_and_the_pool_opens_at_the_same_price() {
    let mut c = launch(split(0, 10000, 0, 0), 100, 100);
    let cost = storage_cost(&c);
    // Buy with far more than the curve needs: it fills exactly and refunds the rest.
    testing_env!(ctx(bob(), 5000 * NEAR + cost).build());
    let out = c.buy(None, None).0;
    assert_eq!(out, CURVE_SUPPLY);
    let info = c.get_info();
    assert_eq!(info.phase, Phase::Graduating);
    assert_eq!(info.raised.0, 2000 * NEAR);
    assert_eq!(info.tokens_sold.0, CURVE_SUPPLY);
    // last curve price: 0.000008 NEAR
    assert_eq!(info.price.0, 8_000_000_000_000_000_000);
    // refund: 5000 NEAR - 1% tax = 4950 net, 2000 used
    let credit = c.get_holder(bob()).credit.0;
    assert_eq!(credit, 4950 * NEAR - 2000 * NEAR);
    testing_env!(ctx(alice(), 0).build());
    c.open_pool();
    let info = c.get_info();
    assert_eq!(info.phase, Phase::Graduating, "Rhea has not answered yet");
    // A NEAR coin pays the 0.2 NEAR of Rhea storage out of the raise.
    assert_eq!(info.pool_pair.0, 2000 * NEAR - GRAD_COST);
    assert_eq!(info.pool_tokens.0, POOL_SUPPLY);
    assert_eq!(info.price.0, mul_div(2000 * NEAR - GRAD_COST, ONE, POOL_SUPPLY));
    // Second call while the first is in flight is refused.
    testing_env!(ctx(bob(), 0).build());
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| c.open_pool()));
    assert!(r.is_err(), "locked");
}

#[test]
fn graduation_walks_the_rhea_steps_and_buys_back_on_open() {
    let mut c = launch(split(0, 0, 10000, 0), 100, 100);
    graduate(&mut c);
    let i = c.get_info();
    assert!(i.burned.0 > 0, "pending buyback burned on open");
    assert_eq!(i.pending_buyback.0, 0);
    assert_eq!(i.total_supply.0, TOTAL_SUPPLY - i.burned.0);
    assert_eq!(i.pool_tokens.0, POOL_SUPPLY - i.burned.0);
    assert!(i.pool_pair.0 > 2000 * NEAR - GRAD_COST, "the buyback pair went into the pool");
}

#[test]
fn a_failed_step_unlocks_and_can_be_retried() {
    let mut c = launch(split(0, 10000, 0, 0), 100, 100);
    let cost = storage_cost(&c);
    testing_env!(ctx(bob(), 3000 * NEAR + cost).build());
    c.buy(None, None);
    testing_env!(ctx(alice(), 0).build());
    c.open_pool();
    // Rhea failed, wrap succeeded.
    cb_env(vec![PromiseResult::Failed, ok("")]);
    c.on_pool_created(true);
    let i = c.get_info();
    assert!(!i.grad.pool_created && i.grad.wrapped);
    assert_eq!(i.grad.lock_until, 0);
    // Retry: wrap is not repeated.
    testing_env!(ctx(alice(), 0).build());
    c.open_pool();
    cb_env(vec![ok("3")]);
    c.on_pool_created(false);
    assert_eq!(c.get_info().pool_id, Some(3));
    // The coin deposit fails: the tokens come back.
    cb_env(vec![PromiseResult::Failed, ok("\"1\"")]);
    c.on_deposited(true, true);
    let i = c.get_info();
    assert!(!i.grad.coin_deposited);
    assert!(i.grad.pair_deposited);
    assert_eq!(c.get_holder(dex()).balance.0, 0);
    assert_eq!(c.get_holder(coin()).balance.0, i.pool_tokens.0);
}

#[test]
fn after_graduation_transfers_with_the_exchange_pay_tax_and_curve_trading_stops() {
    let mut c = launch(split(0, 10000, 0, 0), 300, 500);
    graduate(&mut c);
    let bob_bal = c.get_holder(bob()).balance.0;
    // Bob sells 1,000 tokens on Rhea: 5% stays as tax.
    testing_env!(ctx(bob(), 1).build());
    c.ft_transfer(dex(), U128(1000 * ONE), None);
    let i = c.get_info();
    assert_eq!(i.tax_tokens.0, 50 * ONE);
    assert_eq!(c.get_holder(bob()).balance.0, bob_bal - 1000 * ONE);
    // Rhea pays alice 2,000 tokens for a buy: 3% stays as tax.
    testing_env!(ctx(alice(), storage_cost(&c)).build());
    c.storage_deposit(None, None);
    testing_env!(ctx(dex(), 1).build());
    c.ft_transfer(alice(), U128(2000 * ONE), None);
    let i = c.get_info();
    assert_eq!(i.tax_tokens.0, 50 * ONE + 60 * ONE);
    assert_eq!(c.get_holder(alice()).balance.0, 1940 * ONE);
    assert_eq!(i.trades, 3);
    // Wallet to wallet is free; the treasury is free.
    testing_env!(ctx(alice(), 1).build());
    c.ft_transfer(bob(), U128(100 * ONE), None);
    assert_eq!(c.get_info().tax_tokens.0, 110 * ONE);
    // The curve is closed.
    testing_env!(ctx(bob(), 10 * NEAR).build());
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| c.buy(None, None)));
    assert!(r.is_err());
    assert_eq!(c.quote_buy(U128(NEAR)).0, 0);
    // The pool's tokens earn no dividends: only holders do.
    assert_eq!(c.eligible_supply(), c.get_info().total_supply.0 - c.get_holder(coin()).balance.0 - c.get_holder(dex()).balance.0);
}

#[test]
fn a_sell_through_ft_transfer_call_refunds_the_tax_on_the_unused_part() {
    let mut c = launch(split(0, 10000, 0, 0), 300, 1000);
    graduate(&mut c);
    testing_env!(ctx(bob(), 1).build());
    c.ft_transfer_call(dex(), U128(1000 * ONE), None, "{}".into());
    assert_eq!(c.get_info().tax_tokens.0, 100 * ONE);
    let before = c.get_holder(bob()).balance.0;
    // Rhea used only half.
    cb_env(vec![ok(&format!("\"{}\"", 450 * ONE))]);
    let used = c.ft_resolve_taxed(bob(), dex(), U128(900 * ONE), U128(100 * ONE)).0;
    assert_eq!(used, 450 * ONE);
    assert_eq!(c.get_info().tax_tokens.0, 50 * ONE);
    assert_eq!(c.get_holder(bob()).balance.0, before + 450 * ONE + 50 * ONE);
}

#[test]
fn harvest_burns_then_sells_the_rest_and_divides_the_pair() {
    let mut c = launch(split(2500, 2500, 2500, 2500), 500, 500);
    graduate(&mut c);
    testing_env!(ctx(bob(), 1).build());
    c.ft_transfer(dex(), U128(100_000 * ONE), None);
    let i = c.get_info();
    assert_eq!(i.tax_tokens.0, 5_000 * ONE);
    let burned_before = i.burned.0;
    let supply_before = i.total_supply.0;
    testing_env!(ctx(alice(), 0).build());
    c.harvest();
    let i = c.get_info();
    assert_eq!(i.tax_tokens.0, 0);
    // 20% platform = 1,000; rest 4,000: 1,000 each share. Burn 1,000 now; keep 500 for the pool; swap 3,500.
    assert_eq!(i.burned.0 - burned_before, 1_000 * ONE);
    assert_eq!(i.total_supply.0, supply_before - 1_000 * ONE);
    assert_eq!(i.harvest.platform_tokens.0, 1_000 * ONE);
    assert_eq!(i.harvest.liquidity_tokens.0, 500 * ONE);
    assert_eq!(i.harvest.swap_tokens.0, 3_500 * ONE);
    // Rhea holds the pool tokens, bob's 95,000 net sale and the 4,000 just deposited.
    assert_eq!(c.get_holder(dex()).balance.0, i.pool_tokens.0 + 95_000 * ONE + 4_000 * ONE, "deposited on Rhea");
    // Deposited, swapped for 7 NEAR, withdrawn, unwrapped.
    cb_env(vec![ok("\"0\"")]);
    c.on_harvest_deposited();
    assert_eq!(c.get_info().harvest.step, 1);
    cb_env(vec![ok(&format!("\"{}\"", 7 * NEAR))]);
    c.on_harvest_swapped(Ok(U128(7 * NEAR)));
    let h = c.get_info().harvest;
    assert_eq!(h.step, 2);
    assert_eq!(h.out.0, 7 * NEAR);
    // 500 of the 3,500 swapped were the liquidity half: 1 NEAR of the 7.
    assert_eq!(h.liquidity_pair.0, NEAR);
    cb_env(vec![ok("")]);
    c.on_harvest_withdrawn();
    assert_eq!(c.get_info().harvest.step, 3);
    let pf = c.get_info().platform_fees_total.0;
    let cf = c.get_info().creator_fees_total.0;
    let dv = c.get_info().dividends_total.0;
    let alice_credit = c.get_holder(alice()).credit.0;
    cb_env(vec![ok("")]);
    c.on_harvest_unwrapped();
    let i = c.get_info();
    assert_eq!(i.harvest.step, 0);
    assert_eq!(i.harvest.lock_until, 0);
    // Of the 7 NEAR: 2 platform (1,000 of 3,500), 2 creator, 2 dividends, 1 liquidity.
    assert_eq!(i.platform_fees_total.0 - pf, 2 * NEAR);
    assert_eq!(i.creator_fees_total.0 - cf, 2 * NEAR);
    assert_eq!(i.dividends_total.0 - dv, 2 * NEAR);
    assert!(i.liquidity_added.0 >= NEAR);
    assert_eq!(c.get_holder(alice()).credit.0 - alice_credit, 2 * NEAR, "the creator's fee wallet");
}

#[test]
fn harvest_needs_enough_tax_and_refunds_a_failed_deposit() {
    let mut c = launch(split(0, 10000, 0, 0), 100, 100);
    graduate(&mut c);
    testing_env!(ctx(alice(), 0).build());
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| c.harvest()));
    assert!(r.is_err(), "nothing to harvest");
    testing_env!(ctx(bob(), 1).build());
    c.ft_transfer(dex(), U128(200_000 * ONE), None);
    assert_eq!(c.get_info().tax_tokens.0, 2_000 * ONE);
    testing_env!(ctx(alice(), 0).build());
    c.harvest();
    assert_eq!(c.get_info().tax_tokens.0, 0);
    cb_env(vec![PromiseResult::Failed]);
    c.on_harvest_deposited();
    let i = c.get_info();
    assert_eq!(i.tax_tokens.0, 2_000 * ONE, "back in the pot");
    assert_eq!(i.harvest.step, 0);
    assert_eq!(i.harvest.lock_until, 0);
}

#[test]
fn transfer_settles_dividends_for_both_sides() {
    let mut c = launch(split(0, 10000, 0, 0), 500, 500);
    let cost = storage_cost(&c);
    testing_env!(ctx(bob(), 100 * NEAR + cost).build());
    let got = c.buy(None, None).0;
    testing_env!(ctx(alice(), 100 * NEAR + cost).build());
    c.buy(None, None);
    let bob_owed = c.get_holder(bob()).claimable_dividends.0;
    assert!(bob_owed > 0);
    // bob sends half to alice; his earned dividends move to credit, alice's debt resets
    testing_env!(ctx(bob(), 1).build());
    c.ft_transfer(alice(), U128(got / 2), None);
    let hb = c.get_holder(bob());
    assert_eq!(hb.claimable_dividends.0, 0);
    assert_eq!(hb.credit.0, bob_owed);
    assert_eq!(c.get_holder(alice()).claimable_dividends.0, 0);
    // the next tax splits by the new balances
    testing_env!(ctx(treasury(), 100 * NEAR + cost).build());
    c.buy(None, None);
    let hb2 = c.get_holder(bob()).claimable_dividends.0;
    let ha2 = c.get_holder(alice()).claimable_dividends.0;
    assert!(ha2 > hb2, "alice holds more now: {} vs {}", ha2, hb2);
}

#[test]
#[should_panic(expected = "factory only")]
fn admin_is_factory_only() {
    let mut c = launch(split(0, 10000, 0, 0), 300, 300);
    testing_env!(ctx(alice(), 0).build());
    c.set_fee_wallet(bob(), None);
}

#[test]
fn factory_can_repoint_fee_wallet() {
    let mut c = launch(split(10000, 0, 0, 0), 300, 300);
    testing_env!(ctx(factory(), 0).build());
    c.set_fee_wallet(bob(), Some("takeover".into()));
    let cost = storage_cost(&c);
    testing_env!(ctx(alice(), 10 * NEAR + cost).build());
    c.buy(None, None);
    assert_eq!(c.get_holder(bob()).credit.0, 24 * NEAR / 100);
    assert_eq!(c.get_holder(alice()).credit.0, 0);
}

#[test]
#[should_panic(expected = "the four shares must total 100%")]
fn split_must_total_100() {
    launch(split(5000, 4000, 0, 0), 300, 300);
}

#[test]
#[should_panic(expected = "tax: 1% to 10% a side")]
fn tax_bounds() {
    launch(split(0, 10000, 0, 0), 1100, 300);
}

fn pair_token() -> AccountId { "bnb-nvda.omdep.near".parse().unwrap() }

fn launch_token_pair() -> Contract {
    testing_env!(ctx(factory(), 0).build());
    Contract::new(
        factory(), treasury(), "Stock Coin".into(), "stk".into(), None, "".into(),
        Links { website: None, x: None, telegram: None },
        alice(), alice(),
        PairAsset::Token { account_id: pair_token(), symbol: "NVDAon".into(), decimals: 18 },
        U128(41 * ONE), 300, 300, split(0, 10000, 0, 0),
    )
}

#[test]
fn token_pair_buys_through_ft_on_transfer_and_pays_in_the_pair() {
    let mut c = launch_token_pair();
    // the buyer registers storage first, then the pair token delivers the payment
    testing_env!(ctx(bob(), storage_cost(&c)).build());
    c.storage_deposit(None, Some(true));
    testing_env!(ctx(pair_token(), 0).build());
    let unused = c.ft_on_transfer(bob(), U128(10 * ONE), "{\"min_out\":null}".into());
    match unused { PromiseOrValue::Value(v) => assert_eq!(v.0, 0), _ => panic!("value") }
    let h = c.get_holder(bob());
    assert!(h.balance.0 > 0);
    let info = c.get_info();
    assert_eq!(info.raised.0, 97 * ONE / 10);
    assert_eq!(info.graduation.0, 82 * ONE);
    // selling credits the pair, not NEAR
    testing_env!(ctx(bob(), 0).build());
    let out = c.sell(U128(h.balance.0), None).0;
    assert!(out > 9 * ONE && out < 10 * ONE, "{}", out);
    approx(c.get_holder(bob()).credit.0, out + 24 * ONE / 100);
}

#[test]
fn token_pair_graduation_needs_the_storage_deposit_and_keeps_the_raise() {
    let mut c = launch_token_pair();
    testing_env!(ctx(bob(), storage_cost(&c)).build());
    c.storage_deposit(None, Some(true));
    testing_env!(ctx(pair_token(), 0).build());
    c.ft_on_transfer(bob(), U128(200 * ONE), "".into());
    assert_eq!(c.get_info().phase, Phase::Graduating);
    testing_env!(ctx(alice(), 0).build());
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| c.open_pool()));
    assert!(r.is_err(), "needs 0.2 NEAR");
    testing_env!(ctx(alice(), GRAD_COST).build());
    c.open_pool();
    let i = c.get_info();
    assert_eq!(i.pool_pair.0, 82 * ONE, "the whole raise seeds the pool");
    cb_env(vec![ok("9")]);
    c.on_pool_created(false);
    assert_eq!(c.get_info().pool_id, Some(9));
}

#[test]
#[should_panic(expected = "pay in the pair")]
fn token_pair_refuses_near_buy() {
    let mut c = launch_token_pair();
    testing_env!(ctx(bob(), 10 * NEAR).build());
    c.buy(None, None);
}

#[test]
#[should_panic(expected = "only the pair token")]
fn ft_on_transfer_only_from_the_pair() {
    let mut c = launch_token_pair();
    testing_env!(ctx(bob(), 0).build());
    c.ft_on_transfer(bob(), U128(10 * ONE), "".into());
}

#[test]
fn candles_and_recent_trades_are_kept_on_chain() {
    let mut c = launch(split(0, 10000, 0, 0), 100, 100);
    let cost = storage_cost(&c);
    let mut b = ctx(bob(), 10 * NEAR + cost); b.block_timestamp(1_000_000 * 1_000_000); testing_env!(b.build());
    c.buy(None, None);
    let mut b = ctx(alice(), 10 * NEAR + cost); b.block_timestamp(1_000_000 * 1_000_000 + 60_000 * 1_000_000); testing_env!(b.build());
    c.buy(None, None);
    let mut b = ctx(alice(), 0); b.block_timestamp(1_000_000 * 1_000_000 + 6 * 60_000 * 1_000_000); testing_env!(b.build());
    c.sell(U128(ONE), None);
    let candles = c.get_candles(None, None);
    assert_eq!(candles.len(), 2, "two five-minute buckets");
    assert!(candles[0].h.0 >= candles[0].o.0 && candles[0].c.0 >= candles[0].o.0);
    assert_eq!(candles[0].v.0, 2 * (10 * NEAR - 10 * NEAR / 100));
    assert!(candles[1].t > candles[0].t);
    let trades = c.get_trades(Some(10));
    assert_eq!(trades.len(), 3);
    assert!(!trades[0].buy && trades[1].buy, "newest first");
    assert_eq!(trades[0].account, alice());
}

#[test]
fn factory_can_collect_lp_shares_after_graduation() {
    let mut c = launch(split(0, 10000, 0, 0), 100, 100);
    graduate(&mut c);
    testing_env!(ctx(factory(), LP_REGISTER).build());
    c.collect_liquidity(2500, treasury());
    cb_env(vec![ok("\"123456\""), ok("false")]);
    c.on_lp_checked(2500, treasury());
    cb_env(vec![ok("")]);
    c.on_lp_transferred(treasury(), U128(123456 / 4), 2500);
    assert_eq!(c.get_info().lp_collected.0, 123456 / 4);
}

#[test]
#[should_panic(expected = "the pool is not open")]
fn collect_liquidity_needs_the_pool() {
    let mut c = launch(split(0, 10000, 0, 0), 100, 100);
    testing_env!(ctx(factory(), 0).build());
    c.collect_liquidity(1000, treasury());
}

#[test]
fn storage_is_a_fixed_deposit_returned_on_unregister() {
    let mut c = launch(split(0, 10000, 0, 0), 100, 100);
    assert_eq!(c.storage_balance_bounds().min.as_yoctonear(), MIN_STORAGE);
    testing_env!(ctx(bob(), 3 * MIN_STORAGE).build());
    c.storage_deposit(None, None);
    assert_eq!(c.storage_balance_of(bob()).unwrap().total.as_yoctonear(), MIN_STORAGE);
    testing_env!(ctx(bob(), 1).build());
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| c.storage_withdraw(Some(NearToken::from_yoctonear(1)))));
    assert!(r.is_err());
    assert!(c.storage_unregister(None));
    assert!(c.storage_balance_of(bob()).is_none());
}
