//! Probes the live Rhea (Ref) exchange wasm in a sandbox to pin down its
//! interface before the coin contract is written against it. Needs
//! ../fixtures/v2.ref-finance.near.wasm and ../fixtures/wrap.near.wasm,
//! pulled from mainnet with `view_code`.
use near_workspaces::types::{AccessKey, AccountDetailsPatch, Gas, KeyType, NearToken, SecretKey};
use near_workspaces::{Account, AccountId};
use serde_json::{json, Value};

const NEAR: u128 = 1_000_000_000_000_000_000_000_000;
const ONE: u128 = 1_000_000_000_000_000_000;

async fn spoon(worker: &near_workspaces::Worker<near_workspaces::network::Sandbox>, id: &str, wasm: &[u8], near: u128) -> anyhow::Result<Account> {
    let id: AccountId = id.parse()?;
    let sk = SecretKey::from_random(KeyType::ED25519);
    worker.patch(&id)
        .account(AccountDetailsPatch::default().balance(NearToken::from_yoctonear(near)).locked(NearToken::from_yoctonear(0)).storage_usage(0))
        .access_key(sk.public_key(), AccessKey::full_access())
        .code(wasm)
        .transact().await?;
    Ok(Account::from_secret_key(id, sk, worker))
}

fn y(v: &Value) -> u128 { v.as_str().unwrap().parse().unwrap() }

#[tokio::test]
async fn probe_rhea() -> anyhow::Result<()> {
    if !std::path::Path::new("../fixtures/v2.ref-finance.near.wasm").exists() { eprintln!("no fixtures, skipping"); return Ok(()); }
    let worker = near_workspaces::sandbox().await?;
    let ref_wasm = std::fs::read("../fixtures/v2.ref-finance.near.wasm")?;
    let wrap_wasm = std::fs::read("../fixtures/wrap.near.wasm")?;
    let token_wasm = std::fs::read("../out/launch_token.wasm")?;

    let root = worker.root_account()?;
    let alice = root.create_subaccount("alice").initial_balance(NearToken::from_near(500)).transact().await?.into_result()?;
    let bob = root.create_subaccount("bob").initial_balance(NearToken::from_near(100)).transact().await?.into_result()?;
    let refx = spoon(&worker, "v2.ref-finance.near", &ref_wasm, 100 * NEAR).await?;
    let wrap = spoon(&worker, "wrap.near", &wrap_wasm, 100 * NEAR).await?;
    let ref_id = refx.id().clone();
    let wrap_id = wrap.id().clone();

    let r = wrap.call(&wrap_id, "new").transact().await?;
    println!("wrap.new: {} {:?}", r.is_success(), r.failures());

    // Find the init signature.
    let cands = vec![
        json!({ "owner_id": alice.id(), "boost_farm_id": alice.id(), "burrowland_id": alice.id(), "exchange_fee": 1600, "referral_fee": 400 }),
        json!({ "owner_id": alice.id(), "exchange_fee": 1600, "referral_fee": 400 }),
        json!({ "owner_id": alice.id(), "boost_farm_id": alice.id(), "burrowland_id": alice.id(), "wnear_id": wrap_id, "exchange_fee": 1600, "referral_fee": 400 }),
        json!({ "owner_id": alice.id(), "boost_farm_id": alice.id(), "burrowland_id": alice.id(), "exchange_fee": 1600, "referral_fee": 400, "wnear_id": wrap_id }),
    ];
    for (i, c) in cands.iter().enumerate() {
        let r = refx.call(&ref_id, "new").args_json(c).gas(Gas::from_tgas(100)).transact().await?;
        println!("ref.new cand {}: {} {:?}", i, r.is_success(), r.failures());
        if r.is_success() { break; }
    }
    let meta: Value = worker.view(&ref_id, "metadata").await?.json()?;
    println!("ref metadata: {}", meta);

    // A coin: alice plays the factory.
    let coin_acc = root.create_subaccount("coin").initial_balance(NearToken::from_near(5)).transact().await?.into_result()?;
    let coin = coin_acc.deploy(&token_wasm).await?.into_result()?;
    let coin_id = coin.id().clone();
    let r = alice.call(&coin_id, "new").args_json(json!({
        "factory": alice.id(), "treasury": bob.id(), "name": "Probe", "symbol": "PRB", "icon": null, "description": "",
        "links": { "website": null, "x": null, "telegram": null }, "creator": alice.id(), "fee_wallet": bob.id(),
        "pair": "Near", "virtual_reserve": (1000 * NEAR).to_string(), "buy_tax_bps": 100, "sell_tax_bps": 100,
        "split": { "creator_bps": 0, "dividends_bps": 10000, "burn_bps": 0, "liquidity_bps": 0 }
    })).gas(Gas::from_tgas(100)).transact().await?;
    println!("coin.new: {} {:?}", r.is_success(), r.failures());
    let r = alice.call(&coin_id, "buy").args_json(json!({ "min_out": null, "for_account": null })).deposit(NearToken::from_near(100)).gas(Gas::from_tgas(100)).transact().await?;
    println!("buy: {} {:?}", r.is_success(), r.failures());
    let bal: Value = worker.view(&coin_id, "ft_balance_of").args_json(json!({ "account_id": alice.id() })).await?.json()?;
    println!("alice coin balance: {}", y(&bal) / ONE);

    // Register ref on the coin and bob too.
    for a in [&ref_id, bob.id()] {
        let r = alice.call(&coin_id, "storage_deposit").args_json(json!({ "account_id": a, "registration_only": true })).deposit(NearToken::from_millinear(10)).transact().await?;
        println!("coin.storage_deposit({}): {}", a, r.is_success());
    }
    // wNEAR for alice and ref.
    for a in [alice.id(), &ref_id] {
        let r = alice.call(&wrap_id, "storage_deposit").args_json(json!({ "account_id": a, "registration_only": true })).deposit(NearToken::from_millinear(2)).transact().await?;
        println!("wrap.storage_deposit({}): {}", a, r.is_success());
    }
    let r = alice.call(&wrap_id, "near_deposit").deposit(NearToken::from_near(50)).gas(Gas::from_tgas(30)).transact().await?;
    println!("near_deposit: {}", r.is_success());

    // Ref account and pool.
    let r = alice.call(&ref_id, "storage_deposit").args_json(json!({ "account_id": alice.id(), "registration_only": false })).deposit(NearToken::from_millinear(100)).gas(Gas::from_tgas(30)).transact().await?;
    println!("ref.storage_deposit(0.1): {} {:?}", r.is_success(), r.failures());
    let r = alice.call(&ref_id, "register_tokens").args_json(json!({ "token_ids": [coin_id, wrap_id] })).deposit(NearToken::from_yoctonear(1)).gas(Gas::from_tgas(30)).transact().await?;
    println!("ref.register_tokens: {} {:?}", r.is_success(), r.failures());
    let before = alice.view_account().await?.balance.as_yoctonear();
    let r = alice.call(&ref_id, "add_simple_pool").args_json(json!({ "tokens": [coin_id, wrap_id], "fee": 30 })).deposit(NearToken::from_millinear(100)).gas(Gas::from_tgas(50)).transact().await?;
    println!("ref.add_simple_pool: {} {:?} gas {}", r.is_success(), r.failures(), r.total_gas_burnt.as_tgas());
    let pool_id: u64 = r.json()?;
    let after = alice.view_account().await?.balance.as_yoctonear();
    println!("pool_id {} cost {} mNEAR", pool_id, (before as i128 - after as i128) / (NEAR as i128 / 1000));

    // Deposit both tokens into ref, then add liquidity.
    let r = alice.call(&coin_id, "ft_transfer_call").args_json(json!({ "receiver_id": ref_id, "amount": (1_000_000 * ONE).to_string(), "msg": "" })).deposit(NearToken::from_yoctonear(1)).gas(Gas::from_tgas(100)).transact().await?;
    println!("deposit coin: {} {:?} gas {}", r.is_success(), r.failures(), r.total_gas_burnt.as_tgas());
    let r = alice.call(&wrap_id, "ft_transfer_call").args_json(json!({ "receiver_id": ref_id, "amount": (40 * NEAR).to_string(), "msg": "" })).deposit(NearToken::from_yoctonear(1)).gas(Gas::from_tgas(100)).transact().await?;
    println!("deposit wnear: {} {:?} gas {}", r.is_success(), r.failures(), r.total_gas_burnt.as_tgas());
    let deps: Value = worker.view(&ref_id, "get_deposits").args_json(json!({ "account_id": alice.id() })).await?.json()?;
    println!("deposits: {}", deps);
    let before = alice.view_account().await?.balance.as_yoctonear();
    let r = alice.call(&ref_id, "add_liquidity").args_json(json!({ "pool_id": pool_id, "amounts": [(1_000_000 * ONE).to_string(), (40 * NEAR).to_string()], "min_amounts": null })).deposit(NearToken::from_millinear(10)).gas(Gas::from_tgas(100)).transact().await?;
    println!("add_liquidity: {} {:?} gas {} logs {:?}", r.is_success(), r.failures(), r.total_gas_burnt.as_tgas(), r.logs());
    let shares_ret: Result<Value, _> = r.json();
    println!("add_liquidity return: {:?}", shares_ret);
    let after = alice.view_account().await?.balance.as_yoctonear();
    println!("add_liquidity cost {} mNEAR", (before as i128 - after as i128) / (NEAR as i128 / 1000));
    let pool: Value = worker.view(&ref_id, "get_pool").args_json(json!({ "pool_id": pool_id })).await?.json()?;
    println!("pool: {}", pool);
    let shares: Value = worker.view(&ref_id, "mft_balance_of").args_json(json!({ "token_id": format!(":{}", pool_id), "account_id": alice.id() })).await?.json()?;
    println!("alice shares: {}", shares);

    // Bob: instant swap wNEAR -> coin, unregistered on ref.
    let r = bob.call(&wrap_id, "storage_deposit").args_json(json!({ "account_id": bob.id(), "registration_only": true })).deposit(NearToken::from_millinear(2)).transact().await?;
    assert!(r.is_success());
    let r = bob.call(&wrap_id, "near_deposit").deposit(NearToken::from_near(5)).gas(Gas::from_tgas(30)).transact().await?;
    assert!(r.is_success());
    let msg = json!({ "force": 0, "actions": [{ "pool_id": pool_id, "token_in": wrap_id, "token_out": coin_id, "amount_in": (1 * NEAR).to_string(), "min_amount_out": "0" }] }).to_string();
    let r = bob.call(&wrap_id, "ft_transfer_call").args_json(json!({ "receiver_id": ref_id, "amount": (1 * NEAR).to_string(), "msg": msg })).deposit(NearToken::from_yoctonear(1)).gas(Gas::from_tgas(180)).transact().await?;
    println!("bob instant swap: {} {:?} gas {} logs {:?}", r.is_success(), r.failures(), r.total_gas_burnt.as_tgas(), r.logs());
    let bal: Value = worker.view(&coin_id, "ft_balance_of").args_json(json!({ "account_id": bob.id() })).await?.json()?;
    println!("bob coin balance: {}", y(&bal) / ONE);

    // Bob sells back: instant swap coin -> wNEAR.
    let msg = json!({ "force": 0, "actions": [{ "pool_id": pool_id, "token_in": coin_id, "token_out": wrap_id, "amount_in": (y(&bal) / 2).to_string(), "min_amount_out": "0" }] }).to_string();
    let r = bob.call(&coin_id, "ft_transfer_call").args_json(json!({ "receiver_id": ref_id, "amount": (y(&bal) / 2).to_string(), "msg": msg })).deposit(NearToken::from_yoctonear(1)).gas(Gas::from_tgas(180)).transact().await?;
    println!("bob sell swap: {} {:?} gas {} logs {:?}", r.is_success(), r.failures(), r.total_gas_burnt.as_tgas(), r.logs());
    let wb: Value = worker.view(&wrap_id, "ft_balance_of").args_json(json!({ "account_id": bob.id() })).await?.json()?;
    println!("bob wnear: {}", y(&wb) as f64 / NEAR as f64);

    // The contract path: deposit, swap, withdraw as a registered account (alice).
    let r = alice.call(&coin_id, "ft_transfer_call").args_json(json!({ "receiver_id": ref_id, "amount": (10_000 * ONE).to_string(), "msg": "" })).deposit(NearToken::from_yoctonear(1)).gas(Gas::from_tgas(100)).transact().await?;
    assert!(r.is_success());
    let r = alice.call(&ref_id, "swap").args_json(json!({ "actions": [{ "pool_id": pool_id, "token_in": coin_id, "token_out": wrap_id, "amount_in": (10_000 * ONE).to_string(), "min_amount_out": "0" }], "referral_id": null })).deposit(NearToken::from_yoctonear(1)).gas(Gas::from_tgas(100)).transact().await?;
    println!("swap: {} {:?} gas {} ret {:?}", r.is_success(), r.failures(), r.total_gas_burnt.as_tgas(), r.clone().json::<Value>());
    let out = r.json::<Value>().map(|v| y(&v)).unwrap_or(0);
    let wb0: Value = worker.view(&wrap_id, "ft_balance_of").args_json(json!({ "account_id": alice.id() })).await?.json()?;
    let r = alice.call(&ref_id, "withdraw").args_json(json!({ "token_id": wrap_id, "amount": out.to_string(), "unregister": false, "skip_unwrap_near": true })).deposit(NearToken::from_yoctonear(1)).gas(Gas::from_tgas(100)).transact().await?;
    println!("withdraw: {} {:?} gas {}", r.is_success(), r.failures(), r.total_gas_burnt.as_tgas());
    let wb1: Value = worker.view(&wrap_id, "ft_balance_of").args_json(json!({ "account_id": alice.id() })).await?.json()?;
    println!("alice wnear delta: {} (expected {})", y(&wb1) - y(&wb0), out);
    let n0 = alice.view_account().await?.balance.as_yoctonear();
    let r = alice.call(&ref_id, "withdraw").args_json(json!({ "token_id": wrap_id, "amount": "0", "unregister": false, "skip_unwrap_near": false })).deposit(NearToken::from_yoctonear(1)).gas(Gas::from_tgas(100)).transact().await?;
    println!("withdraw 0 unwrap: {} {:?}", r.is_success(), r.failures());
    let _ = n0;

    // LP share ops.
    let has: Value = worker.view(&ref_id, "mft_has_registered").args_json(json!({ "token_id": format!(":{}", pool_id), "account_id": bob.id() })).await?.json()?;
    println!("bob mft_has_registered: {}", has);
    let r = alice.call(&ref_id, "mft_register").args_json(json!({ "token_id": format!(":{}", pool_id), "account_id": bob.id() })).deposit(NearToken::from_millinear(10)).gas(Gas::from_tgas(30)).transact().await?;
    println!("mft_register bob: {} {:?}", r.is_success(), r.failures());
    let r = alice.call(&ref_id, "mft_register").args_json(json!({ "token_id": format!(":{}", pool_id), "account_id": bob.id() })).deposit(NearToken::from_millinear(10)).gas(Gas::from_tgas(30)).transact().await?;
    println!("mft_register bob again: {} {:?}", r.is_success(), r.failures());
    let half = y(&shares) / 2;
    let r = alice.call(&ref_id, "mft_transfer").args_json(json!({ "token_id": format!(":{}", pool_id), "receiver_id": bob.id(), "amount": half.to_string(), "memo": null })).deposit(NearToken::from_yoctonear(1)).gas(Gas::from_tgas(30)).transact().await?;
    println!("mft_transfer: {} {:?}", r.is_success(), r.failures());
    let bs: Value = worker.view(&ref_id, "mft_balance_of").args_json(json!({ "token_id": format!(":{}", pool_id), "account_id": bob.id() })).await?.json()?;
    println!("bob shares: {}", bs);
    // Bob removes liquidity: needs a ref storage account?
    let r = bob.call(&ref_id, "remove_liquidity").args_json(json!({ "pool_id": pool_id, "shares": half.to_string(), "min_amounts": ["0", "0"] })).deposit(NearToken::from_yoctonear(1)).gas(Gas::from_tgas(100)).transact().await?;
    println!("bob remove_liquidity (no storage): {} {:?}", r.is_success(), r.failures());
    let r = bob.call(&ref_id, "storage_deposit").args_json(json!({ "account_id": bob.id(), "registration_only": false })).deposit(NearToken::from_millinear(100)).gas(Gas::from_tgas(30)).transact().await?;
    assert!(r.is_success());
    let r = bob.call(&ref_id, "register_tokens").args_json(json!({ "token_ids": [coin_id, wrap_id] })).deposit(NearToken::from_yoctonear(1)).gas(Gas::from_tgas(30)).transact().await?;
    assert!(r.is_success(), "{:?}", r.failures());
    let r = bob.call(&ref_id, "remove_liquidity").args_json(json!({ "pool_id": pool_id, "shares": half.to_string(), "min_amounts": ["0", "0"] })).deposit(NearToken::from_yoctonear(1)).gas(Gas::from_tgas(100)).transact().await?;
    println!("bob remove_liquidity: {} {:?} ret {:?}", r.is_success(), r.failures(), r.clone().json::<Value>());
    let deps: Value = worker.view(&ref_id, "get_deposits").args_json(json!({ "account_id": bob.id() })).await?.json()?;
    println!("bob deposits after remove: {}", deps);
    Ok(())
}
