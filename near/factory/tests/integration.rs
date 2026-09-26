//! End to end on a local NEAR sandbox with the live Rhea exchange and wrap.near
//! wasm spooned in: publish the coin code as a global contract, launch a coin,
//! trade on the curve, fill it, open the Rhea pool, trade on Rhea (taxed),
//! harvest, claim, and move LP shares to the treasury. Then the same for a
//! coin paired with a NEP-141 token.
//!
//! Needs ../fixtures/v2.ref-finance.near.wasm and ../fixtures/wrap.near.wasm
//! (mainnet `view_code`); without them the test is skipped.
use near_workspaces::network::Sandbox;
use near_workspaces::types::{AccessKey, AccountDetailsPatch, Gas, KeyType, NearToken, SecretKey};
use near_workspaces::{Account, AccountId, Contract, Worker};
use serde_json::{json, Value};

const NEAR: u128 = 1_000_000_000_000_000_000_000_000;
const ONE: u128 = 1_000_000_000_000_000_000;

fn y(v: &Value) -> u128 { v.as_str().unwrap().parse().unwrap() }

async fn info(coin: &AccountId, w: &Worker<Sandbox>) -> Value {
    w.view(coin, "get_info").args_json(json!({})).await.unwrap().json().unwrap()
}

async fn holder(coin: &AccountId, w: &Worker<Sandbox>, a: &AccountId) -> Value {
    w.view(coin, "get_holder").args_json(json!({ "account_id": a })).await.unwrap().json().unwrap()
}

async fn ft_balance(token: &AccountId, w: &Worker<Sandbox>, a: &AccountId) -> u128 {
    y(&w.view(token, "ft_balance_of").args_json(json!({ "account_id": a })).await.unwrap().json().unwrap())
}

async fn spoon(worker: &Worker<Sandbox>, id: &str, wasm: &[u8], near: u128) -> anyhow::Result<Account> {
    let id: AccountId = id.parse()?;
    let sk = SecretKey::from_random(KeyType::ED25519);
    worker.patch(&id)
        .account(AccountDetailsPatch::default().balance(NearToken::from_yoctonear(near)).locked(NearToken::from_yoctonear(0)).storage_usage(0))
        .access_key(sk.public_key(), AccessKey::full_access())
        .code(wasm)
        .transact().await?;
    Ok(Account::from_secret_key(id, sk, worker))
}

fn read_wasm(name: &str) -> Vec<u8> {
    let opt = format!("../out/{}.wasm", name);
    let raw = format!("../target/wasm32-unknown-unknown/release/{}.wasm", name);
    std::fs::read(if std::path::Path::new(&opt).exists() { opt } else { raw }).unwrap()
}

#[tokio::test]
async fn launch_trade_graduate_to_rhea_harvest_claim() -> anyhow::Result<()> {
    if !std::path::Path::new("../fixtures/v2.ref-finance.near.wasm").exists() {
        eprintln!("no Rhea fixtures, skipping");
        return Ok(());
    }
    let worker = near_workspaces::sandbox().await?;
    let factory_wasm = read_wasm("launch_factory");
    let token_wasm = read_wasm("launch_token");
    let ref_wasm = std::fs::read("../fixtures/v2.ref-finance.near.wasm")?;
    let wrap_wasm = std::fs::read("../fixtures/wrap.near.wasm")?;

    let root = worker.root_account()?;
    let owner = root.create_subaccount("owner").initial_balance(NearToken::from_near(100)).transact().await?.into_result()?;
    let treasury = root.create_subaccount("treasury").initial_balance(NearToken::from_near(5)).transact().await?.into_result()?;
    let alice = root.create_subaccount("alice").initial_balance(NearToken::from_near(200)).transact().await?.into_result()?;
    let bob = root.create_subaccount("bob").initial_balance(NearToken::from_near(200)).transact().await?.into_result()?;
    let whale = root.create_subaccount("whale").initial_balance(NearToken::from_near(5_000)).transact().await?.into_result()?;

    // The exchange and wrapped NEAR, as on mainnet.
    let refx = spoon(&worker, "v2.ref-finance.near", &ref_wasm, 100 * NEAR).await?;
    let wrap = spoon(&worker, "wrap.near", &wrap_wasm, 100 * NEAR).await?;
    let ref_id = refx.id().clone();
    let wrap_id = wrap.id().clone();
    wrap.call(&wrap_id, "new").transact().await?.into_result()?;
    refx.call(&ref_id, "new").args_json(json!({ "owner_id": owner.id(), "boost_farm_id": owner.id(), "burrowland_id": owner.id(), "exchange_fee": 1600, "referral_fee": 400 })).gas(Gas::from_tgas(100)).transact().await?.into_result()?;

    let factory_acc = root.create_subaccount("pad").initial_balance(NearToken::from_near(20)).transact().await?.into_result()?;
    let factory: Contract = factory_acc.deploy(&factory_wasm).await?.into_result()?;
    factory.call("new").args_json(json!({ "owner": owner.id(), "treasury": treasury.id(), "launch_fee": (NEAR / 2).to_string(), "near_virtual_reserve": (1000 * NEAR).to_string() })).transact().await?.into_result()?;

    // Publish the coin code as a global contract.
    let hash = near_workspaces::types::CryptoHash(near_sdk::env::sha256_array(&token_wasm));
    let b64 = { use base64::Engine; base64::engine::general_purpose::STANDARD.encode(&token_wasm) };
    let r = owner.call(factory.id(), "publish_code")
        .args_json(json!({ "version": "0.2.0", "code_hash": hash.to_string(), "code": b64 }))
        .deposit(NearToken::from_near(60)).gas(Gas::from_tgas(300)).transact().await?;
    assert!(r.is_success(), "publish: {:?}", r.failures());
    let cfg: Value = factory.view("get_config").await?.json()?;
    assert_eq!(cfg["current_version"]["version"], "0.2.0");

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

    // Bob buys 10 NEAR, sells half, claims.
    let r = bob.call(&coin, "buy").args_json(json!({ "min_out": null, "for_account": null })).deposit(NearToken::from_near(10)).gas(Gas::from_tgas(100)).transact().await?;
    assert!(r.is_success(), "buy: {:?}", r.failures());
    let bal = y(&holder(&coin, &worker, bob.id()).await["balance"]);
    let r = bob.call(&coin, "sell").args_json(json!({ "amount": (bal / 2).to_string(), "min_out": null })).gas(Gas::from_tgas(100)).transact().await?;
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

    // Anyone opens the pool on Rhea. A NEAR coin needs no deposit.
    let r = bob.call(&coin, "open_pool").gas(Gas::from_tgas(300)).transact().await?;
    assert!(r.is_success(), "open: {:?}", r.failures());
    println!("open_pool gas: {} TGas, logs: {:?}", r.total_gas_burnt.as_tgas(), r.logs());
    for o in r.receipt_outcomes() { if o.is_failure() { println!("RECEIPT FAILURE at {}: {:?}", o.executor_id, o.clone().into_result().err()); } }
    let i = info(&coin, &worker).await;
    assert_eq!(i["phase"], "Pool", "info: {}", i);
    let pool_id = i["pool_id"].as_u64().expect("pool id");
    assert!(y(&i["lp_shares"]) > 0);
    assert!(y(&i["burned"]) > 0, "pending buyback burned on open");
    assert!(y(&i["liquidity_added"]) > 0);
    let pool: Value = worker.view(&ref_id, "get_pool").args_json(json!({ "pool_id": pool_id })).await?.json()?;
    assert_eq!(pool["token_account_ids"][0], coin.as_str());
    assert_eq!(pool["token_account_ids"][1], wrap_id.as_str());
    assert_eq!(y(&pool["amounts"][0]), y(&i["pool_tokens"]));
    assert_eq!(y(&pool["amounts"][1]), y(&i["pool_pair"]));
    assert!(y(&pool["amounts"][1]) > 1_999 * NEAR);
    let shares = y(&worker.view(&ref_id, "mft_balance_of").args_json(json!({ "token_id": format!(":{}", pool_id), "account_id": coin })).await?.json()?);
    assert_eq!(shares, y(&i["lp_shares"]), "the coin owns the LP");
    // The curve is closed.
    let r = bob.call(&coin, "buy").args_json(json!({ "min_out": null, "for_account": null })).deposit(NearToken::from_near(1)).gas(Gas::from_tgas(100)).transact().await?;
    assert!(r.is_failure(), "graduated: no curve buys");

    // Bob buys on Rhea: wrap 20 NEAR, instant swap. 3% of the tokens stay as tax.
    bob.call(&wrap_id, "storage_deposit").args_json(json!({ "account_id": bob.id(), "registration_only": true })).deposit(NearToken::from_millinear(2)).transact().await?.into_result()?;
    bob.call(&wrap_id, "near_deposit").deposit(NearToken::from_near(20)).gas(Gas::from_tgas(30)).transact().await?.into_result()?;
    let bob_before = y(&holder(&coin, &worker, bob.id()).await["balance"]);
    let msg = json!({ "force": 0, "actions": [{ "pool_id": pool_id, "token_in": wrap_id, "token_out": coin, "amount_in": (20 * NEAR).to_string(), "min_amount_out": "0" }] }).to_string();
    let r = bob.call(&wrap_id, "ft_transfer_call").args_json(json!({ "receiver_id": ref_id, "amount": (20 * NEAR).to_string(), "msg": msg })).deposit(NearToken::from_yoctonear(1)).gas(Gas::from_tgas(180)).transact().await?;
    assert!(r.is_success(), "rhea buy: {:?}", r.failures());
    let i = info(&coin, &worker).await;
    let tax1 = y(&i["tax_tokens"]);
    assert!(tax1 > 0, "buy tax collected in tokens");
    let bob_after = y(&holder(&coin, &worker, bob.id()).await["balance"]);
    let got = bob_after - bob_before;
    // 3% of the gross was kept: got = 97% of gross, tax = 3%.
    assert!((got * 3 / 97).abs_diff(tax1) <= 1, "tax {} vs {}", tax1, got * 3 / 97);

    // Bob sells a third on Rhea through ft_transfer_call: sell tax stays.
    let sell_amount = bob_after / 3;
    let msg = json!({ "force": 0, "actions": [{ "pool_id": pool_id, "token_in": coin, "token_out": wrap_id, "amount_in": (sell_amount - sell_amount * 3 / 100).to_string(), "min_amount_out": "0" }] }).to_string();
    let w0 = ft_balance(&wrap_id, &worker, bob.id()).await;
    let r = bob.call(&coin, "ft_transfer_call").args_json(json!({ "receiver_id": ref_id, "amount": sell_amount.to_string(), "msg": msg })).deposit(NearToken::from_yoctonear(1)).gas(Gas::from_tgas(180)).transact().await?;
    assert!(r.is_success(), "rhea sell: {:?}", r.failures());
    let w1 = ft_balance(&wrap_id, &worker, bob.id()).await;
    assert!(w1 > w0, "bob got wNEAR for the sale");
    let i = info(&coin, &worker).await;
    assert_eq!(y(&i["tax_tokens"]), tax1 + sell_amount * 3 / 100);
    assert_eq!(y(&holder(&coin, &worker, bob.id()).await["balance"]), bob_after - sell_amount);
    let tax_total = y(&i["tax_tokens"]);
    assert!(tax_total >= 1_000 * ONE, "enough to harvest: {}", tax_total);

    // Harvest: burn 20% of the creator's 80%, sell the rest on Rhea, divide.
    let t0 = treasury.view_account().await?.balance.as_yoctonear();
    let div0 = y(&i["dividends_total"]);
    let creator0 = y(&holder(&coin, &worker, alice.id()).await["credit"]);
    let burned0 = y(&i["burned"]);
    let r = bob.call(&coin, "harvest").gas(Gas::from_tgas(300)).transact().await?;
    assert!(r.is_success(), "harvest: {:?}", r.failures());
    println!("harvest gas: {} TGas, logs: {:?}", r.total_gas_burnt.as_tgas(), r.logs());
    let i = info(&coin, &worker).await;
    assert_eq!(y(&i["tax_tokens"]), 0);
    assert_eq!(i["harvest"]["step"], 0);
    assert_eq!(i["harvest"]["lock_until"], 0);
    assert_eq!(y(&i["burned"]) - burned0, (tax_total - tax_total / 5) / 5, "burn share burned");
    let t1 = treasury.view_account().await?.balance.as_yoctonear();
    assert!(t1 > t0, "the platform's share arrived in NEAR: {} -> {}", t0, t1);
    assert!(y(&i["dividends_total"]) > div0, "dividends paid");
    assert!(y(&holder(&coin, &worker, alice.id()).await["credit"]) > creator0, "creator credited");
    assert!(y(&i["liquidity_added"]) > 0);
    let shares2 = y(&worker.view(&ref_id, "mft_balance_of").args_json(json!({ "token_id": format!(":{}", pool_id), "account_id": coin })).await?.json()?);
    assert!(shares2 > shares, "the liquidity share grew the LP: {} -> {}", shares, shares2);
    // Bob claims his dividends in NEAR.
    let h = holder(&coin, &worker, bob.id()).await;
    assert!(y(&h["claimable_dividends"]) > 0);
    let b0 = bob.view_account().await?.balance.as_yoctonear();
    let r = bob.call(&coin, "claim").gas(Gas::from_tgas(50)).transact().await?;
    assert!(r.is_success(), "claim: {:?}", r.failures());
    assert!(bob.view_account().await?.balance.as_yoctonear() > b0);
    // A second harvest with nothing collected is refused.
    let r = bob.call(&coin, "harvest").gas(Gas::from_tgas(300)).transact().await?;
    assert!(r.is_failure());

    // Admin: a quarter of the LP shares to the treasury.
    let r = owner.call(factory.id(), "coin_collect_liquidity").args_json(json!({ "id": 1, "bps": 2500, "to": treasury.id() })).deposit(NearToken::from_millinear(10)).gas(Gas::from_tgas(150)).transact().await?;
    assert!(r.is_success(), "collect lp: {:?}", r.failures());
    let ts = y(&worker.view(&ref_id, "mft_balance_of").args_json(json!({ "token_id": format!(":{}", pool_id), "account_id": treasury.id() })).await?.json()?);
    assert_eq!(ts, shares2 / 4, "treasury holds a quarter of the LP");
    assert_eq!(y(&info(&coin, &worker).await["lp_collected"]), ts);
    // Only the owner.
    let r = alice.call(factory.id(), "coin_collect_liquidity").args_json(json!({ "id": 1, "bps": 2500, "to": alice.id() })).deposit(NearToken::from_millinear(10)).gas(Gas::from_tgas(150)).transact().await?;
    assert!(r.is_failure());
    // The treasury can remove its liquidity on Rhea (needs a Rhea storage account).
    treasury.call(&ref_id, "storage_deposit").args_json(json!({ "account_id": treasury.id(), "registration_only": false })).deposit(NearToken::from_millinear(100)).gas(Gas::from_tgas(30)).transact().await?.into_result()?;
    treasury.call(&ref_id, "register_tokens").args_json(json!({ "token_ids": [coin, wrap_id] })).deposit(NearToken::from_yoctonear(1)).gas(Gas::from_tgas(30)).transact().await?.into_result()?;
    let r = treasury.call(&ref_id, "remove_liquidity").args_json(json!({ "pool_id": pool_id, "shares": ts.to_string(), "min_amounts": ["0", "0"] })).deposit(NearToken::from_yoctonear(1)).gas(Gas::from_tgas(100)).transact().await?;
    assert!(r.is_success(), "remove: {:?}", r.failures());
    let out: Vec<String> = r.json()?;
    assert!(out[1].parse::<u128>()? > 400 * NEAR, "a quarter of the pool's NEAR: {}", out[1]);

    // Admin: owner re-points creator fees; a stranger cannot pause.
    let r = owner.call(factory.id(), "coin_set_fee_wallet").args_json(json!({ "id": 1, "fee_wallet": bob.id(), "reason": "takeover" })).gas(Gas::from_tgas(50)).transact().await?;
    assert!(r.is_success(), "takeover: {:?}", r.failures());
    assert_eq!(info(&coin, &worker).await["fee_wallet"], bob.id().as_str());
    let r = alice.call(factory.id(), "set_paused").args_json(json!({ "paused": true })).transact().await?;
    assert!(r.is_failure());

    // ---- A coin paired with a NEP-141 token: wrapped NEAR stands in for a bridged stock. ----
    let r = owner.call(factory.id(), "set_pair").args_json(json!({
        "key": "WNEAR", "asset": { "Token": { "account_id": wrap_id, "symbol": "wNEAR", "decimals": 24 } },
        "name": "Wrapped NEAR", "virtual_reserve": (100 * NEAR).to_string(), "enabled": true
    })).transact().await?;
    assert!(r.is_success(), "set_pair: {:?}", r.failures());
    let params = json!({
        "name": "Wrapped Fan", "symbol": "fan", "icon": null, "description": "paired with wNEAR",
        "links": { "website": null, "x": null, "telegram": null }, "pair": "WNEAR",
        "buy_tax_bps": 500, "sell_tax_bps": 500,
        "split": { "creator_bps": 0, "dividends_bps": 10000, "burn_bps": 0, "liquidity_bps": 0 },
        "fee_wallet": null, "initial_buy": null
    });
    let r = whale.call(factory.id(), "create").args_json(json!({ "params": params })).deposit(NearToken::from_near(2)).gas(Gas::from_tgas(300)).transact().await?;
    assert!(r.is_success(), "create 2: {:?}", r.failures());
    let coin2: AccountId = format!("c2.{}", factory.id()).parse()?;
    let i2 = info(&coin2, &worker).await;
    assert_eq!(i2["pair"]["Token"]["account_id"], wrap_id.as_str());
    // The whale wraps 400 NEAR, registers on coin 2, and pays in wNEAR through ft_transfer_call.
    whale.call(&wrap_id, "storage_deposit").args_json(json!({ "account_id": whale.id(), "registration_only": true })).deposit(NearToken::from_millinear(2)).transact().await?.into_result()?;
    whale.call(&wrap_id, "near_deposit").deposit(NearToken::from_near(400)).gas(Gas::from_tgas(30)).transact().await?.into_result()?;
    whale.call(&coin2, "storage_deposit").args_json(json!({ "account_id": whale.id(), "registration_only": true })).deposit(NearToken::from_millinear(10)).transact().await?.into_result()?;
    let pay = 50 * NEAR;
    let r = whale.call(&wrap_id, "ft_transfer_call").args_json(json!({ "receiver_id": coin2, "amount": pay.to_string(), "msg": "" })).deposit(NearToken::from_yoctonear(1)).gas(Gas::from_tgas(150)).transact().await?;
    assert!(r.is_success(), "pair buy: {:?}", r.failures());
    let h = holder(&coin2, &worker, whale.id()).await;
    assert!(y(&h["balance"]) > 0, "paid in the pair");
    assert_eq!(y(&info(&coin2, &worker).await["raised"]), pay - pay * 5 / 100);
    // Fill the curve of coin 2 (graduates at 200 wNEAR) and open its pool: 0.2 NEAR attached.
    let r = whale.call(&wrap_id, "ft_transfer_call").args_json(json!({ "receiver_id": coin2, "amount": (250 * NEAR).to_string(), "msg": "" })).deposit(NearToken::from_yoctonear(1)).gas(Gas::from_tgas(150)).transact().await?;
    assert!(r.is_success(), "fill 2: {:?}", r.failures());
    let i2 = info(&coin2, &worker).await;
    assert_eq!(i2["phase"], "Graduating", "{}", i2);
    assert!(y(&holder(&coin2, &worker, whale.id()).await["credit"]) > 0, "the overshoot is a credit in wNEAR");
    let r = whale.call(&coin2, "open_pool").gas(Gas::from_tgas(300)).transact().await?;
    assert!(r.is_failure(), "a token coin needs the storage deposit");
    let r = whale.call(&coin2, "open_pool").deposit(NearToken::from_millinear(200)).gas(Gas::from_tgas(300)).transact().await?;
    assert!(r.is_success(), "open 2: {:?}", r.failures());
    println!("open_pool 2 gas: {} TGas", r.total_gas_burnt.as_tgas());
    for o in r.receipt_outcomes() { if o.is_failure() { println!("RECEIPT FAILURE at {}: {:?}", o.executor_id, o.clone().into_result().err()); } }
    let i2 = info(&coin2, &worker).await;
    assert_eq!(i2["phase"], "Pool", "{}", i2);
    let pool2 = i2["pool_id"].as_u64().unwrap();
    let p: Value = worker.view(&ref_id, "get_pool").args_json(json!({ "pool_id": pool2 })).await?.json()?;
    assert_eq!(p["token_account_ids"][1], wrap_id.as_str());
    assert_eq!(y(&p["amounts"][1]), 200 * NEAR, "the whole raise seeds the pool");
    // Whale sells some FAN on Rhea for wNEAR (5% tax), then harvests: dividends land in wNEAR.
    let fan = y(&holder(&coin2, &worker, whale.id()).await["balance"]);
    let sell = fan / 10;
    let msg = json!({ "force": 0, "actions": [{ "pool_id": pool2, "token_in": coin2, "token_out": wrap_id, "amount_in": (sell - sell * 5 / 100).to_string(), "min_amount_out": "0" }] }).to_string();
    let r = whale.call(&coin2, "ft_transfer_call").args_json(json!({ "receiver_id": ref_id, "amount": sell.to_string(), "msg": msg })).deposit(NearToken::from_yoctonear(1)).gas(Gas::from_tgas(200)).transact().await?;
    assert!(r.is_success(), "rhea sell 2: {:?}", r.failures());
    let i2 = info(&coin2, &worker).await;
    assert_eq!(y(&i2["tax_tokens"]), sell * 5 / 100);
    // The treasury is registered on wNEAR, so the platform's share can be paid on the spot.
    treasury.call(&wrap_id, "storage_deposit").args_json(json!({ "account_id": treasury.id(), "registration_only": true })).deposit(NearToken::from_millinear(2)).transact().await?.into_result()?;
    let tr0 = ft_balance(&wrap_id, &worker, treasury.id()).await;
    let r = whale.call(&coin2, "harvest").gas(Gas::from_tgas(300)).transact().await?;
    assert!(r.is_success(), "harvest 2: {:?}", r.failures());
    println!("harvest 2 gas: {} TGas", r.total_gas_burnt.as_tgas());
    for o in r.receipt_outcomes() { if o.is_failure() { println!("RECEIPT FAILURE at {}: {:?}", o.executor_id, o.clone().into_result().err()); } }
    let i2 = info(&coin2, &worker).await;
    assert_eq!(y(&i2["tax_tokens"]), 0);
    assert_eq!(i2["harvest"]["step"], 0);
    assert!(y(&i2["dividends_total"]) > 0, "dividends in wNEAR");
    let tr1 = ft_balance(&wrap_id, &worker, treasury.id()).await;
    assert!(tr1 > tr0, "treasury paid in the pair: {} -> {}", tr0, tr1);
    // The curve-phase platform shares could not be delivered (the treasury was
    // not registered on wNEAR then): 20% of the 15 wNEAR of tax waits as a credit
    // the factory collects for the treasury.
    assert_eq!(y(&i2["platform_credit"]), 3 * NEAR);
    let r = bob.call(factory.id(), "collect_platform").args_json(json!({ "id": 2 })).gas(Gas::from_tgas(50)).transact().await?;
    assert!(r.is_success(), "collect_platform: {:?}", r.failures());
    assert_eq!(y(&info(&coin2, &worker).await["platform_credit"]), 0);
    assert_eq!(ft_balance(&wrap_id, &worker, treasury.id()).await, tr1 + 3 * NEAR);
    // Whale claims the overshoot credit plus dividends, in wNEAR.
    let s0 = ft_balance(&wrap_id, &worker, whale.id()).await;
    let r = whale.call(&coin2, "claim").gas(Gas::from_tgas(50)).transact().await?;
    assert!(r.is_success(), "claim 2: {:?}", r.failures());
    assert!(ft_balance(&wrap_id, &worker, whale.id()).await > s0, "paid in wNEAR");
    assert_eq!(y(&holder(&coin2, &worker, whale.id()).await["credit"]), 0);
    Ok(())
}
