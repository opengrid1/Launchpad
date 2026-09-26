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
        .prepaid_gas(Gas::from_tgas(300));
    b
}

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

fn storage_cost(c: &Contract) -> u128 { c.token.storage_balance_bounds().min.as_yoctonear() }

/// Dividend accounting rounds down by a few yocto per settlement.
fn approx(actual: u128, expected: u128) {
    let tol: u128 = 1_000_000_000_000; // 1e-12 NEAR
    assert!(actual <= expected && actual + tol >= expected, "actual {} expected {}", actual, expected);
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
    // Each 10 NEAR tax: 2 platform, 8 dividends to everyone holding once the
    // buy has landed, the buyer included. Bob got all 8 of his own, then his
    // share of alice's 8; alice only her share of her own.
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
fn curve_fills_at_exactly_2000_near_and_pool_opens_at_same_price() {
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
    let price_before = info.price.0;
    // refund: 5000 NEAR - 1% tax = 4950 net, 2000 used
    let credit = c.get_holder(bob()).credit.0;
    assert_eq!(credit, 4950 * NEAR - 2000 * NEAR);
    testing_env!(ctx(alice(), 0).build());
    c.open_pool();
    let info = c.get_info();
    assert_eq!(info.phase, Phase::Pool);
    assert_eq!(info.pool_pair.0, 2000 * NEAR);
    assert_eq!(info.pool_tokens.0, POOL_SUPPLY);
    assert_eq!(info.price.0, price_before);
    assert!((7999 * NEAR..=8000 * NEAR).contains(&info.market_cap.0), "{}", info.market_cap.0);
}

#[test]
fn pool_trades_pay_fee_and_buyback_burns() {
    let mut c = launch(split(0, 0, 10000, 0), 100, 100);
    let cost = storage_cost(&c);
    testing_env!(ctx(bob(), 3000 * NEAR + cost).build());
    c.buy(None, None);
    testing_env!(ctx(alice(), 0).build());
    c.open_pool();
    let before = c.get_info();
    // pending buyback from the curve phase was executed on open
    assert!(before.burned.0 > 0);
    assert_eq!(before.pending_buyback.0, 0);
    testing_env!(ctx(alice(), 10 * NEAR + cost).build());
    let out = c.buy(None, None).0;
    assert!(out > 0);
    let after = c.get_info();
    assert!(after.burned.0 > before.burned.0);
    assert_eq!(after.total_supply.0, TOTAL_SUPPLY - after.burned.0);
    // 1% tax + 1% pool fee on 10 NEAR: 0.199 NEAR, 20% platform
    assert_eq!(after.platform_fees_total.0 - before.platform_fees_total.0, (10 * NEAR / 100 + (10 * NEAR - 10 * NEAR / 100) / 100) / 5);
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
