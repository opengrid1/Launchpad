//! Deploys the launchpad. Reads the signer from the environment and never
//! prints it.
//!
//!   NEAR_NETWORK=mainnet|testnet NEAR_ACCOUNT_ID=pad.near NEAR_SECRET_KEY=ed25519:... \
//!     cargo run -p launch-deploy -- <command>
//!
//! Commands:
//!   factory <owner> <treasury> <launch_fee_near>   deploy the factory wasm to NEAR_ACCOUNT_ID and init it
//!   publish <version>                              publish out/launch_token.wasm as the coin code (burns ~30 NEAR)
//!   pair <key> <token_account> <symbol> <decimals> <name> <virtual_reserve>   add a NEP-141 pair (reserve in whole units)
//!   config                                         print the factory's config and pairs
use std::env;

use near_workspaces::types::{Gas, NearToken, SecretKey};
use near_workspaces::{Account, AccountId};
use serde_json::{json, Value};

const NEAR: u128 = 1_000_000_000_000_000_000_000_000;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let args: Vec<String> = env::args().skip(1).collect();
    let cmd = args.first().map(String::as_str).unwrap_or("config");
    let network = env::var("NEAR_NETWORK").unwrap_or_else(|_| "mainnet".into());
    let account_id: AccountId = env::var("NEAR_ACCOUNT_ID")?.parse()?;
    let dir = env::current_dir()?;
    let out = |f: &str| dir.join("out").join(f);

    macro_rules! with_worker {
        ($worker:expr) => {{
            let worker = $worker;
            let sk: SecretKey = env::var("NEAR_SECRET_KEY")?.parse()?;
            let me = Account::from_secret_key(account_id.clone(), sk, &worker);
            match cmd {
                "factory" => {
                    let owner: AccountId = args[1].parse()?;
                    let treasury: AccountId = args[2].parse()?;
                    let fee: f64 = args[3].parse()?;
                    let wasm = std::fs::read(out("launch_factory.wasm"))?;
                    let r = me.deploy(&wasm).await?.into_result()?;
                    println!("deployed factory to {} ({} bytes)", r.id(), wasm.len());
                    let r = me.call(&account_id, "new")
                        .args_json(json!({ "owner": owner, "treasury": treasury, "launch_fee": ((fee * 1000.0) as u128 * NEAR / 1000).to_string(), "near_virtual_reserve": (1000 * NEAR).to_string() }))
                        .gas(Gas::from_tgas(50)).transact().await?;
                    println!("init: success={} {:?}", r.is_success(), r.failures());
                }
                "publish" => {
                    let version = args.get(1).cloned().unwrap_or_else(|| "0.1.0".into());
                    let code = std::fs::read(out("launch_token.wasm"))?;
                    let hash = near_workspaces::types::CryptoHash(near_sdk::env::sha256_array(&code));
                    let b64 = { use base64::Engine; base64::engine::general_purpose::STANDARD.encode(&code) };
                    let cost = NearToken::from_yoctonear(code.len() as u128 * 100_000_000_000_000_000_000 + 2 * NEAR);
                    println!("publishing {} bytes as version {} hash {} (deposit {})", code.len(), version, hash, cost);
                    let r = me.call(&account_id, "publish_code")
                        .args_json(json!({ "version": version, "code_hash": hash.to_string(), "code": b64 }))
                        .deposit(cost).gas(Gas::from_tgas(300)).transact().await?;
                    println!("publish: success={} {:?}", r.is_success(), r.failures());
                }
                "pair" => {
                    let key = &args[1]; let token: AccountId = args[2].parse()?; let symbol = &args[3];
                    let decimals: u8 = args[4].parse()?; let name = &args[5]; let reserve: f64 = args[6].parse()?;
                    let raw = ((reserve * 1_000_000.0) as u128) * 10u128.pow(decimals as u32) / 1_000_000;
                    let r = me.call(&account_id, "set_pair")
                        .args_json(json!({ "key": key, "asset": { "Token": { "account_id": token, "symbol": symbol, "decimals": decimals } }, "name": name, "virtual_reserve": raw.to_string(), "enabled": true }))
                        .gas(Gas::from_tgas(30)).transact().await?;
                    println!("pair {}: success={} {:?}", key, r.is_success(), r.failures());
                }
                _ => {}
            }
            let cfg: Value = worker.view(&account_id, "get_config").await?.json()?;
            let pairs: Value = worker.view(&account_id, "list_pairs").await?.json()?;
            println!("config: {}", serde_json::to_string_pretty(&cfg)?);
            println!("pairs: {}", serde_json::to_string_pretty(&pairs)?);
        }};
    }

    if network == "testnet" {
        with_worker!(near_workspaces::testnet().await?);
    } else {
        with_worker!(near_workspaces::mainnet().await?);
    }
    Ok(())
}
