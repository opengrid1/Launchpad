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
//!
//! Written on Pinocchio rather than Anchor to keep the program small (its
//! rent is paid per byte). Instructions, accounts, account layouts and events
//! use Anchor's encoding (sha256 discriminators, borsh), so Anchor-style
//! clients and indexers read it unchanged.

#![cfg_attr(not(test), no_std)]

use pinocchio::{
    account_info::AccountInfo,
    cpi::slice_invoke_signed,
    no_allocator, nostd_panic_handler, program_entrypoint,
    instruction::{AccountMeta, Instruction, Seed, Signer},
    log::sol_log_data,
    msg,
    program_error::ProgramError,
    pubkey::{create_program_address, find_program_address, Pubkey},
    sysvars::{clock::Clock, rent::Rent, Sysvar},
    ProgramResult,
};

pub mod math;

/// 6mdh7toDGpPEk8CYokVLi2aQMLDnB9jVkzhP5n9Dt4wR
pub const ID: Pubkey = [85, 185, 122, 72, 204, 62, 38, 139, 255, 139, 164, 242, 55, 203, 199, 48, 217, 155, 7, 38, 245, 10, 245, 11, 2, 244, 160, 66, 100, 199, 88, 184];
/// Meteora DAMM v2, cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG
pub const DAMM: Pubkey = [9, 45, 33, 53, 101, 122, 21, 156, 43, 135, 212, 182, 106, 112, 219, 142, 151, 82, 56, 159, 247, 106, 175, 32, 108, 237, 6, 58, 56, 249, 90, 237];
/// TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb
pub const TOKEN_2022: Pubkey = [6, 221, 246, 225, 238, 117, 143, 222, 24, 66, 93, 188, 228, 108, 205, 218, 182, 26, 252, 77, 131, 185, 13, 39, 254, 189, 249, 40, 216, 161, 139, 252];
/// TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA
pub const TOKEN: Pubkey = [6, 221, 246, 225, 215, 101, 161, 147, 217, 203, 225, 70, 206, 235, 121, 172, 28, 180, 133, 237, 95, 91, 55, 145, 58, 140, 245, 133, 126, 255, 0, 169];
/// ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL
pub const ATA: Pubkey = [140, 151, 37, 143, 78, 36, 137, 241, 187, 61, 16, 41, 20, 142, 13, 131, 11, 90, 19, 153, 218, 255, 16, 132, 4, 142, 123, 216, 219, 233, 248, 89];
/// 11111111111111111111111111111111
pub const SYSTEM: Pubkey = [0; 32];
/// So11111111111111111111111111111111111111112
pub const NATIVE_MINT: Pubkey = [6, 155, 136, 87, 254, 171, 129, 132, 251, 104, 127, 99, 70, 24, 192, 53, 218, 196, 57, 220, 26, 235, 59, 85, 152, 160, 240, 0, 0, 0, 0, 1];
/// BPFLoaderUpgradeab1e11111111111111111111111
pub const BPF_UPGRADEABLE: Pubkey = [2, 168, 246, 145, 78, 136, 161, 176, 226, 16, 21, 62, 247, 99, 174, 43, 0, 194, 185, 61, 22, 193, 36, 210, 192, 83, 122, 16, 4, 128, 0, 0];

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

/// Meteora DAMM v2 (cp-amm) constants.
pub mod damm {
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
}

// sha256("global:<name>")[..8]
const IX_INITIALIZE: [u8; 8] = [175, 175, 109, 31, 13, 152, 155, 237];
const IX_SET_FEE_RECIPIENT: [u8; 8] = [227, 18, 215, 42, 237, 246, 151, 66];
const IX_SET_PRICE_UPDATER: [u8; 8] = [252, 252, 11, 157, 146, 253, 124, 49];
const IX_SET_LAUNCH_TERMS: [u8; 8] = [224, 63, 204, 56, 119, 26, 120, 83];
const IX_SET_CAP_PRESETS: [u8; 8] = [132, 157, 210, 8, 76, 137, 240, 247];
const IX_SET_PAUSED: [u8; 8] = [91, 60, 125, 192, 176, 225, 166, 218];
const IX_SET_SOL_PRICE: [u8; 8] = [151, 237, 70, 191, 232, 81, 138, 214];
const IX_LAUNCH: [u8; 8] = [153, 241, 93, 225, 22, 69, 74, 61];
const IX_CLAIM_FEES: [u8; 8] = [82, 251, 233, 156, 12, 52, 184, 202];
const IX_SET_CREATOR: [u8; 8] = [254, 148, 255, 112, 207, 142, 170, 165];
const IX_COLLECT: [u8; 8] = [208, 47, 194, 155, 17, 98, 82, 236];

// sha256("account:<Name>")[..8]
const CONFIG_DISC: [u8; 8] = [155, 12, 170, 224, 30, 250, 204, 130];
const COIN_DISC: [u8; 8] = [215, 195, 53, 238, 217, 196, 213, 51];

// sha256("event:<Name>")[..8]
const EV_INITIALIZED: [u8; 8] = [208, 213, 115, 98, 115, 82, 201, 209];
const EV_FEE_RECIPIENT_SET: [u8; 8] = [99, 140, 80, 35, 245, 176, 179, 110];
const EV_PRICE_UPDATER_SET: [u8; 8] = [122, 231, 184, 224, 20, 230, 93, 149];
const EV_LAUNCH_TERMS_SET: [u8; 8] = [45, 221, 168, 108, 108, 197, 145, 58];
const EV_CAP_PRESETS_SET: [u8; 8] = [80, 255, 251, 254, 213, 49, 15, 254];
const EV_PAUSED_SET: [u8; 8] = [171, 125, 127, 156, 233, 81, 68, 66];
const EV_SOL_PRICE_SET: [u8; 8] = [227, 223, 41, 124, 44, 9, 23, 34];
const EV_LAUNCHED: [u8; 8] = [209, 127, 29, 152, 129, 212, 189, 183];
const EV_FEES_CLAIMED: [u8; 8] = [22, 104, 110, 222, 38, 157, 14, 62];
const EV_CREATOR_SET: [u8; 8] = [95, 242, 20, 222, 81, 81, 181, 66];
const EV_COLLECTED: [u8; 8] = [67, 109, 138, 167, 168, 239, 2, 207];

// spl-token-metadata-interface: sha256("spl_token_metadata_interface:<name>")[..8]
const META_INITIALIZE: [u8; 8] = [210, 225, 30, 162, 88, 184, 77, 141];
const META_UPDATE_AUTHORITY: [u8; 8] = [215, 228, 166, 228, 84, 100, 86, 123];

/// Token-2022 mint with the MetadataPointer extension, before the metadata
/// TLV entry: 165 (mint + padding) + 1 (account type) + 4 + 64.
const MINT_WITH_POINTER_LEN: usize = 234;

// -------------------------------------------------------------------------
// Errors
// -------------------------------------------------------------------------

#[derive(Clone, Copy)]
#[repr(u32)]
pub enum E {
    NotUpgradeAuthority,
    NotAdmin,
    NotPriceUpdater,
    Paused,
    BadMetadata,
    BadFee,
    BadSnipe,
    BadSplit,
    FirstBuyTooSmall,
    BadPreset,
    StalePrice,
    BadPrice,
    Math,
    BadFeeRecipient,
    BadCreator,
    BadPool,
    BadBps,
    NothingToCollect,
    BadAccount,
    BadInstruction,
}

const ERR_LOG: [&str; 20] = [
    "Error: NotUpgradeAuthority. Signer is not the program's upgrade authority",
    "Error: NotAdmin. Signer is not the admin",
    "Error: NotPriceUpdater. Signer may not set the SOL price",
    "Error: Paused. Launches are paused",
    "Error: BadMetadata. Name, symbol or URI is empty or too long",
    "Error: BadFee. Fee must be 10 to 300 bps",
    "Error: BadSnipe. Anti-snipe must be above the fee, at most 3000 bps, over at most one day",
    "Error: BadSplit. Split must be 1 to 20",
    "Error: FirstBuyTooSmall. First buy is below the minimum",
    "Error: BadPreset. Unknown or invalid cap preset",
    "Error: StalePrice. SOL price is missing or stale",
    "Error: BadPrice",
    "Error: Math. Math overflow",
    "Error: BadFeeRecipient. Wrong fee recipient",
    "Error: BadCreator. Wrong creator",
    "Error: BadPool. Wrong pool",
    "Error: BadBps. Bps must be 1 to 10000",
    "Error: NothingToCollect",
    "Error: BadAccount. Wrong or invalid account",
    "Error: BadInstruction. Unknown instruction or bad data",
];

#[inline(never)]
fn fail(e: E) -> ProgramError {
    msg!(ERR_LOG[e as usize]);
    ProgramError::Custom(6000 + e as u32)
}

macro_rules! req {
    ($c:expr, $e:expr) => {
        if !($c) {
            return Err(fail($e));
        }
    };
}

// -------------------------------------------------------------------------
// Encoding helpers
// -------------------------------------------------------------------------

struct Rd<'a> {
    d: &'a [u8],
    o: usize,
}

impl<'a> Rd<'a> {
    fn take(&mut self, n: usize) -> Result<&'a [u8], ProgramError> {
        let s = self.d.get(self.o..self.o + n).ok_or_else(|| fail(E::BadInstruction))?;
        self.o += n;
        Ok(s)
    }
    fn u8(&mut self) -> Result<u8, ProgramError> {
        Ok(self.take(1)?[0])
    }
    fn u16(&mut self) -> Result<u16, ProgramError> {
        Ok(u16::from_le_bytes(self.take(2)?.try_into().unwrap()))
    }
    fn u32(&mut self) -> Result<u32, ProgramError> {
        Ok(u32::from_le_bytes(self.take(4)?.try_into().unwrap()))
    }
    fn u64(&mut self) -> Result<u64, ProgramError> {
        Ok(u64::from_le_bytes(self.take(8)?.try_into().unwrap()))
    }
    fn key(&mut self) -> Result<Pubkey, ProgramError> {
        Ok(self.take(32)?.try_into().unwrap())
    }
    fn bytes(&mut self) -> Result<&'a [u8], ProgramError> {
        let n = self.u32()? as usize;
        self.take(n)
    }
    fn presets(&mut self) -> Result<([u64; MAX_CAP_PRESETS], u8), ProgramError> {
        let n = self.u32()? as usize;
        req!(n >= 1 && n <= MAX_CAP_PRESETS, E::BadPreset);
        let mut p = [0u64; MAX_CAP_PRESETS];
        for v in p.iter_mut().take(n) {
            *v = self.u64()?;
            req!(*v > 0, E::BadPreset);
        }
        Ok((p, n as u8))
    }
}

fn rd_u64(d: &[u8], o: usize) -> u64 {
    u64::from_le_bytes(d[o..o + 8].try_into().unwrap())
}
fn rd_key(d: &[u8], o: usize) -> Pubkey {
    d[o..o + 32].try_into().unwrap()
}

/// Borsh writer for instruction data and events, on the stack (the program
/// has no heap).
struct Wr<const N: usize> {
    b: [u8; N],
    n: usize,
}

impl<const N: usize> Wr<N> {
    fn new(head: &[u8]) -> Self {
        let mut w = Wr { b: [0u8; N], n: 0 };
        w.raw(head);
        w
    }
    fn out(&self) -> &[u8] {
        &self.b[..self.n]
    }
    fn raw(&mut self, b: &[u8]) -> &mut Self {
        self.b[self.n..self.n + b.len()].copy_from_slice(b);
        self.n += b.len();
        self
    }
    fn u8(&mut self, v: u8) -> &mut Self {
        self.raw(&[v])
    }
    fn u16(&mut self, v: u16) -> &mut Self {
        self.raw(&v.to_le_bytes())
    }
    fn u32(&mut self, v: u32) -> &mut Self {
        self.raw(&v.to_le_bytes())
    }
    fn u64(&mut self, v: u64) -> &mut Self {
        self.raw(&v.to_le_bytes())
    }
    fn u128(&mut self, v: u128) -> &mut Self {
        self.raw(&v.to_le_bytes())
    }
    fn str(&mut self, b: &[u8]) -> &mut Self {
        self.u32(b.len() as u32).raw(b)
    }
    fn emit(&self) {
        sol_log_data(&[self.out()]);
    }
}

// -------------------------------------------------------------------------
// Account helpers
// -------------------------------------------------------------------------

fn is_key(a: &AccountInfo, k: &Pubkey) -> bool {
    a.key() == k
}

fn signer(a: &AccountInfo) -> Result<(), ProgramError> {
    req!(a.is_signer(), E::BadAccount);
    Ok(())
}

fn program(a: &AccountInfo, id: &Pubkey) -> Result<(), ProgramError> {
    req!(a.key() == id, E::BadAccount);
    Ok(())
}

/// A token account's (mint, owner, amount), checking the token program.
fn token_account(a: &AccountInfo, token_program: &Pubkey) -> Result<(Pubkey, Pubkey, u64), ProgramError> {
    req!(a.is_owned_by(token_program), E::BadAccount);
    let d = a.try_borrow_data()?;
    req!(d.len() >= 165, E::BadAccount);
    Ok((rd_key(&d, 0), rd_key(&d, 32), rd_u64(&d, 64)))
}

fn token_amount(a: &AccountInfo) -> Result<u64, ProgramError> {
    let d = a.try_borrow_data()?;
    req!(d.len() >= 72, E::BadAccount);
    Ok(rd_u64(&d, 64))
}

fn call(program_id: &Pubkey, metas: &[AccountMeta], infos: &[&AccountInfo], data: &[u8], signers: &[Signer]) -> ProgramResult {
    slice_invoke_signed(&Instruction { program_id, data, accounts: metas }, infos, signers)
}

fn sys_create(payer: &AccountInfo, new: &AccountInfo, lamports: u64, space: u64, owner: &Pubkey, signers: &[Signer]) -> ProgramResult {
    let mut d = Wr::<80>::new(&0u32.to_le_bytes());
    d.u64(lamports).u64(space).raw(owner);
    call(
        &SYSTEM,
        &[AccountMeta::writable_signer(payer.key()), AccountMeta::writable_signer(new.key())],
        &[payer, new],
        d.out(),
        signers,
    )
}

fn sys_transfer(from: &AccountInfo, to: &AccountInfo, lamports: u64) -> ProgramResult {
    let mut d = Wr::<80>::new(&2u32.to_le_bytes());
    d.u64(lamports);
    call(
        &SYSTEM,
        &[AccountMeta::writable_signer(from.key()), AccountMeta::writable(to.key())],
        &[from, to],
        d.out(),
        &[],
    )
}

/// Creates `ata` (owner's associated account for `mint`) if it is missing.
/// The ATA program checks that the address is the derived one.
fn ata_idempotent(payer: &AccountInfo, ata: &AccountInfo, owner: &AccountInfo, mint: &AccountInfo, system: &AccountInfo, token_program: &AccountInfo) -> ProgramResult {
    call(
        &ATA,
        &[
            AccountMeta::writable_signer(payer.key()),
            AccountMeta::writable(ata.key()),
            AccountMeta::readonly(owner.key()),
            AccountMeta::readonly(mint.key()),
            AccountMeta::readonly(system.key()),
            AccountMeta::readonly(token_program.key()),
        ],
        &[payer, ata, owner, mint, system, token_program],
        &[1],
        &[],
    )
}

fn token_transfer(token_program: &Pubkey, from: &AccountInfo, to: &AccountInfo, authority: &AccountInfo, amount: u64, signers: &[Signer]) -> ProgramResult {
    let mut d = Wr::<80>::new(&[3]);
    d.u64(amount);
    call(
        token_program,
        &[AccountMeta::writable(from.key()), AccountMeta::writable(to.key()), AccountMeta::readonly_signer(authority.key())],
        &[from, to, authority],
        d.out(),
        signers,
    )
}

// -------------------------------------------------------------------------
// State
// -------------------------------------------------------------------------

/// Config, after the 8-byte discriminator.
mod cfg {
    pub const ADMIN: usize = 8;
    pub const FEE_RECIPIENT: usize = 40;
    pub const PRICE_UPDATER: usize = 72;
    pub const MIN_FIRST_BUY: usize = 104;
    pub const LAUNCH_FEE: usize = 112;
    pub const MAX_PRICE_AGE: usize = 120;
    pub const PRESET_COUNT: usize = 124;
    pub const PRESETS: usize = 125;
    pub const SOL_USD8: usize = 189;
    pub const PRICE_AT: usize = 197;
    pub const PAUSED: usize = 205;
    pub const LAUNCHES: usize = 206;
    pub const BUMP: usize = 214;
    pub const LEN: usize = 215;
}

/// Coin, after the 8-byte discriminator. Same layout as the borsh struct
/// `Coin { mint, creator, pool, position, position_nft_account, fee_bps,
/// snipe_bps, snipe_secs, split, cap_usd8, created_at, creator_fees,
/// platform_fees, bump }`.
mod coin {
    pub const MINT: usize = 8;
    pub const CREATOR: usize = 40;
    pub const POOL: usize = 72;
    pub const POSITION: usize = 104;
    pub const NFT_ACCOUNT: usize = 136;
    pub const FEE_BPS: usize = 168;
    pub const SNIPE_BPS: usize = 170;
    pub const SNIPE_SECS: usize = 172;
    pub const SPLIT: usize = 176;
    pub const CAP_USD8: usize = 177;
    pub const CREATED_AT: usize = 185;
    pub const CREATOR_FEES: usize = 193;
    pub const PLATFORM_FEES: usize = 201;
    pub const BUMP: usize = 209;
    pub const LEN: usize = 210;
}

/// Checks the config account and returns a copy of its data.
fn load_config(a: &AccountInfo) -> Result<[u8; cfg::LEN], ProgramError> {
    req!(a.is_owned_by(&ID), E::BadAccount);
    let d = a.try_borrow_data()?;
    req!(d.len() == cfg::LEN && d[..8] == CONFIG_DISC, E::BadAccount);
    let bump = [d[cfg::BUMP]];
    req!(create_program_address(&[CONFIG_SEED, &bump], &ID)? == *a.key(), E::BadAccount);
    let mut out = [0u8; cfg::LEN];
    out.copy_from_slice(&d);
    Ok(out)
}

fn write(a: &AccountInfo, o: usize, b: &[u8]) -> ProgramResult {
    let mut d = a.try_borrow_mut_data()?;
    d[o..o + b.len()].copy_from_slice(b);
    Ok(())
}

/// Checks a coin account against its mint and returns a copy of its data.
fn load_coin(a: &AccountInfo, mint: &Pubkey) -> Result<[u8; coin::LEN], ProgramError> {
    req!(a.is_owned_by(&ID), E::BadAccount);
    let d = a.try_borrow_data()?;
    req!(d.len() == coin::LEN && d[..8] == COIN_DISC, E::BadAccount);
    req!(rd_key(&d, coin::MINT) == *mint, E::BadAccount);
    let bump = [d[coin::BUMP]];
    req!(create_program_address(&[COIN_SEED, mint, &bump], &ID)? == *a.key(), E::BadAccount);
    let mut out = [0u8; coin::LEN];
    out.copy_from_slice(&d);
    Ok(out)
}

fn admin_config<'a>(accounts: &'a [AccountInfo]) -> Result<(&'a AccountInfo, [u8; cfg::LEN]), ProgramError> {
    let [admin, config, ..] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    signer(admin)?;
    let c = load_config(config)?;
    req!(rd_key(&c, cfg::ADMIN) == *admin.key(), E::NotAdmin);
    req!(config.is_writable(), E::BadAccount);
    Ok((config, c))
}

// -------------------------------------------------------------------------
// Entrypoint
// -------------------------------------------------------------------------

program_entrypoint!(process);
no_allocator!();
#[cfg(not(test))]
nostd_panic_handler!();

pub fn process(program_id: &Pubkey, accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    req!(*program_id == ID && data.len() >= 8, E::BadInstruction);
    let (tag, rest) = data.split_at(8);
    let mut r = Rd { d: rest, o: 0 };
    match <[u8; 8]>::try_from(tag).unwrap() {
        IX_INITIALIZE => initialize(accounts, &mut r),
        IX_SET_FEE_RECIPIENT => {
            let (config, _) = admin_config(accounts)?;
            let k = r.key()?;
            write(config, cfg::FEE_RECIPIENT, &k)?;
            Wr::<80>::new(&EV_FEE_RECIPIENT_SET).raw(&k).emit();
            Ok(())
        }
        IX_SET_PRICE_UPDATER => {
            let (config, _) = admin_config(accounts)?;
            let k = r.key()?;
            write(config, cfg::PRICE_UPDATER, &k)?;
            Wr::<80>::new(&EV_PRICE_UPDATER_SET).raw(&k).emit();
            Ok(())
        }
        IX_SET_LAUNCH_TERMS => {
            let (config, _) = admin_config(accounts)?;
            let (min_first_buy, launch_fee, max_age) = (r.u64()?, r.u64()?, r.u32()?);
            write(config, cfg::MIN_FIRST_BUY, &min_first_buy.to_le_bytes())?;
            write(config, cfg::LAUNCH_FEE, &launch_fee.to_le_bytes())?;
            write(config, cfg::MAX_PRICE_AGE, &max_age.to_le_bytes())?;
            Wr::<80>::new(&EV_LAUNCH_TERMS_SET).u64(min_first_buy).u64(launch_fee).u32(max_age).emit();
            Ok(())
        }
        IX_SET_CAP_PRESETS => {
            let (config, _) = admin_config(accounts)?;
            let (p, n) = r.presets()?;
            let mut b = [0u8; 8 * MAX_CAP_PRESETS];
            let mut ev = Wr::<80>::new(&EV_CAP_PRESETS_SET);
            ev.u32(n as u32);
            for (i, v) in p.iter().enumerate() {
                b[i * 8..i * 8 + 8].copy_from_slice(&v.to_le_bytes());
                if i < n as usize {
                    ev.u64(*v);
                }
            }
            write(config, cfg::PRESET_COUNT, &[n])?;
            write(config, cfg::PRESETS, &b)?;
            ev.emit();
            Ok(())
        }
        IX_SET_PAUSED => {
            let (config, _) = admin_config(accounts)?;
            let p = r.u8()? != 0;
            write(config, cfg::PAUSED, &[p as u8])?;
            Wr::<80>::new(&EV_PAUSED_SET).u8(p as u8).emit();
            Ok(())
        }
        IX_SET_SOL_PRICE => set_sol_price(accounts, &mut r),
        IX_LAUNCH => launch(accounts, &mut r),
        IX_CLAIM_FEES => claim_fees(accounts),
        IX_SET_CREATOR => set_creator(accounts, &mut r),
        IX_COLLECT => collect(accounts, &mut r),
        _ => Err(fail(E::BadInstruction)),
    }
}

/// One-time setup, signed by the program's upgrade authority. The admin set
/// here can never change.
#[inline(never)]
fn initialize(accounts: &[AccountInfo], r: &mut Rd) -> ProgramResult {
    let [authority, config, prog, program_data, system, ..] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    signer(authority)?;
    program(system, &SYSTEM)?;
    program(prog, &ID)?;
    // the upgrade authority recorded in the program's ProgramData account
    req!(find_program_address(&[&ID], &BPF_UPGRADEABLE).0 == *program_data.key(), E::NotUpgradeAuthority);
    req!(program_data.is_owned_by(&BPF_UPGRADEABLE), E::NotUpgradeAuthority);
    {
        let d = program_data.try_borrow_data()?;
        req!(d.len() >= 45 && d[0..4] == 3u32.to_le_bytes() && d[12] == 1, E::NotUpgradeAuthority);
        req!(d[13..45] == *authority.key(), E::NotUpgradeAuthority);
    }
    let (config_key, bump) = find_program_address(&[CONFIG_SEED], &ID);
    req!(*config.key() == config_key && config.data_is_empty(), E::BadAccount);

    let admin = r.key()?;
    let fee_recipient = r.key()?;
    let price_updater = r.key()?;
    let min_first_buy = r.u64()?;
    let launch_fee = r.u64()?;
    let max_age = r.u32()?;
    let (presets, n) = r.presets()?;

    let b = [bump];
    let seeds = [Seed::from(CONFIG_SEED), Seed::from(&b)];
    sys_create(authority, config, Rent::get()?.minimum_balance(cfg::LEN), cfg::LEN as u64, &ID, &[Signer::from(&seeds)])?;
    let mut d = config.try_borrow_mut_data()?;
    d[..8].copy_from_slice(&CONFIG_DISC);
    d[cfg::ADMIN..cfg::ADMIN + 32].copy_from_slice(&admin);
    d[cfg::FEE_RECIPIENT..cfg::FEE_RECIPIENT + 32].copy_from_slice(&fee_recipient);
    d[cfg::PRICE_UPDATER..cfg::PRICE_UPDATER + 32].copy_from_slice(&price_updater);
    d[cfg::MIN_FIRST_BUY..cfg::MIN_FIRST_BUY + 8].copy_from_slice(&min_first_buy.to_le_bytes());
    d[cfg::LAUNCH_FEE..cfg::LAUNCH_FEE + 8].copy_from_slice(&launch_fee.to_le_bytes());
    d[cfg::MAX_PRICE_AGE..cfg::MAX_PRICE_AGE + 4].copy_from_slice(&max_age.to_le_bytes());
    d[cfg::PRESET_COUNT] = n;
    for (i, v) in presets.iter().enumerate() {
        let o = cfg::PRESETS + i * 8;
        d[o..o + 8].copy_from_slice(&v.to_le_bytes());
    }
    d[cfg::BUMP] = bump;
    Wr::<80>::new(&EV_INITIALIZED).raw(&admin).raw(&fee_recipient).emit();
    Ok(())
}

/// SOL/USD with 8 decimals, used to turn the dollar cap presets into SOL.
#[inline(never)]
fn set_sol_price(accounts: &[AccountInfo], r: &mut Rd) -> ProgramResult {
    let [who, config, ..] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    signer(who)?;
    let c = load_config(config)?;
    req!(rd_key(&c, cfg::PRICE_UPDATER) == *who.key() || rd_key(&c, cfg::ADMIN) == *who.key(), E::NotPriceUpdater);
    let price = r.u64()?;
    req!(price > 0, E::BadPrice);
    let now = Clock::get()?.unix_timestamp;
    write(config, cfg::SOL_USD8, &price.to_le_bytes())?;
    write(config, cfg::PRICE_AT, &now.to_le_bytes())?;
    Wr::<80>::new(&EV_SOL_PRICE_SET).u64(price).raw(&now.to_le_bytes()).emit();
    Ok(())
}

/// Borsh `PoolFeeParameters`: a linear time-scheduled base fee (anti-snipe
/// decaying to the coin's fee), no compounding, no dynamic fee.
pub fn pool_fee_params(fee_bps: u16, snipe_bps: u16, snipe_secs: u32) -> [u8; 31] {
    let base = fee_bps as u64 * damm::NUMERATOR_PER_BPS;
    let (cliff, periods, freq, reduction) = if snipe_bps == 0 {
        (base, 0u16, 0u64, 0u64)
    } else {
        let cliff = snipe_bps as u64 * damm::NUMERATOR_PER_BPS;
        let steps = SNIPE_STEPS.min(snipe_secs as u16).max(1);
        let freq = (snipe_secs as u64).div_ceil(steps as u64);
        (cliff, steps, freq, (cliff - base) / steps as u64)
    };
    let mut v = [0u8; 31];
    v[0..8].copy_from_slice(&cliff.to_le_bytes());
    v[8..10].copy_from_slice(&periods.to_le_bytes());
    v[10..18].copy_from_slice(&freq.to_le_bytes());
    v[18..26].copy_from_slice(&reduction.to_le_bytes());
    v[26] = damm::FEE_MODE_TIME_LINEAR;
    // [27..29] compounding_fee_bps = 0, [29] padding, [30] dynamic_fee = None
    v
}

/// Makes the coin and opens its pool. `first_buy` lamports of wrapped SOL
/// must already sit in the payer's WSOL account (plus 1 lamport when
/// `first_buy` is 0: DAMM v2 takes at least one unit of each token).
#[inline(never)]
fn launch(accounts: &[AccountInfo], r: &mut Rd) -> ProgramResult {
    let [payer, config, fee_recipient, mint, coin_acc, payer_coin, payer_wsol, wsol_mint, nft_mint, nft_account, pool, position, coin_vault, sol_vault, pool_authority, damm_events, damm_program, t22, token, ata_program, system, ..] =
        accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    signer(payer)?;
    signer(mint)?;
    signer(nft_mint)?;
    program(damm_program, &DAMM)?;
    program(t22, &TOKEN_2022)?;
    program(token, &TOKEN)?;
    program(ata_program, &ATA)?;
    program(system, &SYSTEM)?;
    req!(is_key(wsol_mint, &NATIVE_MINT), E::BadAccount);
    req!(config.is_writable(), E::BadAccount);
    let c = load_config(config)?;
    req!(c[cfg::PAUSED] == 0, E::Paused);

    let name = r.bytes()?;
    let symbol = r.bytes()?;
    let uri = r.bytes()?;
    let fee_bps = r.u16()?;
    let snipe_bps = r.u16()?;
    let snipe_secs = r.u32()?;
    let split = r.u8()?;
    let cap_preset = r.u8()?;
    let first_buy = r.u64()?;
    req!(!name.is_empty() && name.len() <= MAX_NAME && core::str::from_utf8(name).is_ok(), E::BadMetadata);
    req!(!symbol.is_empty() && symbol.len() <= MAX_SYMBOL && core::str::from_utf8(symbol).is_ok(), E::BadMetadata);
    req!(uri.len() <= MAX_URI && core::str::from_utf8(uri).is_ok(), E::BadMetadata);
    req!(fee_bps >= MIN_FEE_BPS && fee_bps <= MAX_FEE_BPS, E::BadFee);
    req!(snipe_bps == 0 || (snipe_bps > fee_bps && snipe_bps <= MAX_SNIPE_BPS), E::BadSnipe);
    req!((snipe_bps == 0) == (snipe_secs == 0) && snipe_secs <= MAX_SNIPE_SECS, E::BadSnipe);
    req!(split >= 1 && split <= MAX_SPLIT, E::BadSplit);
    req!(first_buy >= rd_u64(&c, cfg::MIN_FIRST_BUY), E::FirstBuyTooSmall);
    req!(cap_preset < c[cfg::PRESET_COUNT], E::BadPreset);
    req!(is_key(fee_recipient, &rd_key(&c, cfg::FEE_RECIPIENT)), E::BadFeeRecipient);

    // opening price: the dollar cap preset in SOL, for the coin's 1B total
    let now = Clock::get()?.unix_timestamp;
    let sol_usd8 = rd_u64(&c, cfg::SOL_USD8);
    let price_at = rd_u64(&c, cfg::PRICE_AT) as i64;
    let max_age = rd_u64(&c, cfg::MAX_PRICE_AGE) as u32;
    req!(sol_usd8 > 0 && now.saturating_sub(price_at) <= max_age as i64, E::StalePrice);
    let cap_usd8 = rd_u64(&c, cfg::PRESETS + cap_preset as usize * 8);
    let cap_lamports = math::mul_div(cap_usd8 as u128, 1_000_000_000, sol_usd8 as u128)
        .and_then(|v| u64::try_from(v).ok())
        .ok_or_else(|| fail(E::BadPrice))?;
    let sqrt_min = math::sqrt_price_for_cap(cap_lamports, TOTAL_SUPPLY).ok_or_else(|| fail(E::BadPrice))?;
    let sqrt_max = math::MAX_SQRT_PRICE;
    let slice = TOTAL_SUPPLY / split as u64;
    let liquidity = math::liquidity_for_coins(slice, sqrt_min, sqrt_max).ok_or_else(|| fail(E::Math))?;
    let sqrt_price = math::sqrt_price_after_buy(sqrt_min, liquidity, first_buy).ok_or_else(|| fail(E::Math))?;
    req!(sqrt_price < sqrt_max, E::Math);
    let pool_coins = math::coins_in_pool(liquidity, sqrt_price, sqrt_max).ok_or_else(|| fail(E::Math))?;
    req!(pool_coins <= slice, E::Math);

    // the payer's WSOL account funds the pool's SOL side
    let (wmint, wowner, _) = token_account(payer_wsol, &TOKEN)?;
    req!(wmint == NATIVE_MINT && wowner == *payer.key(), E::BadAccount);

    let mint_key = *mint.key();
    let (coin_key, coin_bump) = find_program_address(&[COIN_SEED, &mint_key], &ID);
    req!(*coin_acc.key() == coin_key && coin_acc.data_is_empty(), E::BadAccount);
    let cb = [coin_bump];
    let coin_seeds = [Seed::from(COIN_SEED), Seed::from(&mint_key), Seed::from(&cb)];
    let coin_signer = [Signer::from(&coin_seeds)];

    // launch fee
    let launch_fee = rd_u64(&c, cfg::LAUNCH_FEE);
    if launch_fee > 0 {
        sys_transfer(payer, fee_recipient, launch_fee)?;
    }

    // the coin's state account, which is also the PDA that owns the pool position
    let rent = Rent::get()?;
    sys_create(payer, coin_acc, rent.minimum_balance(coin::LEN), coin::LEN as u64, &ID, &coin_signer)?;

    // the mint, funded for its metadata entry up front
    let meta_len = 4 + 32 + 32 + (4 + name.len()) + (4 + symbol.len()) + (4 + uri.len()) + 4;
    sys_create(payer, mint, rent.minimum_balance(MINT_WITH_POINTER_LEN + meta_len), MINT_WITH_POINTER_LEN as u64, &TOKEN_2022, &[])?;
    // MetadataPointer::Initialize { authority: coin, metadata_address: mint }
    let mut d = Wr::<80>::new(&[39, 0]);
    d.raw(&coin_key).raw(&mint_key);
    call(&TOKEN_2022, &[AccountMeta::writable(&mint_key)], &[mint], d.out(), &[])?;
    // InitializeMint2 { decimals, mint_authority: coin, freeze_authority: None }
    let mut d = Wr::<80>::new(&[20, COIN_DECIMALS]);
    d.raw(&coin_key).u8(0);
    call(&TOKEN_2022, &[AccountMeta::writable(&mint_key)], &[mint], d.out(), &[])?;
    // token metadata, then drop its update authority so it can never change
    let mut d = Wr::<288>::new(&META_INITIALIZE);
    d.str(name).str(symbol).str(uri);
    call(
        &TOKEN_2022,
        &[
            AccountMeta::writable(&mint_key),
            AccountMeta::readonly(&coin_key),
            AccountMeta::readonly(&mint_key),
            AccountMeta::readonly_signer(&coin_key),
        ],
        &[mint, coin_acc, mint, coin_acc],
        d.out(),
        &coin_signer,
    )?;
    let mut d = Wr::<80>::new(&META_UPDATE_AUTHORITY);
    d.raw(&[0u8; 32]);
    call(
        &TOKEN_2022,
        &[AccountMeta::writable(&mint_key), AccountMeta::readonly_signer(&coin_key)],
        &[mint, coin_acc],
        d.out(),
        &coin_signer,
    )?;

    // this chain's slice of the supply goes to the payer, the pool pulls its
    // coins from there, and the remainder is the creator's first buy
    call(
        &ATA,
        &[
            AccountMeta::writable_signer(payer.key()),
            AccountMeta::writable(payer_coin.key()),
            AccountMeta::readonly(payer.key()),
            AccountMeta::readonly(&mint_key),
            AccountMeta::readonly(&SYSTEM),
            AccountMeta::readonly(&TOKEN_2022),
        ],
        &[payer, payer_coin, payer, mint, system, t22],
        &[0],
        &[],
    )?;
    let mut d = Wr::<80>::new(&[7]);
    d.u64(slice);
    call(
        &TOKEN_2022,
        &[AccountMeta::writable(&mint_key), AccountMeta::writable(payer_coin.key()), AccountMeta::readonly_signer(&coin_key)],
        &[mint, payer_coin, coin_acc],
        d.out(),
        &coin_signer,
    )?;
    // SetAuthority { MintTokens, None }
    call(
        &TOKEN_2022,
        &[AccountMeta::writable(&mint_key), AccountMeta::readonly_signer(&coin_key)],
        &[mint, coin_acc],
        &[6, 0, 0],
        &coin_signer,
    )?;

    // the pool, with the coin PDA as the position owner
    let mut d = Wr::<112>::new(&damm::IX_INIT_CUSTOMIZABLE_POOL);
    d.raw(&pool_fee_params(fee_bps, snipe_bps, snipe_secs))
        .u128(sqrt_min)
        .u128(sqrt_max)
        .u8(0) // has_alpha_vault
        .u128(liquidity)
        .u128(sqrt_price)
        .u8(damm::ACTIVATION_TIMESTAMP)
        .u8(damm::COLLECT_FEE_ONLY_B)
        .u8(0); // activation_point: None, trading opens now
    call(
        &DAMM,
        &[
            AccountMeta::readonly(&coin_key),
            AccountMeta::writable_signer(nft_mint.key()),
            AccountMeta::writable(nft_account.key()),
            AccountMeta::writable_signer(payer.key()),
            AccountMeta::readonly(pool_authority.key()),
            AccountMeta::writable(pool.key()),
            AccountMeta::writable(position.key()),
            AccountMeta::readonly(&mint_key),
            AccountMeta::readonly(&NATIVE_MINT),
            AccountMeta::writable(coin_vault.key()),
            AccountMeta::writable(sol_vault.key()),
            AccountMeta::writable(payer_coin.key()),
            AccountMeta::writable(payer_wsol.key()),
            AccountMeta::readonly(&TOKEN_2022),
            AccountMeta::readonly(&TOKEN),
            AccountMeta::readonly(&TOKEN_2022),
            AccountMeta::readonly(&SYSTEM),
            AccountMeta::readonly(damm_events.key()),
            AccountMeta::readonly(&DAMM),
        ],
        &[
            coin_acc, nft_mint, nft_account, payer, pool_authority, pool, position, mint, wsol_mint, coin_vault, sol_vault,
            payer_coin, payer_wsol, t22, token, t22, system, damm_events, damm_program,
        ],
        d.out(),
        &coin_signer,
    )?;
    // DAMM v2 derives the pool from the two mints; it is the only pool it allows
    req!(pool.is_owned_by(&DAMM), E::BadPool);

    {
        let mut s = coin_acc.try_borrow_mut_data()?;
        s[..8].copy_from_slice(&COIN_DISC);
        s[coin::MINT..coin::MINT + 32].copy_from_slice(&mint_key);
        s[coin::CREATOR..coin::CREATOR + 32].copy_from_slice(payer.key());
        s[coin::POOL..coin::POOL + 32].copy_from_slice(pool.key());
        s[coin::POSITION..coin::POSITION + 32].copy_from_slice(position.key());
        s[coin::NFT_ACCOUNT..coin::NFT_ACCOUNT + 32].copy_from_slice(nft_account.key());
        s[coin::FEE_BPS..coin::FEE_BPS + 2].copy_from_slice(&fee_bps.to_le_bytes());
        s[coin::SNIPE_BPS..coin::SNIPE_BPS + 2].copy_from_slice(&snipe_bps.to_le_bytes());
        s[coin::SNIPE_SECS..coin::SNIPE_SECS + 4].copy_from_slice(&snipe_secs.to_le_bytes());
        s[coin::SPLIT] = split;
        s[coin::CAP_USD8..coin::CAP_USD8 + 8].copy_from_slice(&cap_usd8.to_le_bytes());
        s[coin::CREATED_AT..coin::CREATED_AT + 8].copy_from_slice(&now.to_le_bytes());
        s[coin::BUMP] = coin_bump;
    }
    let launches = rd_u64(&c, cfg::LAUNCHES) + 1;
    write(config, cfg::LAUNCHES, &launches.to_le_bytes())?;

    Wr::<416>::new(&EV_LAUNCHED)
        .raw(&mint_key)
        .raw(payer.key())
        .raw(pool.key())
        .str(name)
        .str(symbol)
        .str(uri)
        .u16(fee_bps)
        .u16(snipe_bps)
        .u32(snipe_secs)
        .u8(split)
        .u64(cap_usd8)
        .u64(sol_usd8)
        .u64(first_buy)
        .u64(slice - pool_coins)
        .emit();
    Ok(())
}

/// Checks the DAMM v2 accounts shared by `claim_fees` and `collect` against
/// the coin's record.
fn check_position(s: &[u8], pool: &AccountInfo, position: &AccountInfo, nft_account: &AccountInfo) -> ProgramResult {
    req!(is_key(pool, &rd_key(s, coin::POOL)), E::BadPool);
    req!(is_key(position, &rd_key(s, coin::POSITION)), E::BadAccount);
    req!(is_key(nft_account, &rd_key(s, coin::NFT_ACCOUNT)), E::BadAccount);
    req!(position.is_owned_by(&DAMM), E::BadAccount);
    Ok(())
}

/// Pulls the position's trading fees (SOL) and pays 70% to the creator and
/// 30% to the platform. Anyone can call it.
#[inline(never)]
fn claim_fees(accounts: &[AccountInfo]) -> ProgramResult {
    let [payer, config, coin_acc, mint, wsol_mint, coin_coin, coin_wsol, creator, creator_wsol, fee_recipient, platform_wsol, pool, position, nft_account, coin_vault, sol_vault, pool_authority, damm_events, damm_program, t22, token, ata_program, system, ..] =
        accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    signer(payer)?;
    program(damm_program, &DAMM)?;
    program(t22, &TOKEN_2022)?;
    program(token, &TOKEN)?;
    program(ata_program, &ATA)?;
    program(system, &SYSTEM)?;
    req!(is_key(wsol_mint, &NATIVE_MINT), E::BadAccount);
    req!(mint.is_owned_by(&TOKEN_2022), E::BadAccount);
    let c = load_config(config)?;
    let mint_key = *mint.key();
    let s = load_coin(coin_acc, &mint_key)?;
    req!(coin_acc.is_writable(), E::BadAccount);
    check_position(&s, pool, position, nft_account)?;
    req!(is_key(creator, &rd_key(&s, coin::CREATOR)), E::BadCreator);
    req!(is_key(fee_recipient, &rd_key(&c, cfg::FEE_RECIPIENT)), E::BadFeeRecipient);

    // the ATA program checks each address is the owner's associated account
    ata_idempotent(payer, coin_coin, coin_acc, mint, system, t22)?;
    ata_idempotent(payer, coin_wsol, coin_acc, wsol_mint, system, token)?;
    ata_idempotent(payer, creator_wsol, creator, wsol_mint, system, token)?;
    ata_idempotent(payer, platform_wsol, fee_recipient, wsol_mint, system, token)?;

    let cb = [s[coin::BUMP]];
    let coin_seeds = [Seed::from(COIN_SEED), Seed::from(&mint_key), Seed::from(&cb)];
    let coin_signer = [Signer::from(&coin_seeds)];
    let before = token_amount(coin_wsol)?;
    call(
        &DAMM,
        &[
            AccountMeta::readonly(pool_authority.key()),
            AccountMeta::readonly(pool.key()),
            AccountMeta::writable(position.key()),
            AccountMeta::writable(coin_coin.key()),
            AccountMeta::writable(coin_wsol.key()),
            AccountMeta::writable(coin_vault.key()),
            AccountMeta::writable(sol_vault.key()),
            AccountMeta::readonly(&mint_key),
            AccountMeta::readonly(&NATIVE_MINT),
            AccountMeta::readonly(nft_account.key()),
            AccountMeta::readonly_signer(coin_acc.key()),
            AccountMeta::readonly(&TOKEN_2022),
            AccountMeta::readonly(&TOKEN),
            AccountMeta::readonly(damm_events.key()),
            AccountMeta::readonly(&DAMM),
        ],
        &[
            pool_authority, pool, position, coin_coin, coin_wsol, coin_vault, sol_vault, mint, wsol_mint, nft_account, coin_acc, t22,
            token, damm_events, damm_program,
        ],
        &damm::IX_CLAIM_POSITION_FEE,
        &coin_signer,
    )?;
    // everything in the coin's WSOL account is unsplit fees; it holds nothing else
    let total = token_amount(coin_wsol)?;
    let claimed = total.saturating_sub(before);
    if total == 0 {
        return Ok(());
    }
    let to_creator = math::mul_div(total as u128, CREATOR_SPLIT_BPS as u128, BPS as u128).ok_or_else(|| fail(E::Math))? as u64;
    let to_platform = total - to_creator;
    if to_creator > 0 {
        token_transfer(&TOKEN, coin_wsol, creator_wsol, coin_acc, to_creator, &coin_signer)?;
    }
    if to_platform > 0 {
        token_transfer(&TOKEN, coin_wsol, platform_wsol, coin_acc, to_platform, &coin_signer)?;
    }
    let cf = rd_u64(&s, coin::CREATOR_FEES).saturating_add(to_creator);
    let pf = rd_u64(&s, coin::PLATFORM_FEES).saturating_add(to_platform);
    write(coin_acc, coin::CREATOR_FEES, &cf.to_le_bytes())?;
    write(coin_acc, coin::PLATFORM_FEES, &pf.to_le_bytes())?;
    Wr::<80>::new(&EV_FEES_CLAIMED).raw(&mint_key).u64(claimed).u64(to_creator).u64(to_platform).emit();
    Ok(())
}

/// The creator hands the coin's creator share to another wallet.
#[inline(never)]
fn set_creator(accounts: &[AccountInfo], r: &mut Rd) -> ProgramResult {
    let [who, coin_acc, ..] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    signer(who)?;
    req!(coin_acc.is_writable() && coin_acc.is_owned_by(&ID), E::BadAccount);
    let mint = {
        let d = coin_acc.try_borrow_data()?;
        req!(d.len() == coin::LEN && d[..8] == COIN_DISC, E::BadAccount);
        rd_key(&d, coin::MINT)
    };
    let s = load_coin(coin_acc, &mint)?;
    let previous = rd_key(&s, coin::CREATOR);
    req!(previous == *who.key(), E::BadCreator);
    let next = r.key()?;
    write(coin_acc, coin::CREATOR, &next)?;
    Wr::<112>::new(&EV_CREATOR_SET).raw(&mint).raw(&previous).raw(&next).emit();
    Ok(())
}

/// Admin only: removes `bps` of the position's liquidity and sends the coins
/// and SOL to the given accounts. Fees already earned stay in the position
/// for `claim_fees`.
#[inline(never)]
fn collect(accounts: &[AccountInfo], r: &mut Rd) -> ProgramResult {
    let [admin, config, coin_acc, mint, wsol_mint, to_coin, to_wsol, pool, position, nft_account, coin_vault, sol_vault, pool_authority, damm_events, damm_program, t22, token, ..] =
        accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    signer(admin)?;
    let c = load_config(config)?;
    req!(rd_key(&c, cfg::ADMIN) == *admin.key(), E::NotAdmin);
    program(damm_program, &DAMM)?;
    program(t22, &TOKEN_2022)?;
    program(token, &TOKEN)?;
    req!(is_key(wsol_mint, &NATIVE_MINT), E::BadAccount);
    let mint_key = *mint.key();
    let s = load_coin(coin_acc, &mint_key)?;
    check_position(&s, pool, position, nft_account)?;
    let (cm, _, coins_before) = token_account(to_coin, &TOKEN_2022)?;
    req!(cm == mint_key, E::BadAccount);
    let (wm, _, sol_before) = token_account(to_wsol, &TOKEN)?;
    req!(wm == NATIVE_MINT, E::BadAccount);

    let bps = r.u16()?;
    req!(bps > 0 && bps as u64 <= BPS, E::BadBps);
    let unlocked = {
        let d = position.try_borrow_data()?;
        let o = damm::POSITION_UNLOCKED_LIQUIDITY_OFFSET;
        req!(d.len() >= o + 16, E::BadAccount);
        u128::from_le_bytes(d[o..o + 16].try_into().unwrap())
    };
    let delta = math::mul_div(unlocked, bps as u128, BPS as u128).ok_or_else(|| fail(E::Math))?;
    req!(delta > 0, E::NothingToCollect);

    let cb = [s[coin::BUMP]];
    let coin_seeds = [Seed::from(COIN_SEED), Seed::from(&mint_key), Seed::from(&cb)];
    let mut d = Wr::<80>::new(&damm::IX_REMOVE_LIQUIDITY);
    d.u128(delta).u64(0).u64(0);
    call(
        &DAMM,
        &[
            AccountMeta::readonly(pool_authority.key()),
            AccountMeta::writable(pool.key()),
            AccountMeta::writable(position.key()),
            AccountMeta::writable(to_coin.key()),
            AccountMeta::writable(to_wsol.key()),
            AccountMeta::writable(coin_vault.key()),
            AccountMeta::writable(sol_vault.key()),
            AccountMeta::readonly(&mint_key),
            AccountMeta::readonly(&NATIVE_MINT),
            AccountMeta::readonly(nft_account.key()),
            AccountMeta::readonly_signer(coin_acc.key()),
            AccountMeta::readonly(&TOKEN_2022),
            AccountMeta::readonly(&TOKEN),
            AccountMeta::readonly(damm_events.key()),
            AccountMeta::readonly(&DAMM),
        ],
        &[
            pool_authority, pool, position, to_coin, to_wsol, coin_vault, sol_vault, mint, wsol_mint, nft_account, coin_acc, t22, token,
            damm_events, damm_program,
        ],
        d.out(),
        &[Signer::from(&coin_seeds)],
    )?;
    let coins = token_amount(to_coin)?.saturating_sub(coins_before);
    let sol = token_amount(to_wsol)?.saturating_sub(sol_before);
    Wr::<160>::new(&EV_COLLECTED)
        .raw(&mint_key)
        .u16(bps)
        .u128(delta)
        .u64(coins)
        .u64(sol)
        .raw(to_coin.key())
        .raw(to_wsol.key())
        .emit();
    Ok(())
}
