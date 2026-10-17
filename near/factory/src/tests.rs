use super::*;
use near_sdk::test_utils::{accounts, VMContextBuilder};
use near_sdk::testing_env;

const NEAR: u128 = 1_000_000_000_000_000_000_000_000;

fn ctx(predecessor: AccountId, deposit: u128) -> VMContextBuilder {
    let mut b = VMContextBuilder::new();
    b.current_account_id("pad.test.near".parse().unwrap())
        .predecessor_account_id(predecessor)
        .attached_deposit(NearToken::from_yoctonear(deposit))
        .prepaid_gas(Gas::from_tgas(300));
    b
}

#[test]
fn create_builds_the_coin_promise() {
    testing_env!(ctx(accounts(0), 0).build());
    let mut f = Factory::new(accounts(0), accounts(1), U128(NEAR / 2), U128(1000 * NEAR));
    let code = vec![1u8, 2, 3];
    let hash = Base58CryptoHash::from(env::sha256_array(&code));
    testing_env!(ctx(accounts(0), 60 * NEAR).build());
    f.publish_code("0.1.0".into(), hash, code.into());
    assert_eq!(f.get_config().current_version.unwrap().version, "0.1.0");
    testing_env!(ctx(accounts(2), 3 * NEAR).build());
    f.create(LaunchParams {
        name: "Sandbox Cat".into(), symbol: "scat".into(), icon: None, description: "a test coin".into(),
        links: Links { website: None, x: None, telegram: None }, pair: None,
        buy_tax_bps: 300, sell_tax_bps: 300,
        split: Split { creator_bps: 4000, dividends_bps: 3000, burn_bps: 2000, liquidity_bps: 1000 },
        fee_wallet: None, initial_buy: Some(U128(NEAR)),
    });
    let l = f.list(None, None, None);
    assert_eq!(l.len(), 1);
    assert_eq!(l[0].account_id.as_str(), "c1.pad.test.near");
}
