//! End to end on a local NEAR sandbox: publish the coin code as a global
//! contract, launch a coin, trade on the curve, fill it, open the pool, trade
//! on the pool, claim, and collect the platform's share.
use near_workspaces::types::{Gas, NearToken};
use near_workspaces::{Account, AccountId, Contract};
use serde_json::{json, Value};

const NEAR: u128 = 1_000_000_000_000_000_000_000_000;

fn y(v: &Value) -> u128 { v.as_str().unwrap().parse().unwrap() }

async fn info(coin: &AccountId, w: &near_workspaces::Worker<near_workspaces::network::Sandbox>) -> Value {
    w.view(coin, "get_info").args_json(json!({})).await.unwrap().json().unwrap()
}

async fn holder(coin: &AccountId, w: &near_workspaces::Worker<near_workspaces::network::Sandbox>, a: &AccountId) -> Value {
    w.view(coin, "get_holder").args_json(json!({ "account_id": a })).await.unwrap().json().unwrap()
}

#[tokio::test]
async fn launch_trade_graduate_claim() -> anyhow::Result<()> {
    let worker = near_workspaces::sandbox().await?;
    let factory_wasm = std::fs::read(if std::path::Path::new("../out/launch_factory.wasm").exists() { "../out/launch_factory.wasm" } else { "../target/wasm32-unknown-unknown/release/launch_factory.wasm" })?;
    let token_wasm = std::fs::read(if std::path::Path::new("../out/launch_token.wasm").exists() { "../out/launch_token.wasm" } else { "../target/wasm32-unknown-unknown/release/launch_token.wasm" })?;

    let root = worker.root_account()?;
    let owner = root.create_subaccount("owner").initial_balance(NearToken::from_near(100)).transact().await?.into_result()?;
    let treasury = root.create_subaccount("treasury").initial_balance(NearToken::from_near(5)).transact().await?.into_result()?;
    let alice = root.create_subaccount("alice").initial_balance(NearToken::from_near(200)).transact().await?.into_result()?;
    let bob = root.create_subaccount("bob").initial_balance(NearToken::from_near(200)).transact().await?.into_result()?;
    let whale = root.create_subaccount("whale").initial_balance(NearToken::from_near(5_000)).transact().await?.into_result()?;

    let factory_acc = root.create_subaccount("pad").initial_balance(NearToken::from_near(20)).transact().await?.into_result()?;
    let factory: Contract = factory_acc.deploy(&factory_wasm).await?.into_result()?;
    factory.call("new").args_json(json!({ "owner": owner.id(), "treasury": treasury.id(), "launch_fee": (NEAR / 2).to_string(), "near_virtual_reserve": (1000 * NEAR).to_string() })).transact().await?.into_result()?;

    // Publish the coin code as a global contract.
    let hash = near_workspaces::types::CryptoHash(near_sdk::env::sha256_array(&token_wasm));
    let b64 = { use base64::Engine; base64::engine::general_purpose::STANDARD.encode(&token_wasm) };
    let r = owner.call(factory.id(), "publish_code")
        .args_json(json!({ "version": "0.1.0", "code_hash": hash.to_string(), "code": b64 }))
        .deposit(NearToken::from_near(60)).gas(Gas::from_tgas(300)).transact().await?;
    assert!(r.is_success(), "publish: {:?}", r.failures());
    let cfg: Value = factory.view("get_config").await?.json()?;
    assert_eq!(cfg["current_version"]["version"], "0.1.0");

    // Launch with an initial buy of 1 NEAR.
    let params = json!({
        "name": "Sandbox Cat", "symbol": "scat", "icon": null, "description": "a test coin",
        "links": { "website": null, "x": null, "telegram": null }, "pair": null,
        "buy_tax_bps": 300, "sell_tax_bps": 300,
        "split": { "creator_bps": 4000, "dividends_bps": 3000, "burn_bps": 2000, "liquidity_bps": 1000 },
        "fee_wallet": null, "initial_buy": NEAR.to_string()
    });
    let r = alice.call(factory.id(), "create").args_json(json!({ "params": params }))
        .deposit(NearToken::from_near(3)).gas(Gas::from_tgas(300)).transact().await?;
    assert!(r.is_success(), "create: {:?}", r.failures());
    let list: Value = factory.view("list").args_json(json!({})).await?.json()?;
    assert_eq!(list.as_array().unwrap().len(), 1);
    let coin: AccountId = list[0]["account_id"].as_str().unwrap().parse()?;
    assert_eq!(coin.as_str(), format!("c1.{}", factory.id()));
    let i = info(&coin, &worker).await;
    assert_eq!(i["phase"], "Curve");
    assert!(y(&i["tokens_sold"]) > 0);
    assert!(y(&holder(&coin, &worker, alice.id()).await["balance"]) > 0, "initial buy landed");
    // 2 NEAR over the need was refunded to alice (minus gas).
    assert!(alice.view_account().await?.balance.as_yoctonear() > 197 * NEAR);

    // Bob buys 10 NEAR, sells half, claims.
    let r = bob.call(&coin, "buy").args_json(json!({ "min_out": null, "for_account": null })).deposit(NearToken::from_near(10)).gas(Gas::from_tgas(100)).transact().await?;
    assert!(r.is_success(), "buy: {:?}", r.failures());
    let bal = y(&holder(&coin, &worker, bob.id()).await["balance"]);
    let r = bob.call(&coin, "sell").args_json(json!({ "amount": (bal / 2).to_string(), "min_near_out": null })).gas(Gas::from_tgas(100)).transact().await?;
    assert!(r.is_success(), "sell: {:?}", r.failures());
    let h = holder(&coin, &worker, bob.id()).await;
    assert!(y(&h["credit"]) > 4 * NEAR);
    let before = bob.view_account().await?.balance.as_yoctonear();
    let r = bob.call(&coin, "claim").gas(Gas::from_tgas(50)).transact().await?;
    assert!(r.is_success(), "claim: {:?}", r.failures());
    let after = bob.view_account().await?.balance.as_yoctonear();
    assert!(after > before + 4 * NEAR, "claim paid out: {} -> {}", before, after);
    assert_eq!(y(&holder(&coin, &worker, bob.id()).await["credit"]), 0);

    // The whale fills the curve.
    let r = whale.call(&coin, "buy").args_json(json!({ "min_out": null, "for_account": null })).deposit(NearToken::from_near(2_500)).gas(Gas::from_tgas(100)).transact().await?;
    assert!(r.is_success(), "fill: {:?}", r.failures());
    let i = info(&coin, &worker).await;
    assert_eq!(i["phase"], "Graduating");
    assert_eq!(y(&i["raised"]), 2_000 * NEAR);
    let r = bob.call(&coin, "open_pool").gas(Gas::from_tgas(100)).transact().await?;
    assert!(r.is_success(), "open: {:?}", r.failures());
    let i = info(&coin, &worker).await;
    assert_eq!(i["phase"], "Pool");
    assert!(y(&i["pool_pair"]) >= 2_000 * NEAR);
    assert!(y(&i["burned"]) > 0, "pending buyback burned on open");
    assert!(y(&i["liquidity_added"]) > 0);

    // Pool trade: the platform's share lands in the treasury on the spot.
    let t0 = treasury.view_account().await?.balance.as_yoctonear();
    let r = bob.call(&coin, "buy").args_json(json!({ "min_out": null, "for_account": null })).deposit(NearToken::from_near(5)).gas(Gas::from_tgas(100)).transact().await?;
    assert!(r.is_success(), "pool buy: {:?}", r.failures());
    let t1 = treasury.view_account().await?.balance.as_yoctonear();
    // 5 NEAR: 3% tax + 1% pool fee, 20% of that to the platform
    assert!(t1 - t0 > 35 * NEAR / 1000, "treasury paid on the spot: {}", t1 - t0);
    assert_eq!(y(&info(&coin, &worker).await["platform_credit"]), 0);
    // Nothing left to collect on a NEAR coin.
    let r = bob.call(factory.id(), "collect_platform").args_json(json!({ "id": 1 })).gas(Gas::from_tgas(50)).transact().await?;
    assert!(r.is_failure(), "nothing to collect");

    // Admin: owner re-points creator fees; a stranger cannot.
    let r = owner.call(factory.id(), "coin_set_fee_wallet").args_json(json!({ "id": 1, "fee_wallet": bob.id(), "reason": "takeover" })).gas(Gas::from_tgas(50)).transact().await?;
    assert!(r.is_success(), "takeover: {:?}", r.failures());
    assert_eq!(info(&coin, &worker).await["fee_wallet"], bob.id().as_str());
    let r = alice.call(factory.id(), "set_paused").args_json(json!({ "paused": true })).transact().await?;
    assert!(r.is_failure());
    // A coin paired with a NEP-141: coin 1 itself is the pair of coin 2.
    let r = owner.call(factory.id(), "set_pair").args_json(json!({
        "key": "SCAT", "asset": { "Token": { "account_id": coin, "symbol": "SCAT", "decimals": 18 } },
        "name": "Sandbox Cat", "virtual_reserve": (100_000_000u128 * 1_000_000_000_000_000_000).to_string(), "enabled": true
    })).transact().await?;
    assert!(r.is_success(), "set_pair: {:?}", r.failures());
    let params2 = json!({
        "name": "Cat Squared", "symbol": "cat2", "icon": null, "description": "",
        "links": { "website": null, "x": null, "telegram": null }, "pair": "SCAT",
        "buy_tax_bps": 500, "sell_tax_bps": 500,
        "split": { "creator_bps": 5000, "dividends_bps": 5000, "burn_bps": 0, "liquidity_bps": 0 },
        "fee_wallet": null, "initial_buy": null
    });
    let r = alice.call(factory.id(), "create").args_json(json!({ "params": params2 }))
        .deposit(NearToken::from_near(2)).gas(Gas::from_tgas(300)).transact().await?;
    assert!(r.is_success(), "create 2: {:?}", r.failures());
    let coin2: AccountId = format!("c2.{}", factory.id()).parse()?;
    let i2 = info(&coin2, &worker).await;
    assert_eq!(i2["pair"]["Token"]["account_id"], coin.as_str());
    // the whale holds lots of SCAT: register on coin 2, then pay in SCAT
    let r = whale.call(&coin2, "storage_deposit").args_json(json!({ "account_id": null, "registration_only": true })).deposit(NearToken::from_millinear(10)).transact().await?;
    assert!(r.is_success(), "storage: {:?}", r.failures());
    let scat = y(&holder(&coin, &worker, whale.id()).await["balance"]);
    let pay = scat / 10;
    let r = whale.call(&coin, "ft_transfer_call").args_json(json!({ "receiver_id": coin2, "amount": pay.to_string(), "msg": "" }))
        .deposit(NearToken::from_yoctonear(1)).gas(Gas::from_tgas(100)).transact().await?;
    assert!(r.is_success(), "pay in pair: {:?}", r.failures());
    let h2 = holder(&coin2, &worker, whale.id()).await;
    assert!(y(&h2["balance"]) > 0, "bought coin 2 with coin 1");
    let i2 = info(&coin2, &worker).await;
    assert_eq!(y(&i2["raised"]), pay - pay * 500 / 10_000);
    // sell coin 2, claim the pair: SCAT arrives back in the whale's wallet
    let r = whale.call(&coin2, "sell").args_json(json!({ "amount": h2["balance"], "min_out": null })).gas(Gas::from_tgas(100)).transact().await?;
    assert!(r.is_success(), "sell 2: {:?}", r.failures());
    let before = y(&holder(&coin, &worker, whale.id()).await["balance"]);
    let r = whale.call(&coin2, "claim").gas(Gas::from_tgas(60)).transact().await?;
    assert!(r.is_success(), "claim 2: {:?}", r.failures());
    let after = y(&holder(&coin, &worker, whale.id()).await["balance"]);
    assert!(after > before, "paid in the pair token: {} -> {}", before, after);
    assert_eq!(y(&holder(&coin2, &worker, whale.id()).await["credit"]), 0);
    let _ = Account::from(alice);
    Ok(())
}
