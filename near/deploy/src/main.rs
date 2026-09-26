//! Deploys the launchpad. Reads the signer from the environment and never
//! prints it.
//!
//!   NEAR_NETWORK=mainnet|testnet NEAR_ACCOUNT_ID=owner.near NEAR_SECRET_KEY=ed25519:... \
//!     [NEAR_FACTORY=pad.near] [NEAR_RPC=https://...] cargo run -p launch-deploy -- <command>
//!
//! NEAR_ACCOUNT_ID signs. NEAR_FACTORY is the factory it talks to (default: the signer).
//!
//! Commands:
//!   name <new.near> <deposit_near>                 create a top-level .near account with the signer's key
//!   transfer <to> <near>                           send NEAR from the signer
//!   factory <owner> <treasury> <launch_fee_near>   deploy the factory wasm to NEAR_ACCOUNT_ID and init it
//!   redeploy                                       put new factory code on NEAR_ACCOUNT_ID, state untouched
//!   call <method> <json> [deposit_near]            any owner call on the factory (set_paused, set_current_version, ...)
//!   publish <version>                              publish out/launch_token.wasm as the coin code (burns ~30 NEAR from the factory's balance)
//!   pair <key> <token_account> <symbol> <decimals> <name> <virtual_reserve>   add a NEP-141 pair (reserve in whole units)
//!   balance [account]                              print an account's balance
//!   config                                         print the factory's config and pairs
use std::env;

use near_workspaces::types::{Gas, NearToken, SecretKey};
use near_workspaces::{Account, AccountId};
use serde_json::{json, Value};

const NEAR: u128 = 1_000_000_000_000_000_000_000_000;

fn near(v: f64) -> NearToken {
    NearToken::from_yoctonear(((v * 1_000_000.0) as u128) * NEAR / 1_000_000)
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let args: Vec<String> = env::args().skip(1).collect();
    let cmd = args.first().map(String::as_str).unwrap_or("config");
    let network = env::var("NEAR_NETWORK").unwrap_or_else(|_| "mainnet".into());
    let account_id: AccountId = env::var("NEAR_ACCOUNT_ID")?.parse()?;
    let rpc = env::var("NEAR_RPC").ok();
    // The factory the owner talks to. Defaults to the signer (for `factory`, which must deploy to itself).
    let factory: AccountId = match env::var("NEAR_FACTORY") { Ok(f) => f.parse()?, Err(_) => account_id.clone() };
    let dir = env::current_dir()?;
    let out = |f: &str| dir.join("out").join(f);

    macro_rules! with_worker {
        ($builder:expr) => {{
            let builder = $builder;
            let worker = match rpc.as_deref() { Some(r) => builder.rpc_addr(r).await?, None => builder.await? };
            let sk: SecretKey = env::var("NEAR_SECRET_KEY")?.parse()?;
            let me = Account::from_secret_key(account_id.clone(), sk.clone(), &worker);
            match cmd {
                "name" => {
                    let new_id: AccountId = args[1].parse()?;
                    let deposit: f64 = args.get(2).map(|s| s.parse()).transpose()?.unwrap_or(0.1);
                    let registrar: AccountId = if network == "testnet" { "testnet".parse()? } else { "near".parse()? };
                    let r = me.call(&registrar, "create_account")
                        .args_json(json!({ "new_account_id": new_id, "new_public_key": sk.public_key().to_string() }))
                        .deposit(near(deposit)).gas(Gas::from_tgas(30)).transact().await?;
                    println!("name {}: success={} {:?}", new_id, r.is_success(), r.failures());
                    return Ok(());
                }
                "transfer" => {
                    let to: AccountId = args[1].parse()?;
                    let amount: f64 = args[2].parse()?;
                    let r = me.transfer_near(&to, near(amount)).await?;
                    println!("transfer {} NEAR to {}: success={} {:?}", amount, to, r.is_success(), r.failures());
                    return Ok(());
                }
                "balance" => {
                    let id: AccountId = args.get(1).map(|s| s.parse()).transpose()?.unwrap_or(account_id.clone());
                    let v = worker.view_account(&id).await?;
                    println!("{}: {} NEAR (locked {}), {} bytes", id, v.balance.as_near() as f64 + (v.balance.as_yoctonear() % NEAR) as f64 / NEAR as f64, v.locked, v.storage_usage);
                    return Ok(());
                }
                "call" => {
                    // Any owner call on the factory: call <method> <json args> [deposit_near]
                    let method = args[1].clone();
                    let json: Value = serde_json::from_str(&args[2])?;
                    let deposit: f64 = args.get(3).map(|s| s.parse()).transpose()?.unwrap_or(0.0);
                    let r = me.call(&factory, &method).args_json(json).deposit(near(deposit)).gas(Gas::from_tgas(100)).transact().await?;
                    println!("{}: success={} {:?}", method, r.is_success(), r.failures());
                }
                "redeploy" => {
                    // New factory code on the same account; the state layout must be unchanged.
                    let wasm = std::fs::read(out("launch_factory.wasm"))?;
                    let r = me.deploy(&wasm).await?.into_result()?;
                    println!("redeployed factory to {} ({} bytes)", r.id(), wasm.len());
                }
                "factory" => {
                    let owner: AccountId = args[1].parse()?;
                    let treasury: AccountId = args[2].parse()?;
                    let fee: f64 = args[3].parse()?;
                    let wasm = std::fs::read(out("launch_factory.wasm"))?;
                    let r = me.deploy(&wasm).await?.into_result()?;
                    println!("deployed factory to {} ({} bytes)", r.id(), wasm.len());
                    let r = me.call(&account_id, "new")
                        .args_json(json!({ "owner": owner, "treasury": treasury, "launch_fee": near(fee).as_yoctonear().to_string(), "near_virtual_reserve": (1000 * NEAR).to_string() }))
                        .gas(Gas::from_tgas(50)).transact().await?;
                    println!("init: success={} {:?}", r.is_success(), r.failures());
                }
                "publish" => {
                    let version = args.get(1).cloned().unwrap_or_else(|| "0.1.0".into());
                    let code = std::fs::read(out("launch_token.wasm"))?;
                    let hash = near_workspaces::types::CryptoHash(near_sdk::env::sha256_array(&code));
                    let b64 = { use base64::Engine; base64::engine::general_purpose::STANDARD.encode(&code) };
                    println!("publishing {} bytes as version {} hash {} (burns {} NEAR from {})", code.len(), version, hash, code.len() as f64 / 10_000.0, factory);
                    let r = me.call(&factory, "publish_code")
                        .args_json(json!({ "version": version, "code_hash": hash.to_string(), "code": b64 }))
                        .gas(Gas::from_tgas(300)).transact().await?;
                    println!("publish: success={} {:?}", r.is_success(), r.failures());
                }
                "pair" => {
                    let key = &args[1]; let token: AccountId = args[2].parse()?; let symbol = &args[3];
                    let decimals: u8 = args[4].parse()?; let name = &args[5]; let reserve: f64 = args[6].parse()?;
                    let raw = ((reserve * 1_000_000.0) as u128) * 10u128.pow(decimals as u32) / 1_000_000;
                    let r = me.call(&factory, "set_pair")
                        .args_json(json!({ "key": key, "asset": { "Token": { "account_id": token, "symbol": symbol, "decimals": decimals } }, "name": name, "virtual_reserve": raw.to_string(), "enabled": true }))
                        .gas(Gas::from_tgas(30)).transact().await?;
                    println!("pair {}: success={} {:?}", key, r.is_success(), r.failures());
                }
                _ => {}
            }
            let cfg: Value = worker.view(&factory, "get_config").await?.json()?;
            let pairs: Value = worker.view(&factory, "list_pairs").await?.json()?;
            println!("config: {}", serde_json::to_string_pretty(&cfg)?);
            println!("pairs: {}", serde_json::to_string_pretty(&pairs)?);
        }};
    }

    if network == "testnet" {
        with_worker!(near_workspaces::testnet());
    } else {
        with_worker!(near_workspaces::mainnet());
    }
    Ok(())
}
