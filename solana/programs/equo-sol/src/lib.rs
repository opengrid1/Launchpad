//! Equo on Solana.
//!
//! A launch makes a Token-2022 coin (metadata on the mint, no mint authority,
//! no freeze authority, immutable metadata) and opens a Meteora DAMM v2 pool
//! for it against wrapped SOL, priced so the coins on Solana open at the same
//! dollar market cap as the coin's pools on the EVM chains.
//!
//! The pool position belongs to the coin's PDA, never to a person:
//!   - Trading fees are taken in SOL only. Anyone can call `claim_fees`,
//!     which pulls the position's fees and pays 70% to the coin's creator
//!     and 30% to the platform. Meteora keeps its own protocol share of the
//!     pool fee before that, as it does on every DAMM v2 pool.
//!   - `collect` lets the admin remove a share of the position's liquidity,
//!     the same admin-only collect the EVM factory has. Nothing else can move
//!     the liquidity.
//!
//! The creator's first buy is built into the pool's opening price: the pool
//! opens at the price a fee-free buy of that much SOL would reach, so the
//! creator pays the curve price, nobody can trade before it, and no fee is
//! charged on it.
//!
//! Anti-snipe uses DAMM v2's fee scheduler: the fee starts at the coin's
//! snipe fee and falls linearly to its base fee over the snipe window.

#![allow(deprecated)]
#![allow(unexpected_cfgs)]

use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    instruction::{AccountMeta, Instruction},
    program::{invoke, invoke_signed},
    system_instruction,
};
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{self as spl, Token},
    token_2022::{self, spl_token_2022, Token2022},
    token_2022_extensions::{
        spl_pod::optional_keys::OptionalNonZeroPubkey, token_metadata_initialize,
        token_metadata_update_authority, TokenMetadataInitialize, TokenMetadataUpdateAuthority,
    },
    token_interface::{Mint, TokenAccount},
};

pub mod math;

declare_id!("6mdh7toDGpPEk8CYokVLi2aQMLDnB9jVkzhP5n9Dt4wR");

/// Meteora DAMM v2 (cp-amm).
pub mod damm {
    use anchor_lang::prelude::*;
    declare_id!("cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG");

    pub const POOL_AUTHORITY_SEED: &[u8] = b"pool_authority";
    pub const EVENT_AUTHORITY_SEED: &[u8] = b"__event_authority";
    pub const POOL_SEED: &[u8] = b"cpool";
    pub const POSITION_SEED: &[u8] = b"position";
    pub const POSITION_NFT_ACCOUNT_SEED: &[u8] = b"position_nft_account";
    pub const TOKEN_VAULT_SEED: &[u8] = b"token_vault";

    // sha256("global:<name>")[..8]
    pub const IX_INIT_CUSTOMIZABLE_POOL: [u8; 8] = [20, 161, 241, 24, 189, 221, 180, 2];
    pub const IX_CLAIM_POSITION_FEE: [u8; 8] = [180, 38, 154, 17, 133, 33, 162, 211];
    pub const IX_REMOVE_LIQUIDITY: [u8; 8] = [80, 85, 209, 72, 24, 206, 177, 108];

    /// `BaseFeeMode::FeeTimeSchedulerLinear`
    pub const FEE_MODE_TIME_LINEAR: u8 = 0;
    /// `ActivationType::Timestamp`
    pub const ACTIVATION_TIMESTAMP: u8 = 1;
    /// `CollectFeeMode::OnlyB`: fees are taken in token B (SOL) only
    pub const COLLECT_FEE_ONLY_B: u8 = 1;
    /// fee numerator per basis point (FEE_DENOMINATOR = 1e9)
    pub const NUMERATOR_PER_BPS: u64 = 100_000;
    /// `Position::unlocked_liquidity` offset, discriminator included
    pub const POSITION_UNLOCKED_LIQUIDITY_OFFSET: usize = 8 + 32 + 32 + 32 + 32 + 8 + 8;

    pub fn pool_authority() -> Pubkey {
        Pubkey::find_program_address(&[POOL_AUTHORITY_SEED], &ID).0
    }
    pub fn event_authority() -> Pubkey {
        Pubkey::find_program_address(&[EVENT_AUTHORITY_SEED], &ID).0
    }
    pub fn pool(a: &Pubkey, b: &Pubkey) -> Pubkey {
        let (hi, lo) = if a > b { (a, b) } else { (b, a) };
        Pubkey::find_program_address(&[POOL_SEED, hi.as_ref(), lo.as_ref()], &ID).0
    }
}

pub const COIN_DECIMALS: u8 = 6;
/// 1B coins across every chain the coin lives on.
pub const TOTAL_SUPPLY: u64 = 1_000_000_000 * 1_000_000;
pub const BPS: u64 = 10_000;
/// The creator's share of the pool's fees; the platform takes the rest.
pub const CREATOR_SPLIT_BPS: u64 = 7_000;
pub const MIN_FEE_BPS: u16 = 10;
pub const MAX_FEE_BPS: u16 = 300;
pub const MAX_SNIPE_BPS: u16 = 3_000;
/// DAMM v2 caps a fee schedule at one day.
pub const MAX_SNIPE_SECS: u32 = 86_400;
/// The snipe fee falls in this many equal steps.
pub const SNIPE_STEPS: u16 = 100;
pub const MAX_SPLIT: u8 = 20;
pub const MAX_CAP_PRESETS: usize = 8;
pub const MAX_NAME: usize = 32;
pub const MAX_SYMBOL: usize = 10;
pub const MAX_URI: usize = 200;

pub const CONFIG_SEED: &[u8] = b"config";
pub const COIN_SEED: &[u8] = b"coin";

#[program]
pub mod equo_sol {
    use super::*;

    /// One-time setup, signed by the program's upgrade authority. The admin
    /// set here can never change.
    pub fn initialize(ctx: Context<Initialize>, args: InitArgs) -> Result<()> {
        validate_presets(&args.cap_presets_usd8)?;
        let c = &mut ctx.accounts.config;
        c.admin = args.admin;
        c.fee_recipient = args.fee_recipient;
        c.price_updater = args.price_updater;
        c.min_first_buy = args.min_first_buy;
        c.launch_fee = args.launch_fee;
        c.max_price_age = args.max_price_age;
        c.cap_presets_usd8 = args.cap_presets_usd8;
        c.sol_usd8 = 0;
        c.price_at = 0;
        c.paused = false;
        c.launches = 0;
        c.bump = ctx.bumps.config;
        emit!(Initialized { admin: c.admin, fee_recipient: c.fee_recipient });
        Ok(())
    }

    pub fn set_fee_recipient(ctx: Context<AdminOnly>, fee_recipient: Pubkey) -> Result<()> {
        ctx.accounts.config.fee_recipient = fee_recipient;
        emit!(FeeRecipientSet { fee_recipient });
        Ok(())
    }

    pub fn set_price_updater(ctx: Context<AdminOnly>, price_updater: Pubkey) -> Result<()> {
        ctx.accounts.config.price_updater = price_updater;
        emit!(PriceUpdaterSet { price_updater });
        Ok(())
    }

    pub fn set_launch_terms(
        ctx: Context<AdminOnly>,
        min_first_buy: u64,
        launch_fee: u64,
        max_price_age: u32,
    ) -> Result<()> {
        let c = &mut ctx.accounts.config;
        c.min_first_buy = min_first_buy;
        c.launch_fee = launch_fee;
        c.max_price_age = max_price_age;
        emit!(LaunchTermsSet { min_first_buy, launch_fee, max_price_age });
        Ok(())
    }

    pub fn set_cap_presets(ctx: Context<AdminOnly>, cap_presets_usd8: Vec<u64>) -> Result<()> {
        validate_presets(&cap_presets_usd8)?;
        ctx.accounts.config.cap_presets_usd8 = cap_presets_usd8.clone();
        emit!(CapPresetsSet { cap_presets_usd8 });
        Ok(())
    }

    pub fn set_paused(ctx: Context<AdminOnly>, paused: bool) -> Result<()> {
        ctx.accounts.config.paused = paused;
        emit!(PausedSet { paused });
        Ok(())
    }

    /// SOL/USD with 8 decimals, used to turn the dollar cap presets into SOL.
    pub fn set_sol_price(ctx: Context<SetSolPrice>, sol_usd8: u64) -> Result<()> {
        require!(sol_usd8 > 0, EquoError::BadPrice);
        let c = &mut ctx.accounts.config;
        c.sol_usd8 = sol_usd8;
        c.price_at = Clock::get()?.unix_timestamp;
        emit!(SolPriceSet { sol_usd8, at: c.price_at });
        Ok(())
    }

    /// Makes the coin and opens its pool. `first_buy` lamports of wrapped SOL
    /// must already sit in the payer's WSOL account (plus 1 lamport when
    /// `first_buy` is 0: DAMM v2 takes at least one unit of each token).
    pub fn launch<'info>(ctx: Context<'info, Launch<'info>>, args: LaunchArgs) -> Result<()> {
        let cfg = &ctx.accounts.config;
        require!(!cfg.paused, EquoError::Paused);
        require!(args.name.len() <= MAX_NAME && !args.name.is_empty(), EquoError::BadMetadata);
        require!(args.symbol.len() <= MAX_SYMBOL && !args.symbol.is_empty(), EquoError::BadMetadata);
        require!(args.uri.len() <= MAX_URI, EquoError::BadMetadata);
        require!(args.fee_bps >= MIN_FEE_BPS && args.fee_bps <= MAX_FEE_BPS, EquoError::BadFee);
        require!(
            args.snipe_bps == 0 || (args.snipe_bps > args.fee_bps && args.snipe_bps <= MAX_SNIPE_BPS),
            EquoError::BadSnipe
        );
        require!(
            (args.snipe_bps == 0) == (args.snipe_secs == 0) && args.snipe_secs <= MAX_SNIPE_SECS,
            EquoError::BadSnipe
        );
        require!(args.split >= 1 && args.split <= MAX_SPLIT, EquoError::BadSplit);
        require!(args.first_buy >= cfg.min_first_buy, EquoError::FirstBuyTooSmall);
        require!((args.cap_preset as usize) < cfg.cap_presets_usd8.len(), EquoError::BadPreset);

        // opening price: the dollar cap preset in SOL, for the coin's 1B total
        let now = Clock::get()?.unix_timestamp;
        require!(cfg.sol_usd8 > 0, EquoError::StalePrice);
        require!(now.saturating_sub(cfg.price_at) <= cfg.max_price_age as i64, EquoError::StalePrice);
        let cap_usd8 = cfg.cap_presets_usd8[args.cap_preset as usize];
        let cap_lamports = (cap_usd8 as u128 * 1_000_000_000u128 / cfg.sol_usd8 as u128) as u64;
        let sqrt_min = math::sqrt_price_for_cap(cap_lamports, TOTAL_SUPPLY).ok_or(EquoError::BadPrice)?;
        let sqrt_max = math::MAX_SQRT_PRICE;
        let slice = TOTAL_SUPPLY / args.split as u64;
        let liquidity = math::liquidity_for_coins(slice, sqrt_min, sqrt_max).ok_or(EquoError::Math)?;
        let sqrt_price = math::sqrt_price_after_buy(sqrt_min, liquidity, args.first_buy).ok_or(EquoError::Math)?;
        require!(sqrt_price < sqrt_max, EquoError::Math);
        let pool_coins = math::coins_in_pool(liquidity, sqrt_price, sqrt_max).ok_or(EquoError::Math)?;
        require!(pool_coins <= slice, EquoError::Math);

        let mint_key = ctx.accounts.mint.key();
        let coin_bump = ctx.bumps.coin;
        let coin_seeds: &[&[u8]] = &[COIN_SEED, mint_key.as_ref(), &[coin_bump]];
        let signer: &[&[&[u8]]] = &[coin_seeds];

        // launch fee
        if cfg.launch_fee > 0 {
            invoke(
                &system_instruction::transfer(ctx.accounts.payer.key, ctx.accounts.fee_recipient.key, cfg.launch_fee),
                &[
                    ctx.accounts.payer.to_account_info(),
                    ctx.accounts.fee_recipient.to_account_info(),
                    ctx.accounts.system_program.to_account_info(),
                ],
            )?;
        }

        // metadata on the mint: top up rent for the TLV entry, write it, then
        // drop the update authority so it can never change
        let meta_len = 4 + 32 + 32 + (4 + args.name.len()) + (4 + args.symbol.len()) + (4 + args.uri.len()) + 4;
        let mint_info = ctx.accounts.mint.to_account_info();
        let need = Rent::get()?.minimum_balance(mint_info.data_len() + meta_len);
        let have = mint_info.lamports();
        if need > have {
            invoke(
                &system_instruction::transfer(ctx.accounts.payer.key, &mint_key, need - have),
                &[
                    ctx.accounts.payer.to_account_info(),
                    mint_info.clone(),
                    ctx.accounts.system_program.to_account_info(),
                ],
            )?;
        }
        let coin_info = ctx.accounts.coin.to_account_info();
        let t22 = ctx.accounts.token_2022_program.to_account_info();
        token_metadata_initialize(
            CpiContext::new_with_signer(
                Token2022::id(),
                TokenMetadataInitialize {
                    program_id: t22.clone(),
                    metadata: mint_info.clone(),
                    update_authority: coin_info.clone(),
                    mint_authority: coin_info.clone(),
                    mint: mint_info.clone(),
                },
                signer,
            ),
            args.name.clone(),
            args.symbol.clone(),
            args.uri.clone(),
        )?;
        token_metadata_update_authority(
            CpiContext::new_with_signer(
                Token2022::id(),
                TokenMetadataUpdateAuthority {
                    program_id: t22.clone(),
                    metadata: mint_info.clone(),
                    current_authority: coin_info.clone(),
                    new_authority: coin_info.clone(),
                },
                signer,
            ),
            OptionalNonZeroPubkey::default(),
        )?;

        // this chain's slice of the supply goes to the payer, the pool pulls
        // its coins from there, and the remainder is the creator's first buy
        token_2022::mint_to(
            CpiContext::new_with_signer(
                Token2022::id(),
                token_2022::MintTo {
                    mint: mint_info.clone(),
                    to: ctx.accounts.payer_coin.to_account_info(),
                    authority: coin_info.clone(),
                },
                signer,
            ),
            slice,
        )?;
        token_2022::set_authority(
            CpiContext::new_with_signer(
                Token2022::id(),
                token_2022::SetAuthority {
                    current_authority: coin_info.clone(),
                    account_or_mint: mint_info.clone(),
                },
                signer,
            ),
            spl_token_2022::instruction::AuthorityType::MintTokens,
            None,
        )?;

        // the pool, owned by the coin PDA
        let fees = pool_fee_params(args.fee_bps, args.snipe_bps, args.snipe_secs);
        let mut data = damm::IX_INIT_CUSTOMIZABLE_POOL.to_vec();
        data.extend_from_slice(&fees);
        data.extend_from_slice(&sqrt_min.to_le_bytes());
        data.extend_from_slice(&sqrt_max.to_le_bytes());
        data.push(0); // has_alpha_vault
        data.extend_from_slice(&liquidity.to_le_bytes());
        data.extend_from_slice(&sqrt_price.to_le_bytes());
        data.push(damm::ACTIVATION_TIMESTAMP);
        data.push(damm::COLLECT_FEE_ONLY_B);
        data.push(0); // activation_point: None, trading opens now
        let a = &ctx.accounts;
        let metas = vec![
            AccountMeta::new_readonly(a.coin.key(), false),
            AccountMeta::new(a.position_nft_mint.key(), true),
            AccountMeta::new(a.position_nft_account.key(), false),
            AccountMeta::new(a.payer.key(), true),
            AccountMeta::new_readonly(a.pool_authority.key(), false),
            AccountMeta::new(a.pool.key(), false),
            AccountMeta::new(a.position.key(), false),
            AccountMeta::new_readonly(mint_key, false),
            AccountMeta::new_readonly(a.wsol_mint.key(), false),
            AccountMeta::new(a.coin_vault.key(), false),
            AccountMeta::new(a.sol_vault.key(), false),
            AccountMeta::new(a.payer_coin.key(), false),
            AccountMeta::new(a.payer_wsol.key(), false),
            AccountMeta::new_readonly(Token2022::id(), false),
            AccountMeta::new_readonly(Token::id(), false),
            AccountMeta::new_readonly(Token2022::id(), false),
            AccountMeta::new_readonly(System::id(), false),
            AccountMeta::new_readonly(a.damm_event_authority.key(), false),
            AccountMeta::new_readonly(damm::ID, false),
        ];
        invoke_signed(
            &Instruction { program_id: damm::ID, accounts: metas, data },
            &[
                a.coin.to_account_info(),
                a.position_nft_mint.to_account_info(),
                a.position_nft_account.to_account_info(),
                a.payer.to_account_info(),
                a.pool_authority.to_account_info(),
                a.pool.to_account_info(),
                a.position.to_account_info(),
                a.mint.to_account_info(),
                a.wsol_mint.to_account_info(),
                a.coin_vault.to_account_info(),
                a.sol_vault.to_account_info(),
                a.payer_coin.to_account_info(),
                a.payer_wsol.to_account_info(),
                a.token_2022_program.to_account_info(),
                a.token_program.to_account_info(),
                a.system_program.to_account_info(),
                a.damm_event_authority.to_account_info(),
                a.damm_program.to_account_info(),
            ],
            signer,
        )?;

        let coin = &mut ctx.accounts.coin;
        coin.mint = mint_key;
        coin.creator = ctx.accounts.payer.key();
        coin.pool = ctx.accounts.pool.key();
        coin.position = ctx.accounts.position.key();
        coin.position_nft_account = ctx.accounts.position_nft_account.key();
        coin.fee_bps = args.fee_bps;
        coin.snipe_bps = args.snipe_bps;
        coin.snipe_secs = args.snipe_secs;
        coin.split = args.split;
        coin.cap_usd8 = cap_usd8;
        coin.created_at = now;
        coin.creator_fees = 0;
        coin.platform_fees = 0;
        coin.bump = coin_bump;
        let config = &mut ctx.accounts.config;
        config.launches += 1;

        emit!(Launched {
            mint: mint_key,
            creator: coin.creator,
            pool: coin.pool,
            name: args.name,
            symbol: args.symbol,
            uri: args.uri,
            fee_bps: args.fee_bps,
            snipe_bps: args.snipe_bps,
            snipe_secs: args.snipe_secs,
            split: args.split,
            cap_usd8,
            sol_usd8: config.sol_usd8,
            first_buy: args.first_buy,
            first_buy_coins: slice - pool_coins,
        });
        Ok(())
    }

    /// Pulls the position's trading fees (SOL) and pays 70% to the creator and
    /// 30% to the platform. Anyone can call it.
    pub fn claim_fees(ctx: Context<ClaimFees>) -> Result<()> {
        let mint_key = ctx.accounts.mint.key();
        let bump = ctx.accounts.coin.bump;
        let coin_seeds: &[&[u8]] = &[COIN_SEED, mint_key.as_ref(), &[bump]];
        let signer: &[&[&[u8]]] = &[coin_seeds];

        let before = ctx.accounts.coin_wsol.amount;
        let a = &ctx.accounts;
        let metas = vec![
            AccountMeta::new_readonly(a.pool_authority.key(), false),
            AccountMeta::new_readonly(a.pool.key(), false),
            AccountMeta::new(a.position.key(), false),
            AccountMeta::new(a.coin_coin.key(), false),
            AccountMeta::new(a.coin_wsol.key(), false),
            AccountMeta::new(a.coin_vault.key(), false),
            AccountMeta::new(a.sol_vault.key(), false),
            AccountMeta::new_readonly(mint_key, false),
            AccountMeta::new_readonly(a.wsol_mint.key(), false),
            AccountMeta::new_readonly(a.position_nft_account.key(), false),
            AccountMeta::new_readonly(a.coin.key(), true),
            AccountMeta::new_readonly(Token2022::id(), false),
            AccountMeta::new_readonly(Token::id(), false),
            AccountMeta::new_readonly(a.damm_event_authority.key(), false),
            AccountMeta::new_readonly(damm::ID, false),
        ];
        invoke_signed(
            &Instruction { program_id: damm::ID, accounts: metas, data: damm::IX_CLAIM_POSITION_FEE.to_vec() },
            &[
                a.pool_authority.to_account_info(),
                a.pool.to_account_info(),
                a.position.to_account_info(),
                a.coin_coin.to_account_info(),
                a.coin_wsol.to_account_info(),
                a.coin_vault.to_account_info(),
                a.sol_vault.to_account_info(),
                a.mint.to_account_info(),
                a.wsol_mint.to_account_info(),
                a.position_nft_account.to_account_info(),
                a.coin.to_account_info(),
                a.token_2022_program.to_account_info(),
                a.token_program.to_account_info(),
                a.damm_event_authority.to_account_info(),
                a.damm_program.to_account_info(),
            ],
            signer,
        )?;
        ctx.accounts.coin_wsol.reload()?;
        let claimed = ctx.accounts.coin_wsol.amount.saturating_sub(before);
        // everything in the coin's WSOL account is unsplit fees; it holds nothing else
        let total = ctx.accounts.coin_wsol.amount;
        if total == 0 {
            return Ok(());
        }
        let to_creator = (total as u128 * CREATOR_SPLIT_BPS as u128 / BPS as u128) as u64;
        let to_platform = total - to_creator;
        let a = &ctx.accounts;
        for (to, amount) in [(&a.creator_wsol, to_creator), (&a.platform_wsol, to_platform)] {
            if amount == 0 {
                continue;
            }
            spl::transfer(
                CpiContext::new_with_signer(
                    Token::id(),
                    spl::Transfer {
                        from: a.coin_wsol.to_account_info(),
                        to: to.to_account_info(),
                        authority: a.coin.to_account_info(),
                    },
                    signer,
                ),
                amount,
            )?;
        }
        let coin = &mut ctx.accounts.coin;
        coin.creator_fees = coin.creator_fees.saturating_add(to_creator);
        coin.platform_fees = coin.platform_fees.saturating_add(to_platform);
        emit!(FeesClaimed { mint: mint_key, claimed, to_creator, to_platform });
        Ok(())
    }

    /// The creator hands the coin's creator share to another wallet.
    pub fn set_creator(ctx: Context<SetCreator>, creator: Pubkey) -> Result<()> {
        let coin = &mut ctx.accounts.coin;
        let previous = coin.creator;
        coin.creator = creator;
        emit!(CreatorSet { mint: coin.mint, previous, creator });
        Ok(())
    }

    /// Admin only: removes `bps` of the position's liquidity and sends the
    /// coins and SOL to the given accounts. Fees already earned stay in the
    /// position for `claim_fees`.
    pub fn collect(ctx: Context<Collect>, bps: u16) -> Result<()> {
        require!(bps > 0 && bps as u64 <= BPS, EquoError::BadBps);
        let unlocked = {
            let data = ctx.accounts.position.try_borrow_data()?;
            let o = damm::POSITION_UNLOCKED_LIQUIDITY_OFFSET;
            u128::from_le_bytes(data[o..o + 16].try_into().unwrap())
        };
        let delta = unlocked * bps as u128 / BPS as u128;
        require!(delta > 0, EquoError::NothingToCollect);

        let mint_key = ctx.accounts.mint.key();
        let bump = ctx.accounts.coin.bump;
        let coin_seeds: &[&[u8]] = &[COIN_SEED, mint_key.as_ref(), &[bump]];
        let signer: &[&[&[u8]]] = &[coin_seeds];
        let coins_before = ctx.accounts.to_coin.amount;
        let sol_before = ctx.accounts.to_wsol.amount;

        let mut data = damm::IX_REMOVE_LIQUIDITY.to_vec();
        data.extend_from_slice(&delta.to_le_bytes());
        data.extend_from_slice(&0u64.to_le_bytes());
        data.extend_from_slice(&0u64.to_le_bytes());
        let a = &ctx.accounts;
        let metas = vec![
            AccountMeta::new_readonly(a.pool_authority.key(), false),
            AccountMeta::new(a.pool.key(), false),
            AccountMeta::new(a.position.key(), false),
            AccountMeta::new(a.to_coin.key(), false),
            AccountMeta::new(a.to_wsol.key(), false),
            AccountMeta::new(a.coin_vault.key(), false),
            AccountMeta::new(a.sol_vault.key(), false),
            AccountMeta::new_readonly(mint_key, false),
            AccountMeta::new_readonly(a.wsol_mint.key(), false),
            AccountMeta::new_readonly(a.position_nft_account.key(), false),
            AccountMeta::new_readonly(a.coin.key(), true),
            AccountMeta::new_readonly(Token2022::id(), false),
            AccountMeta::new_readonly(Token::id(), false),
            AccountMeta::new_readonly(a.damm_event_authority.key(), false),
            AccountMeta::new_readonly(damm::ID, false),
        ];
        invoke_signed(
            &Instruction { program_id: damm::ID, accounts: metas, data },
            &[
                a.pool_authority.to_account_info(),
                a.pool.to_account_info(),
                a.position.to_account_info(),
                a.to_coin.to_account_info(),
                a.to_wsol.to_account_info(),
                a.coin_vault.to_account_info(),
                a.sol_vault.to_account_info(),
                a.mint.to_account_info(),
                a.wsol_mint.to_account_info(),
                a.position_nft_account.to_account_info(),
                a.coin.to_account_info(),
                a.token_2022_program.to_account_info(),
                a.token_program.to_account_info(),
                a.damm_event_authority.to_account_info(),
                a.damm_program.to_account_info(),
            ],
            signer,
        )?;
        ctx.accounts.to_coin.reload()?;
        ctx.accounts.to_wsol.reload()?;
        emit!(Collected {
            mint: mint_key,
            bps,
            liquidity: delta,
            coins: ctx.accounts.to_coin.amount.saturating_sub(coins_before),
            sol: ctx.accounts.to_wsol.amount.saturating_sub(sol_before),
            to_coin: ctx.accounts.to_coin.key(),
            to_wsol: ctx.accounts.to_wsol.key(),
        });
        Ok(())
    }
}

fn validate_presets(p: &[u64]) -> Result<()> {
    require!(!p.is_empty() && p.len() <= MAX_CAP_PRESETS, EquoError::BadPreset);
    require!(p.iter().all(|v| *v > 0), EquoError::BadPreset);
    Ok(())
}

/// Borsh `PoolFeeParameters`: a linear time-scheduled base fee (anti-snipe
/// decaying to the coin's fee), no compounding, no dynamic fee.
pub fn pool_fee_params(fee_bps: u16, snipe_bps: u16, snipe_secs: u32) -> Vec<u8> {
    let base = fee_bps as u64 * damm::NUMERATOR_PER_BPS;
    let (cliff, periods, freq, reduction) = if snipe_bps == 0 {
        (base, 0u16, 0u64, 0u64)
    } else {
        let cliff = snipe_bps as u64 * damm::NUMERATOR_PER_BPS;
        let steps = SNIPE_STEPS.min(snipe_secs as u16).max(1);
        let freq = (snipe_secs as u64).div_ceil(steps as u64);
        (cliff, steps, freq, (cliff - base) / steps as u64)
    };
    let mut v = Vec::with_capacity(27 + 4);
    v.extend_from_slice(&cliff.to_le_bytes());
    v.extend_from_slice(&periods.to_le_bytes());
    v.extend_from_slice(&freq.to_le_bytes());
    v.extend_from_slice(&reduction.to_le_bytes());
    v.push(damm::FEE_MODE_TIME_LINEAR);
    v.extend_from_slice(&0u16.to_le_bytes()); // compounding_fee_bps
    v.push(0); // padding
    v.push(0); // dynamic_fee: None
    v
}

// -------------------------------------------------------------------------
// Accounts
// -------------------------------------------------------------------------

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct InitArgs {
    pub admin: Pubkey,
    pub fee_recipient: Pubkey,
    pub price_updater: Pubkey,
    pub min_first_buy: u64,
    pub launch_fee: u64,
    pub max_price_age: u32,
    pub cap_presets_usd8: Vec<u64>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct LaunchArgs {
    pub name: String,
    pub symbol: String,
    pub uri: String,
    pub fee_bps: u16,
    pub snipe_bps: u16,
    pub snipe_secs: u32,
    pub split: u8,
    pub cap_preset: u8,
    pub first_buy: u64,
}

#[account]
#[derive(InitSpace)]
pub struct Config {
    pub admin: Pubkey,
    pub fee_recipient: Pubkey,
    pub price_updater: Pubkey,
    pub min_first_buy: u64,
    pub launch_fee: u64,
    pub max_price_age: u32,
    #[max_len(MAX_CAP_PRESETS)]
    pub cap_presets_usd8: Vec<u64>,
    pub sol_usd8: u64,
    pub price_at: i64,
    pub paused: bool,
    pub launches: u64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Coin {
    pub mint: Pubkey,
    pub creator: Pubkey,
    pub pool: Pubkey,
    pub position: Pubkey,
    pub position_nft_account: Pubkey,
    pub fee_bps: u16,
    pub snipe_bps: u16,
    pub snipe_secs: u32,
    pub split: u8,
    pub cap_usd8: u64,
    pub created_at: i64,
    pub creator_fees: u64,
    pub platform_fees: u64,
    pub bump: u8,
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(init, payer = authority, space = 8 + Config::INIT_SPACE, seeds = [CONFIG_SEED], bump)]
    pub config: Account<'info, Config>,
    #[account(constraint = program.programdata_address()? == Some(program_data.key()) @ EquoError::NotUpgradeAuthority)]
    pub program: Program<'info, crate::program::EquoSol>,
    #[account(constraint = program_data.upgrade_authority_address == Some(authority.key()) @ EquoError::NotUpgradeAuthority)]
    pub program_data: Account<'info, ProgramData>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AdminOnly<'info> {
    pub admin: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = admin @ EquoError::NotAdmin)]
    pub config: Account<'info, Config>,
}

#[derive(Accounts)]
pub struct SetSolPrice<'info> {
    #[account(constraint = signer.key() == config.price_updater || signer.key() == config.admin @ EquoError::NotPriceUpdater)]
    pub signer: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
}

#[derive(Accounts)]
pub struct Launch<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    /// CHECK: receives the launch fee; must be the config's fee recipient
    #[account(mut, address = config.fee_recipient @ EquoError::BadFeeRecipient)]
    pub fee_recipient: UncheckedAccount<'info>,

    #[account(
        init,
        signer,
        payer = payer,
        mint::token_program = token_2022_program,
        mint::decimals = COIN_DECIMALS,
        mint::authority = coin,
        extensions::metadata_pointer::authority = coin,
        extensions::metadata_pointer::metadata_address = mint,
    )]
    pub mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(init, payer = payer, space = 8 + Coin::INIT_SPACE, seeds = [COIN_SEED, mint.key().as_ref()], bump)]
    pub coin: Box<Account<'info, Coin>>,
    #[account(
        init,
        payer = payer,
        associated_token::mint = mint,
        associated_token::authority = payer,
        associated_token::token_program = token_2022_program,
    )]
    pub payer_coin: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, token::mint = wsol_mint, token::authority = payer, token::token_program = token_program)]
    pub payer_wsol: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(address = spl::spl_token::native_mint::ID)]
    pub wsol_mint: Box<InterfaceAccount<'info, Mint>>,

    /// CHECK: new position NFT mint, created by DAMM v2; signs the transaction
    #[account(mut, signer)]
    pub position_nft_mint: UncheckedAccount<'info>,
    /// CHECK: created by DAMM v2 at its PDA
    #[account(mut, seeds = [damm::POSITION_NFT_ACCOUNT_SEED, position_nft_mint.key().as_ref()], bump, seeds::program = damm::ID)]
    pub position_nft_account: UncheckedAccount<'info>,
    /// CHECK: created by DAMM v2 at its PDA
    #[account(mut, address = damm::pool(&mint.key(), &wsol_mint.key()) @ EquoError::BadPool)]
    pub pool: UncheckedAccount<'info>,
    /// CHECK: created by DAMM v2 at its PDA
    #[account(mut, seeds = [damm::POSITION_SEED, position_nft_mint.key().as_ref()], bump, seeds::program = damm::ID)]
    pub position: UncheckedAccount<'info>,
    /// CHECK: created by DAMM v2 at its PDA
    #[account(mut, seeds = [damm::TOKEN_VAULT_SEED, mint.key().as_ref(), pool.key().as_ref()], bump, seeds::program = damm::ID)]
    pub coin_vault: UncheckedAccount<'info>,
    /// CHECK: created by DAMM v2 at its PDA
    #[account(mut, seeds = [damm::TOKEN_VAULT_SEED, wsol_mint.key().as_ref(), pool.key().as_ref()], bump, seeds::program = damm::ID)]
    pub sol_vault: UncheckedAccount<'info>,
    /// CHECK: DAMM v2's pool authority PDA
    #[account(seeds = [damm::POOL_AUTHORITY_SEED], bump, seeds::program = damm::ID)]
    pub pool_authority: UncheckedAccount<'info>,
    /// CHECK: DAMM v2's event authority PDA
    #[account(seeds = [damm::EVENT_AUTHORITY_SEED], bump, seeds::program = damm::ID)]
    pub damm_event_authority: UncheckedAccount<'info>,
    /// CHECK: DAMM v2
    #[account(address = damm::ID)]
    pub damm_program: UncheckedAccount<'info>,

    pub token_2022_program: Program<'info, Token2022>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ClaimFees<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(
        mut,
        seeds = [COIN_SEED, mint.key().as_ref()],
        bump = coin.bump,
        has_one = mint,
        has_one = pool,
        has_one = position,
        has_one = position_nft_account,
    )]
    pub coin: Box<Account<'info, Coin>>,
    #[account(mint::token_program = token_2022_program)]
    pub mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(address = spl::spl_token::native_mint::ID)]
    pub wsol_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = mint,
        associated_token::authority = coin,
        associated_token::token_program = token_2022_program,
    )]
    pub coin_coin: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = wsol_mint,
        associated_token::authority = coin,
        associated_token::token_program = token_program,
    )]
    pub coin_wsol: Box<InterfaceAccount<'info, TokenAccount>>,
    /// CHECK: the coin's creator, for its WSOL account
    #[account(address = coin.creator @ EquoError::BadCreator)]
    pub creator: UncheckedAccount<'info>,
    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = wsol_mint,
        associated_token::authority = creator,
        associated_token::token_program = token_program,
    )]
    pub creator_wsol: Box<InterfaceAccount<'info, TokenAccount>>,
    /// CHECK: the platform's fee recipient, for its WSOL account
    #[account(address = config.fee_recipient @ EquoError::BadFeeRecipient)]
    pub fee_recipient: UncheckedAccount<'info>,
    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = wsol_mint,
        associated_token::authority = fee_recipient,
        associated_token::token_program = token_program,
    )]
    pub platform_wsol: Box<InterfaceAccount<'info, TokenAccount>>,

    /// CHECK: checked against the coin
    pub pool: UncheckedAccount<'info>,
    /// CHECK: checked against the coin
    #[account(mut)]
    pub position: UncheckedAccount<'info>,
    /// CHECK: checked against the coin
    pub position_nft_account: UncheckedAccount<'info>,
    /// CHECK: DAMM v2 checks it against the pool
    #[account(mut, seeds = [damm::TOKEN_VAULT_SEED, mint.key().as_ref(), pool.key().as_ref()], bump, seeds::program = damm::ID)]
    pub coin_vault: UncheckedAccount<'info>,
    /// CHECK: DAMM v2 checks it against the pool
    #[account(mut, seeds = [damm::TOKEN_VAULT_SEED, wsol_mint.key().as_ref(), pool.key().as_ref()], bump, seeds::program = damm::ID)]
    pub sol_vault: UncheckedAccount<'info>,
    /// CHECK: DAMM v2's pool authority PDA
    #[account(seeds = [damm::POOL_AUTHORITY_SEED], bump, seeds::program = damm::ID)]
    pub pool_authority: UncheckedAccount<'info>,
    /// CHECK: DAMM v2's event authority PDA
    #[account(seeds = [damm::EVENT_AUTHORITY_SEED], bump, seeds::program = damm::ID)]
    pub damm_event_authority: UncheckedAccount<'info>,
    /// CHECK: DAMM v2
    #[account(address = damm::ID)]
    pub damm_program: UncheckedAccount<'info>,

    pub token_2022_program: Program<'info, Token2022>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SetCreator<'info> {
    pub creator: Signer<'info>,
    #[account(mut, seeds = [COIN_SEED, coin.mint.as_ref()], bump = coin.bump, has_one = creator @ EquoError::BadCreator)]
    pub coin: Account<'info, Coin>,
}

#[derive(Accounts)]
pub struct Collect<'info> {
    pub admin: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = admin @ EquoError::NotAdmin)]
    pub config: Box<Account<'info, Config>>,
    #[account(
        seeds = [COIN_SEED, mint.key().as_ref()],
        bump = coin.bump,
        has_one = mint,
        has_one = pool,
        has_one = position,
        has_one = position_nft_account,
    )]
    pub coin: Box<Account<'info, Coin>>,
    #[account(mint::token_program = token_2022_program)]
    pub mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(address = spl::spl_token::native_mint::ID)]
    pub wsol_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut, token::mint = mint, token::token_program = token_2022_program)]
    pub to_coin: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, token::mint = wsol_mint, token::token_program = token_program)]
    pub to_wsol: Box<InterfaceAccount<'info, TokenAccount>>,

    /// CHECK: checked against the coin
    #[account(mut)]
    pub pool: UncheckedAccount<'info>,
    /// CHECK: checked against the coin, owned by DAMM v2
    #[account(mut, owner = damm::ID)]
    pub position: UncheckedAccount<'info>,
    /// CHECK: checked against the coin
    pub position_nft_account: UncheckedAccount<'info>,
    /// CHECK: DAMM v2 checks it against the pool
    #[account(mut, seeds = [damm::TOKEN_VAULT_SEED, mint.key().as_ref(), pool.key().as_ref()], bump, seeds::program = damm::ID)]
    pub coin_vault: UncheckedAccount<'info>,
    /// CHECK: DAMM v2 checks it against the pool
    #[account(mut, seeds = [damm::TOKEN_VAULT_SEED, wsol_mint.key().as_ref(), pool.key().as_ref()], bump, seeds::program = damm::ID)]
    pub sol_vault: UncheckedAccount<'info>,
    /// CHECK: DAMM v2's pool authority PDA
    #[account(seeds = [damm::POOL_AUTHORITY_SEED], bump, seeds::program = damm::ID)]
    pub pool_authority: UncheckedAccount<'info>,
    /// CHECK: DAMM v2's event authority PDA
    #[account(seeds = [damm::EVENT_AUTHORITY_SEED], bump, seeds::program = damm::ID)]
    pub damm_event_authority: UncheckedAccount<'info>,
    /// CHECK: DAMM v2
    #[account(address = damm::ID)]
    pub damm_program: UncheckedAccount<'info>,

    pub token_2022_program: Program<'info, Token2022>,
    pub token_program: Program<'info, Token>,
}

// -------------------------------------------------------------------------
// Events and errors
// -------------------------------------------------------------------------

#[event]
pub struct Initialized {
    pub admin: Pubkey,
    pub fee_recipient: Pubkey,
}
#[event]
pub struct FeeRecipientSet {
    pub fee_recipient: Pubkey,
}
#[event]
pub struct PriceUpdaterSet {
    pub price_updater: Pubkey,
}
#[event]
pub struct LaunchTermsSet {
    pub min_first_buy: u64,
    pub launch_fee: u64,
    pub max_price_age: u32,
}
#[event]
pub struct CapPresetsSet {
    pub cap_presets_usd8: Vec<u64>,
}
#[event]
pub struct PausedSet {
    pub paused: bool,
}
#[event]
pub struct SolPriceSet {
    pub sol_usd8: u64,
    pub at: i64,
}
#[event]
pub struct Launched {
    pub mint: Pubkey,
    pub creator: Pubkey,
    pub pool: Pubkey,
    pub name: String,
    pub symbol: String,
    pub uri: String,
    pub fee_bps: u16,
    pub snipe_bps: u16,
    pub snipe_secs: u32,
    pub split: u8,
    pub cap_usd8: u64,
    pub sol_usd8: u64,
    pub first_buy: u64,
    pub first_buy_coins: u64,
}
#[event]
pub struct FeesClaimed {
    pub mint: Pubkey,
    pub claimed: u64,
    pub to_creator: u64,
    pub to_platform: u64,
}
#[event]
pub struct CreatorSet {
    pub mint: Pubkey,
    pub previous: Pubkey,
    pub creator: Pubkey,
}
#[event]
pub struct Collected {
    pub mint: Pubkey,
    pub bps: u16,
    pub liquidity: u128,
    pub coins: u64,
    pub sol: u64,
    pub to_coin: Pubkey,
    pub to_wsol: Pubkey,
}

#[error_code]
pub enum EquoError {
    #[msg("Signer is not the program's upgrade authority")]
    NotUpgradeAuthority,
    #[msg("Signer is not the admin")]
    NotAdmin,
    #[msg("Signer may not set the SOL price")]
    NotPriceUpdater,
    #[msg("Launches are paused")]
    Paused,
    #[msg("Name, symbol or URI is empty or too long")]
    BadMetadata,
    #[msg("Fee must be 10 to 300 bps")]
    BadFee,
    #[msg("Anti-snipe must be above the fee, at most 3000 bps, over at most one day")]
    BadSnipe,
    #[msg("Split must be 1 to 20")]
    BadSplit,
    #[msg("First buy is below the minimum")]
    FirstBuyTooSmall,
    #[msg("Unknown or invalid cap preset")]
    BadPreset,
    #[msg("SOL price is missing or stale")]
    StalePrice,
    #[msg("Bad price")]
    BadPrice,
    #[msg("Math overflow")]
    Math,
    #[msg("Wrong fee recipient")]
    BadFeeRecipient,
    #[msg("Wrong creator")]
    BadCreator,
    #[msg("Wrong pool")]
    BadPool,
    #[msg("Bps must be 1 to 10000")]
    BadBps,
    #[msg("Nothing to collect")]
    NothingToCollect,
}
