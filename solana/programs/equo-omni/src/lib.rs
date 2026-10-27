//! Equo on Solana (v3): the Solana leg of a launch that spans several chains.
//!
//! A launch is authorised by the same EIP-712 snapshot the EVM factories take: signed once by the launch service
//! for every chain, it names the coin and, per chain, the coin's address, its share of the 1B supply and the USD
//! price of that chain's pair. This program checks the signature (secp256k1, as on the EVM chains), the Solana
//! leg, and that the snapshot is fresh and unused (post_snapshot), then at launch:
//!   - makes the Token-2022 coin (9 decimals, metadata on the mint, no freeze authority, immutable metadata),
//!   - mints Solana's 1B and opens a Meteora DAMM v2 pool against wrapped SOL at $3,000 for it (the same price as
//!     every other chain), with the coin's fixed fee and a floor at the opening price,
//!   - hands the mint authority to the coin's LayerZero OFT store, so bridging mints and burns the coin like every
//!     other chain's copy. The launch service then initialises the OFT store and wires its EVM peers.
//!
//! The Solana leg of a snapshot: eid 30168, `coin` = the OFT store (PDA of the OFT program over the store's
//! escrow), `legSalt` = the creator's Solana wallet, which receives the creator's fees and launch-buy coins.
//!
//! The pool position belongs to the coin's PDA:
//!   - fees are taken in SOL; anyone can call `claim_fees`, which pays the platform the larger of 20% of the fee
//!     and 0.2% of the volume it came from, and the creator the rest (Meteora keeps its own protocol share first);
//!   - `collect` lets the admin remove a share of the position's liquidity, as on the EVM chains.
//!
//! The creator's launch buy is built into the opening price (fee-free), so nobody trades before it. When the
//! snapshot names Solana as the paying leg (`feeEid`), the launch fee is paid here in SOL, to the launcher.
//!
//! Written on Pinocchio to keep the program small; instruction, account and event encodings follow Anchor's.

#![cfg_attr(not(test), no_std)]

use pinocchio::{
    account_info::AccountInfo,
    cpi::slice_invoke_signed,
    instruction::{AccountMeta, Instruction, Seed, Signer},
    log::sol_log_data,
    msg, no_allocator, nostd_panic_handler, program_entrypoint,
    program_error::ProgramError,
    pubkey::{create_program_address, find_program_address, Pubkey},
    sysvars::{clock::Clock, rent::Rent, Sysvar},
    ProgramResult,
};

pub mod math;

/// 8tQmVEDRd4gBXP2brdgKxtmzXbTD3y8uEbY1erS1UFKq
pub const ID: Pubkey = [117, 45, 77, 158, 18, 189, 127, 67, 109, 168, 105, 4, 240, 180, 139, 229, 179, 103, 160, 228, 41, 54, 166, 146, 18, 252, 103, 135, 167, 188, 135, 212];
/// Meteora DAMM v2, cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG
pub const DAMM: Pubkey = [9, 45, 33, 53, 101, 122, 21, 156, 43, 135, 212, 182, 106, 112, 219, 142, 151, 82, 56, 159, 247, 106, 175, 32, 108, 237, 6, 58, 56, 249, 90, 237];
/// Equo's instance of the LayerZero OFT program, RuyLPEWoYG2b6mGb6nvKotoNhW2F9KdhrjRghaRdGkz
pub const OFT_PROGRAM: Pubkey = [6, 97, 213, 144, 94, 236, 0, 90, 25, 235, 230, 134, 247, 12, 181, 158, 43, 252, 239, 65, 121, 129, 244, 38, 84, 133, 5, 241, 223, 189, 83, 83];
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

/// LayerZero's endpoint id for Solana mainnet.
pub const SOL_EID: u32 = 30168;
pub const COIN_DECIMALS: u8 = 9;
/// A coin's supply on each of its chains: 1B. A coin on N chains has N billion.
pub const CHAIN_SUPPLY: u64 = 1_000_000_000 * 1_000_000_000;
/// Every chain's 1B opens at this market cap (USD, 18 decimals), so every chain opens at the same price.
pub const START_MCAP_USD18: u128 = 3_000 * 1_000_000_000_000_000_000;
pub const BPS: u64 = 10_000;
pub const MIN_FEE_BPS: u16 = 100;
pub const MAX_FEE_BPS: u16 = 500;
/// The platform's part of a fee: the larger of this share of the fee...
pub const PLATFORM_FEE_SHARE_BPS: u64 = 2_000;
/// ...and this share of the volume the fee came from.
pub const PLATFORM_VOLUME_BPS: u64 = 20;
pub const MAX_SNAPSHOT_LIFE: i64 = 3_600;
/// The most a launch fee may be (USD, 18 decimals), as on the EVM factories.
pub const MAX_LAUNCH_FEE_USD18: u128 = 50 * 1_000_000_000_000_000_000;
pub const MAX_LEGS: usize = 16;
pub const MAX_NAME: usize = 32;
pub const MAX_SYMBOL: usize = 10;
pub const MAX_URI: usize = 200;

pub const CONFIG_SEED: &[u8] = b"config2";
pub const COIN_SEED: &[u8] = b"coin2";
pub const LAUNCH_SEED: &[u8] = b"launch";
pub const OFT_SEED: &[u8] = b"OFT";

/// Meteora DAMM v2 (cp-amm) constants.
pub mod damm {
    pub const IX_INIT_CUSTOMIZABLE_POOL: [u8; 8] = [20, 161, 241, 24, 189, 221, 180, 2];
    pub const IX_CLAIM_POSITION_FEE: [u8; 8] = [180, 38, 154, 17, 133, 33, 162, 211];
    pub const IX_REMOVE_LIQUIDITY: [u8; 8] = [80, 85, 209, 72, 24, 206, 177, 108];
    pub const FEE_MODE_TIME_LINEAR: u8 = 0;
    pub const ACTIVATION_TIMESTAMP: u8 = 1;
    pub const COLLECT_FEE_ONLY_B: u8 = 1;
    pub const NUMERATOR_PER_BPS: u64 = 100_000;
    pub const POSITION_UNLOCKED_LIQUIDITY_OFFSET: usize = 8 + 32 + 32 + 32 + 32 + 8 + 8;
}

// sha256("global:<name>")[..8]
const IX_INITIALIZE: [u8; 8] = [175, 175, 109, 31, 13, 152, 155, 237];
const IX_SET_FEE_RECIPIENT: [u8; 8] = [227, 18, 215, 42, 237, 246, 151, 66];
const IX_SET_SIGNER: [u8; 8] = [127, 120, 252, 184, 97, 4, 88, 68];
const IX_SET_LAUNCHER: [u8; 8] = [245, 86, 152, 150, 200, 12, 231, 155];
const IX_SET_QUOTE_BAND: [u8; 8] = [22, 150, 142, 80, 140, 249, 82, 75];
const IX_POST_SNAPSHOT: [u8; 8] = [44, 200, 134, 75, 104, 188, 11, 73];
const IX_LAUNCH: [u8; 8] = [153, 241, 93, 225, 22, 69, 74, 61];
const IX_CLAIM_FEES: [u8; 8] = [82, 251, 233, 156, 12, 52, 184, 202];
const IX_SET_CREATOR: [u8; 8] = [254, 148, 255, 112, 207, 142, 170, 165];
const IX_COLLECT: [u8; 8] = [208, 47, 194, 155, 17, 98, 82, 236];

// sha256("account:<Name>")[..8]
const CONFIG_DISC: [u8; 8] = [2, 19, 141, 11, 71, 106, 211, 166];
const COIN_DISC: [u8; 8] = [176, 212, 7, 162, 207, 250, 138, 206];
const SNAP_DISC: [u8; 8] = [179, 90, 89, 154, 14, 253, 29, 198];

// sha256("event:<Name>")[..8]
const EV_INITIALIZED: [u8; 8] = [208, 213, 115, 98, 115, 82, 201, 209];
const EV_FEE_RECIPIENT_SET: [u8; 8] = [99, 140, 80, 35, 245, 176, 179, 110];
const EV_SIGNER_SET: [u8; 8] = [137, 203, 187, 74, 141, 187, 226, 95];
const EV_LAUNCHER_SET: [u8; 8] = [180, 188, 168, 150, 212, 107, 49, 116];
const EV_QUOTE_BAND_SET: [u8; 8] = [65, 152, 205, 25, 214, 235, 252, 163];
const EV_LAUNCHED: [u8; 8] = [209, 127, 29, 152, 129, 212, 189, 183];
const EV_FEES_CLAIMED: [u8; 8] = [22, 104, 110, 222, 38, 157, 14, 62];
const EV_CREATOR_SET: [u8; 8] = [95, 242, 20, 222, 81, 81, 181, 66];
const EV_COLLECTED: [u8; 8] = [67, 109, 138, 167, 168, 239, 2, 207];

// spl-token-metadata-interface: sha256("spl_token_metadata_interface:<name>")[..8]
const META_INITIALIZE: [u8; 8] = [210, 225, 30, 162, 88, 184, 77, 141];
const META_UPDATE_AUTHORITY: [u8; 8] = [215, 228, 166, 228, 84, 100, 86, 123];

/// Token-2022 mint with the MetadataPointer extension, before the metadata TLV entry.
const MINT_WITH_POINTER_LEN: usize = 234;

/// secp256k1 group order / 2: signatures with a higher s are refused (no malleable twins).
const SECP_HALF_N: [u8; 32] = [
    0x7f, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x5d, 0x57, 0x6e, 0x73, 0x57, 0xa4, 0x50, 0x1d,
    0xdf, 0xe9, 0x2f, 0x46, 0x68, 0x1b, 0x20, 0xa0,
];

// -------------------------------------------------------------------------
// Errors
// -------------------------------------------------------------------------

#[derive(Clone, Copy)]
#[repr(u32)]
pub enum E {
    NotUpgradeAuthority,
    NotAdmin,
    NotAllowed,
    BadMetadata,
    BadFee,
    BadSnapshot,
    BadSignature,
    Expired,
    AlreadyLaunched,
    PriceOutOfBand,
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

const ERR_LOG: [&str; 19] = [
    "Error: NotUpgradeAuthority. Signer is not the program's upgrade authority",
    "Error: NotAdmin. Signer is not the admin",
    "Error: NotAllowed. Only the creator or the launcher may launch",
    "Error: BadMetadata. Name, symbol or URI is empty or too long",
    "Error: BadFee. Fee must be 100 to 500 bps",
    "Error: BadSnapshot. Legs, slices or the Solana leg are wrong",
    "Error: BadSignature. The snapshot is not signed by the signer",
    "Error: Expired. The snapshot is past its deadline or more than an hour ahead",
    "Error: AlreadyLaunched. This launch id already launched here",
    "Error: PriceOutOfBand. The SOL price is outside the admin's band",
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
    fn u128(&mut self) -> Result<u128, ProgramError> {
        Ok(u128::from_le_bytes(self.take(16)?.try_into().unwrap()))
    }
    fn key(&mut self) -> Result<Pubkey, ProgramError> {
        Ok(self.take(32)?.try_into().unwrap())
    }
    fn bytes(&mut self) -> Result<&'a [u8], ProgramError> {
        let n = self.u32()? as usize;
        self.take(n)
    }
}

fn rd_u64(d: &[u8], o: usize) -> u64 {
    u64::from_le_bytes(d[o..o + 8].try_into().unwrap())
}
fn rd_u128(d: &[u8], o: usize) -> u128 {
    u128::from_le_bytes(d[o..o + 16].try_into().unwrap())
}
fn rd_key(d: &[u8], o: usize) -> Pubkey {
    d[o..o + 32].try_into().unwrap()
}

/// Borsh writer for instruction data and events, on the stack (the program has no heap).
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
// Hashing and signatures (the EVM chains' EIP-712, on Solana's syscalls)
// -------------------------------------------------------------------------

#[cfg(target_os = "solana")]
fn keccak(parts: &[&[u8]]) -> [u8; 32] {
    let mut out = [0u8; 32];
    unsafe {
        pinocchio::syscalls::sol_keccak256(parts as *const _ as *const u8, parts.len() as u64, out.as_mut_ptr());
    }
    out
}

#[cfg(not(target_os = "solana"))]
fn keccak(_parts: &[&[u8]]) -> [u8; 32] {
    [0u8; 32]
}

/// The Ethereum address that signed `digest` (65-byte r, s, v), or None.
#[cfg(target_os = "solana")]
fn recover(digest: &[u8; 32], sig: &[u8]) -> Option<[u8; 20]> {
    if sig.len() != 65 || sig[32..64] > SECP_HALF_N[..] {
        return None;
    }
    let v = sig[64];
    let rid = if v >= 27 { v - 27 } else { v };
    if rid > 1 {
        return None;
    }
    let mut pk = [0u8; 64];
    let rc = unsafe { pinocchio::syscalls::sol_secp256k1_recover(digest.as_ptr(), rid as u64, sig.as_ptr(), pk.as_mut_ptr()) };
    if rc != 0 {
        return None;
    }
    let h = keccak(&[&pk]);
    let mut a = [0u8; 20];
    a.copy_from_slice(&h[12..]);
    Some(a)
}

#[cfg(not(target_os = "solana"))]
fn recover(_digest: &[u8; 32], _sig: &[u8]) -> Option<[u8; 20]> {
    let _ = SECP_HALF_N;
    None
}

fn word_u64(v: u64) -> [u8; 32] {
    let mut w = [0u8; 32];
    w[24..].copy_from_slice(&v.to_be_bytes());
    w
}

fn word_u128(v: u128) -> [u8; 32] {
    let mut w = [0u8; 32];
    w[16..].copy_from_slice(&v.to_be_bytes());
    w
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

/// System transfer of `lamports` from `from` (a signer) to `to`.
fn sys_transfer(from: &AccountInfo, to: &AccountInfo, lamports: u64) -> ProgramResult {
    let mut d = Wr::<16>::new(&2u32.to_le_bytes());
    d.u64(lamports);
    call(&SYSTEM, &[AccountMeta::writable_signer(from.key()), AccountMeta::writable(to.key())], &[from, to], d.out(), &[])
}

/// Creates `ata` (owner's associated account for `mint`) if it is missing. The ATA program checks the address.
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

/// ConfigV2, after the 8-byte discriminator.
mod cfg {
    pub const ADMIN: usize = 8;
    pub const FEE_RECIPIENT: usize = 40;
    pub const LAUNCHER: usize = 72;
    pub const SIGNER: usize = 104; // Ethereum address, 20 bytes
    pub const MIN_QUOTE: usize = 124; // u128, USD per SOL, 18 decimals
    pub const MAX_QUOTE: usize = 140;
    pub const LAUNCHES: usize = 156;
    pub const BUMP: usize = 164;
    pub const LEN: usize = 165;
}

/// CoinV2, after the 8-byte discriminator.
mod coin {
    pub const MINT: usize = 8;
    pub const CREATOR: usize = 40;
    pub const POOL: usize = 72;
    pub const POSITION: usize = 104;
    pub const NFT_ACCOUNT: usize = 136;
    pub const OFT_STORE: usize = 168;
    pub const LAUNCH_ID: usize = 200;
    pub const FEE_BPS: usize = 232;
    pub const SLICE: usize = 234;
    pub const QUOTE_USD18: usize = 242;
    pub const CREATED_AT: usize = 258;
    pub const CREATOR_FEES: usize = 266;
    pub const PLATFORM_FEES: usize = 274;
    pub const BUMP: usize = 282;
    pub const LEN: usize = 283;
}

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

fn admin_config<'a>(accounts: &'a [AccountInfo]) -> Result<&'a AccountInfo, ProgramError> {
    let [admin, config, ..] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    signer(admin)?;
    let c = load_config(config)?;
    req!(rd_key(&c, cfg::ADMIN) == *admin.key(), E::NotAdmin);
    req!(config.is_writable(), E::BadAccount);
    Ok(config)
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
            let config = admin_config(accounts)?;
            let k = r.key()?;
            write(config, cfg::FEE_RECIPIENT, &k)?;
            Wr::<80>::new(&EV_FEE_RECIPIENT_SET).raw(&k).emit();
            Ok(())
        }
        IX_SET_LAUNCHER => {
            let config = admin_config(accounts)?;
            let k = r.key()?;
            write(config, cfg::LAUNCHER, &k)?;
            Wr::<80>::new(&EV_LAUNCHER_SET).raw(&k).emit();
            Ok(())
        }
        IX_SET_SIGNER => {
            let config = admin_config(accounts)?;
            let k = r.take(20)?;
            req!(k != [0u8; 20], E::BadInstruction);
            write(config, cfg::SIGNER, k)?;
            Wr::<80>::new(&EV_SIGNER_SET).raw(k).emit();
            Ok(())
        }
        IX_SET_QUOTE_BAND => {
            let config = admin_config(accounts)?;
            let (lo, hi) = (r.u128()?, r.u128()?);
            req!(lo > 0 && hi > lo, E::BadInstruction);
            write(config, cfg::MIN_QUOTE, &lo.to_le_bytes())?;
            write(config, cfg::MAX_QUOTE, &hi.to_le_bytes())?;
            Wr::<80>::new(&EV_QUOTE_BAND_SET).u128(lo).u128(hi).emit();
            Ok(())
        }
        IX_POST_SNAPSHOT => post_snapshot(accounts, &mut r),
        IX_LAUNCH => launch(accounts, &mut r),
        IX_CLAIM_FEES => claim_fees(accounts),
        IX_SET_CREATOR => set_creator(accounts, &mut r),
        IX_COLLECT => collect(accounts, &mut r),
        _ => Err(fail(E::BadInstruction)),
    }
}

/// One-time setup, signed by the program's upgrade authority. The admin set here can never change.
#[inline(never)]
fn initialize(accounts: &[AccountInfo], r: &mut Rd) -> ProgramResult {
    let [authority, config, prog, program_data, system, ..] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    signer(authority)?;
    program(system, &SYSTEM)?;
    program(prog, &ID)?;
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
    let launcher = r.key()?;
    let signer_eth = r.take(20)?;
    let (lo, hi) = (r.u128()?, r.u128()?);
    req!(lo > 0 && hi > lo && signer_eth != [0u8; 20], E::BadInstruction);

    let b = [bump];
    let seeds = [Seed::from(CONFIG_SEED), Seed::from(&b)];
    sys_create(authority, config, Rent::get()?.minimum_balance(cfg::LEN), cfg::LEN as u64, &ID, &[Signer::from(&seeds)])?;
    let mut d = config.try_borrow_mut_data()?;
    d[..8].copy_from_slice(&CONFIG_DISC);
    d[cfg::ADMIN..cfg::ADMIN + 32].copy_from_slice(&admin);
    d[cfg::FEE_RECIPIENT..cfg::FEE_RECIPIENT + 32].copy_from_slice(&fee_recipient);
    d[cfg::LAUNCHER..cfg::LAUNCHER + 32].copy_from_slice(&launcher);
    d[cfg::SIGNER..cfg::SIGNER + 20].copy_from_slice(signer_eth);
    d[cfg::MIN_QUOTE..cfg::MIN_QUOTE + 16].copy_from_slice(&lo.to_le_bytes());
    d[cfg::MAX_QUOTE..cfg::MAX_QUOTE + 16].copy_from_slice(&hi.to_le_bytes());
    d[cfg::BUMP] = bump;
    Wr::<80>::new(&EV_INITIALIZED).raw(&admin).raw(&fee_recipient).emit();
    Ok(())
}

/// Borsh `PoolFeeParameters`: one flat base fee, no schedule, no dynamic fee.
pub fn pool_fee_params(fee_bps: u16) -> [u8; 31] {
    let base = fee_bps as u64 * damm::NUMERATOR_PER_BPS;
    let mut v = [0u8; 31];
    v[0..8].copy_from_slice(&base.to_le_bytes());
    v[26] = damm::FEE_MODE_TIME_LINEAR;
    v
}

/// The platform's share of a claimed fee, in bps: the larger of 20% of the fee and 0.2% of the volume it came
/// from (with a flat fee, the volume is the fee over the fee rate), capped at the whole fee.
pub fn platform_share_bps(fee_bps: u16) -> u64 {
    let by_volume = PLATFORM_VOLUME_BPS * BPS / fee_bps.max(1) as u64;
    by_volume.max(PLATFORM_FEE_SHARE_BPS).min(BPS)
}

/// LaunchSnapshot (the launch marker PDA ["launch", launch_id]), after the 8-byte discriminator: the Solana leg
/// of a verified snapshot, waiting for (or done with) its launch.
mod snap {
    pub const STATE: usize = 8; // 0 posted, 1 launched
    pub const LAUNCH_ID: usize = 9;
    pub const CREATOR_ETH: usize = 41;
    pub const CREATOR: usize = 61;
    pub const COIN: usize = 93;
    pub const FEE_BPS: usize = 125;
    pub const DEADLINE: usize = 127;
    pub const SLICE: usize = 135;
    pub const QUOTE: usize = 143;
    pub const NAME: usize = 159; // u8 len + 32
    pub const SYMBOL: usize = 192; // u8 len + 10
    pub const URI: usize = 203; // u8 len + 200
    pub const FEE_EID: usize = 404; // the chain whose leg pays the launch fee
    pub const LAUNCH_FEE_USD18: usize = 408; // u128
    pub const LEN: usize = 424;
}

/// Verifies a launch snapshot and records its Solana leg in the launch marker, so the launch itself fits in one
/// transaction. The creator or the launcher posts it.
///
/// Data: launch_id[32], creator_eth[20], name, symbol, uri (u32-prefixed), fee_bps u16, deadline u64, fee_eid u32,
/// launch_fee_usd18 u128, legs u32, then
/// per leg a tag: 0 + the leg's EIP-712 hash[32] (another chain's leg), or 1 + eid u32, coin[32], leg_salt[32],
/// pair[32] (zero: SOL), slice u64, quote_usd18 u128 (the Solana leg, exactly one), then the signature[65].
///
/// Only the Solana leg is spelled out (the full snapshot does not fit a Solana transaction); the signature still
/// covers every leg, and every chain checks its own leg is 1B.
#[inline(never)]
fn post_snapshot(accounts: &[AccountInfo], r: &mut Rd) -> ProgramResult {
    let [payer, config, marker, system, ..] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    signer(payer)?;
    program(system, &SYSTEM)?;
    let c = load_config(config)?;

    let launch_id = r.take(32)?;
    let creator_eth = r.take(20)?;
    let name = r.bytes()?;
    let symbol = r.bytes()?;
    let uri = r.bytes()?;
    let fee_bps = r.u16()?;
    let deadline = r.u64()?;
    let fee_eid = r.u32()?;
    let launch_fee = r.u128()?;
    let n = r.u32()? as usize;
    req!(launch_fee <= MAX_LAUNCH_FEE_USD18, E::BadSnapshot);
    req!(n >= 1 && n <= MAX_LEGS, E::BadSnapshot);
    req!(!name.is_empty() && name.len() <= MAX_NAME && core::str::from_utf8(name).is_ok(), E::BadMetadata);
    req!(!symbol.is_empty() && symbol.len() <= MAX_SYMBOL && core::str::from_utf8(symbol).is_ok(), E::BadMetadata);
    req!(uri.len() <= MAX_URI && core::str::from_utf8(uri).is_ok(), E::BadMetadata);
    req!(fee_bps >= MIN_FEE_BPS && fee_bps <= MAX_FEE_BPS, E::BadFee);

    let leg_type = keccak(&[b"Leg(uint32 eid,bytes32 coin,bytes32 legSalt,bytes32 pair,uint256 slice,uint256 quoteUsd18)"]);
    let mut leg_hashes = [0u8; 32 * MAX_LEGS];
    let mut sol: Option<(u64, u128, Pubkey, Pubkey)> = None;
    for i in 0..n {
        if r.u8()? == 0 {
            leg_hashes[i * 32..i * 32 + 32].copy_from_slice(r.take(32)?);
            continue;
        }
        let eid = r.u32()?;
        let coin_b = r.take(32)?;
        let salt_b = r.take(32)?;
        let pair_b = r.take(32)?;
        let slice = r.u64()?;
        let quote = r.u128()?;
        // the Solana leg pairs against SOL (zero): the only pair this program opens pools with
        req!(eid == SOL_EID && sol.is_none() && pair_b == [0u8; 32], E::BadSnapshot);
        req!(slice == CHAIN_SUPPLY, E::BadSnapshot);
        let h = keccak(&[&leg_type, &word_u64(eid as u64), coin_b, salt_b, pair_b, &word_u64(slice), &word_u128(quote)]);
        leg_hashes[i * 32..i * 32 + 32].copy_from_slice(&h);
        sol = Some((slice, quote, coin_b.try_into().unwrap(), salt_b.try_into().unwrap()));
    }
    let (slice, quote, coin, creator) = sol.ok_or_else(|| fail(E::BadSnapshot))?;
    let sig = r.take(65)?;

    let snap_type = keccak(&[
        b"Snapshot(bytes32 launchId,address creator,string name,string symbol,string metadataURI,uint16 feeBps,uint64 deadline,uint32 feeEid,uint256 launchFeeUsd18,Leg[] legs)",
        b"Leg(uint32 eid,bytes32 coin,bytes32 legSalt,bytes32 pair,uint256 slice,uint256 quoteUsd18)",
    ]);
    let mut creator_word = [0u8; 32];
    creator_word[12..].copy_from_slice(creator_eth);
    let struct_hash = keccak(&[
        &snap_type,
        launch_id,
        &creator_word,
        &keccak(&[name]),
        &keccak(&[symbol]),
        &keccak(&[uri]),
        &word_u64(fee_bps as u64),
        &word_u64(deadline),
        &word_u64(fee_eid as u64),
        &word_u128(launch_fee),
        &keccak(&[&leg_hashes[..n * 32]]),
    ]);
    let domain = keccak(&[&keccak(&[b"EIP712Domain(string name,string version)"]), &keccak(&[b"Equo"]), &keccak(&[b"2"])]);
    let digest = keccak(&[b"\x19\x01", &domain, &struct_hash]);
    req!(recover(&digest, sig).map(|a| a[..] == c[cfg::SIGNER..cfg::SIGNER + 20]).unwrap_or(false), E::BadSignature);

    let now = Clock::get()?.unix_timestamp;
    req!(now <= deadline as i64 && (deadline as i64) <= now + MAX_SNAPSHOT_LIFE, E::Expired);
    req!(quote >= rd_u128(&c, cfg::MIN_QUOTE) && quote <= rd_u128(&c, cfg::MAX_QUOTE), E::PriceOutOfBand);
    req!(*payer.key() == creator || *payer.key() == rd_key(&c, cfg::LAUNCHER), E::NotAllowed);

    let (marker_key, marker_bump) = find_program_address(&[LAUNCH_SEED, launch_id], &ID);
    req!(*marker.key() == marker_key, E::BadAccount);
    req!(marker.data_is_empty(), E::AlreadyLaunched);
    let mb = [marker_bump];
    let seeds = [Seed::from(LAUNCH_SEED), Seed::from(launch_id), Seed::from(&mb)];
    sys_create(payer, marker, Rent::get()?.minimum_balance(snap::LEN), snap::LEN as u64, &ID, &[Signer::from(&seeds)])?;
    let mut d = marker.try_borrow_mut_data()?;
    d[..8].copy_from_slice(&SNAP_DISC);
    d[snap::LAUNCH_ID..snap::LAUNCH_ID + 32].copy_from_slice(launch_id);
    d[snap::CREATOR_ETH..snap::CREATOR_ETH + 20].copy_from_slice(creator_eth);
    d[snap::CREATOR..snap::CREATOR + 32].copy_from_slice(&creator);
    d[snap::COIN..snap::COIN + 32].copy_from_slice(&coin);
    d[snap::FEE_BPS..snap::FEE_BPS + 2].copy_from_slice(&fee_bps.to_le_bytes());
    d[snap::DEADLINE..snap::DEADLINE + 8].copy_from_slice(&deadline.to_le_bytes());
    d[snap::SLICE..snap::SLICE + 8].copy_from_slice(&slice.to_le_bytes());
    d[snap::QUOTE..snap::QUOTE + 16].copy_from_slice(&quote.to_le_bytes());
    d[snap::NAME] = name.len() as u8;
    d[snap::NAME + 1..snap::NAME + 1 + name.len()].copy_from_slice(name);
    d[snap::SYMBOL] = symbol.len() as u8;
    d[snap::SYMBOL + 1..snap::SYMBOL + 1 + symbol.len()].copy_from_slice(symbol);
    d[snap::URI] = uri.len() as u8;
    d[snap::URI + 1..snap::URI + 1 + uri.len()].copy_from_slice(uri);
    d[snap::FEE_EID..snap::FEE_EID + 4].copy_from_slice(&fee_eid.to_le_bytes());
    d[snap::LAUNCH_FEE_USD18..snap::LAUNCH_FEE_USD18 + 16].copy_from_slice(&launch_fee.to_le_bytes());
    Ok(())
}

/// Makes the coin and opens its pool from a posted snapshot. `first_buy` lamports of wrapped SOL must already sit
/// in the payer's WSOL account (plus 1 lamport when `first_buy` is 0: DAMM v2 takes at least one unit of each token).
#[inline(never)]
fn launch(accounts: &[AccountInfo], r: &mut Rd) -> ProgramResult {
    let [payer, config, mint, coin_acc, payer_coin, payer_wsol, wsol_mint, nft_mint, nft_account, pool, position, coin_vault, sol_vault, pool_authority, damm_events, damm_program, t22, token, ata_program, system, marker, oft_escrow, creator, creator_coin, launch_fee_to, ..] =
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
    req!(config.is_writable() && marker.is_writable(), E::BadAccount);
    let c = load_config(config)?;
    let first_buy = r.u64()?;

    // the posted snapshot
    let mut m = [0u8; snap::LEN];
    {
        req!(marker.is_owned_by(&ID), E::BadAccount);
        let d = marker.try_borrow_data()?;
        req!(d.len() == snap::LEN && d[..8] == SNAP_DISC, E::BadAccount);
        m.copy_from_slice(&d);
    }
    req!(m[snap::STATE] == 0, E::AlreadyLaunched);
    req!(find_program_address(&[LAUNCH_SEED, &m[snap::LAUNCH_ID..snap::LAUNCH_ID + 32]], &ID).0 == *marker.key(), E::BadAccount);
    let creator_key = rd_key(&m, snap::CREATOR);
    let coin_store = rd_key(&m, snap::COIN);
    let fee_bps = u16::from_le_bytes([m[snap::FEE_BPS], m[snap::FEE_BPS + 1]]);
    let deadline = rd_u64(&m, snap::DEADLINE) as i64;
    let slice = rd_u64(&m, snap::SLICE);
    let quote = rd_u128(&m, snap::QUOTE);
    let name = &m[snap::NAME + 1..snap::NAME + 1 + m[snap::NAME] as usize];
    let symbol = &m[snap::SYMBOL + 1..snap::SYMBOL + 1 + m[snap::SYMBOL] as usize];
    let uri = &m[snap::URI + 1..snap::URI + 1 + m[snap::URI] as usize];
    let now = Clock::get()?.unix_timestamp;
    req!(now <= deadline, E::Expired);
    req!(*payer.key() == creator_key || *payer.key() == rd_key(&c, cfg::LAUNCHER), E::NotAllowed);
    req!(is_key(creator, &creator_key), E::BadCreator);
    // the Solana leg's coin is the OFT store over this escrow
    req!(find_program_address(&[OFT_SEED, oft_escrow.key()], &OFT_PROGRAM).0 == coin_store, E::BadSnapshot);
    write(marker, snap::STATE, &[1])?;

    // the launch fee, when Solana is the creator's own leg: in SOL at the snapshot's price, to the launcher
    let fee_eid = u32::from_le_bytes(m[snap::FEE_EID..snap::FEE_EID + 4].try_into().unwrap());
    let launch_fee = rd_u128(&m, snap::LAUNCH_FEE_USD18);
    let mut fee_lamports = 0u64;
    if fee_eid == SOL_EID && launch_fee > 0 {
        req!(is_key(launch_fee_to, &rd_key(&c, cfg::LAUNCHER)) && launch_fee_to.is_writable(), E::BadAccount);
        fee_lamports = math::mul_div(launch_fee, 1_000_000_000, quote)
            .map(|v| v + 1) // rounded up by a lamport, so the fee is never short
            .and_then(|v| u64::try_from(v).ok())
            .ok_or_else(|| fail(E::Math))?;
        sys_transfer(payer, launch_fee_to, fee_lamports)?;
    }

    // opening price: the chain's 1B at $3,000, in SOL
    let cap_lamports = math::mul_div(START_MCAP_USD18, 1_000_000_000, quote)
        .and_then(|v| u64::try_from(v).ok())
        .ok_or_else(|| fail(E::BadPrice))?;
    let sqrt_min = math::sqrt_price_for_cap(cap_lamports, CHAIN_SUPPLY).ok_or_else(|| fail(E::BadPrice))?;
    let sqrt_max = math::MAX_SQRT_PRICE;
    let liquidity = math::liquidity_for_coins(slice, sqrt_min, sqrt_max).ok_or_else(|| fail(E::Math))?;
    let sqrt_price = math::sqrt_price_after_buy(sqrt_min, liquidity, first_buy).ok_or_else(|| fail(E::Math))?;
    req!(sqrt_price < sqrt_max, E::Math);
    let pool_coins = math::coins_in_pool(liquidity, sqrt_price, sqrt_max).ok_or_else(|| fail(E::Math))?;
    req!(pool_coins <= slice, E::Math);

    let (wmint, wowner, _) = token_account(payer_wsol, &TOKEN)?;
    req!(wmint == NATIVE_MINT && wowner == *payer.key(), E::BadAccount);

    let mint_key = *mint.key();
    let (coin_key, coin_bump) = find_program_address(&[COIN_SEED, &mint_key], &ID);
    req!(*coin_acc.key() == coin_key && coin_acc.data_is_empty(), E::BadAccount);
    let cb = [coin_bump];
    let coin_seeds = [Seed::from(COIN_SEED), Seed::from(&mint_key), Seed::from(&cb)];
    let coin_signer = [Signer::from(&coin_seeds)];
    let rent = Rent::get()?;
    sys_create(payer, coin_acc, rent.minimum_balance(coin::LEN), coin::LEN as u64, &ID, &coin_signer)?;

    make_mint(payer, mint, coin_acc, &coin_key, &coin_signer, name, symbol, uri, &rent)?;

    // the slice goes to the payer; the pool pulls its coins from there and the rest is the launch buy
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
    // SetAuthority { MintTokens, Some(oft_store) }: from here only bridging mints, and only what was burned elsewhere
    let mut d = Wr::<80>::new(&[6, 0, 1]);
    d.raw(&coin_store);
    call(&TOKEN_2022, &[AccountMeta::writable(&mint_key), AccountMeta::readonly_signer(&coin_key)], &[mint, coin_acc], d.out(), &coin_signer)?;

    open_pool(
        &[coin_acc, nft_mint, nft_account, payer, pool_authority, pool, position, mint, wsol_mint, coin_vault, sol_vault, payer_coin, payer_wsol, t22, token, system, damm_events, damm_program],
        &coin_signer,
        fee_bps,
        sqrt_min,
        sqrt_max,
        liquidity,
        sqrt_price,
    )?;
    req!(pool.is_owned_by(&DAMM), E::BadPool);

    // the launch buy's coins go to the creator
    let bought = slice - pool_coins;
    if bought > 0 && *payer.key() != creator_key {
        ata_idempotent(payer, creator_coin, creator, mint, system, t22)?;
        let mut d = Wr::<80>::new(&[12]);
        d.u64(bought).u8(COIN_DECIMALS);
        call(
            &TOKEN_2022,
            &[AccountMeta::writable(payer_coin.key()), AccountMeta::readonly(&mint_key), AccountMeta::writable(creator_coin.key()), AccountMeta::readonly_signer(payer.key())],
            &[payer_coin, mint, creator_coin, payer],
            d.out(),
            &[],
        )?;
    }

    {
        let mut st = coin_acc.try_borrow_mut_data()?;
        st[..8].copy_from_slice(&COIN_DISC);
        st[coin::MINT..coin::MINT + 32].copy_from_slice(&mint_key);
        st[coin::CREATOR..coin::CREATOR + 32].copy_from_slice(&creator_key);
        st[coin::POOL..coin::POOL + 32].copy_from_slice(pool.key());
        st[coin::POSITION..coin::POSITION + 32].copy_from_slice(position.key());
        st[coin::NFT_ACCOUNT..coin::NFT_ACCOUNT + 32].copy_from_slice(nft_account.key());
        st[coin::OFT_STORE..coin::OFT_STORE + 32].copy_from_slice(&coin_store);
        st[coin::LAUNCH_ID..coin::LAUNCH_ID + 32].copy_from_slice(&m[snap::LAUNCH_ID..snap::LAUNCH_ID + 32]);
        st[coin::FEE_BPS..coin::FEE_BPS + 2].copy_from_slice(&fee_bps.to_le_bytes());
        st[coin::SLICE..coin::SLICE + 8].copy_from_slice(&slice.to_le_bytes());
        st[coin::QUOTE_USD18..coin::QUOTE_USD18 + 16].copy_from_slice(&quote.to_le_bytes());
        st[coin::CREATED_AT..coin::CREATED_AT + 8].copy_from_slice(&now.to_le_bytes());
        st[coin::BUMP] = coin_bump;
    }
    let launches = rd_u64(&c, cfg::LAUNCHES) + 1;
    write(config, cfg::LAUNCHES, &launches.to_le_bytes())?;

    Wr::<512>::new(&EV_LAUNCHED)
        .raw(&mint_key)
        .raw(&creator_key)
        .raw(pool.key())
        .raw(&coin_store)
        .raw(&m[snap::LAUNCH_ID..snap::LAUNCH_ID + 32])
        .raw(&m[snap::CREATOR_ETH..snap::CREATOR_ETH + 20])
        .str(name)
        .str(symbol)
        .str(uri)
        .u16(fee_bps)
        .u64(slice)
        .u128(quote)
        .u64(first_buy)
        .u64(bought)
        .u64(fee_lamports)
        .emit();
    Ok(())
}

/// The Token-2022 mint: metadata pointer and metadata on the mint, 9 decimals, the coin PDA as the temporary mint
/// authority, no freeze authority, and metadata whose update authority is dropped at once.
#[inline(never)]
#[allow(clippy::too_many_arguments)]
fn make_mint(payer: &AccountInfo, mint: &AccountInfo, coin_acc: &AccountInfo, coin_key: &Pubkey, coin_signer: &[Signer], name: &[u8], symbol: &[u8], uri: &[u8], rent: &Rent) -> ProgramResult {
    let mint_key = *mint.key();
    let meta_len = 4 + 32 + 32 + (4 + name.len()) + (4 + symbol.len()) + (4 + uri.len()) + 4;
    sys_create(payer, mint, rent.minimum_balance(MINT_WITH_POINTER_LEN + meta_len), MINT_WITH_POINTER_LEN as u64, &TOKEN_2022, &[])?;
    let mut d = Wr::<80>::new(&[39, 0]);
    d.raw(coin_key).raw(&mint_key);
    call(&TOKEN_2022, &[AccountMeta::writable(&mint_key)], &[mint], d.out(), &[])?;
    let mut d = Wr::<80>::new(&[20, COIN_DECIMALS]);
    d.raw(coin_key).u8(0);
    call(&TOKEN_2022, &[AccountMeta::writable(&mint_key)], &[mint], d.out(), &[])?;
    let mut d = Wr::<288>::new(&META_INITIALIZE);
    d.str(name).str(symbol).str(uri);
    call(
        &TOKEN_2022,
        &[AccountMeta::writable(&mint_key), AccountMeta::readonly(coin_key), AccountMeta::readonly(&mint_key), AccountMeta::readonly_signer(coin_key)],
        &[mint, coin_acc, mint, coin_acc],
        d.out(),
        coin_signer,
    )?;
    let mut d = Wr::<80>::new(&META_UPDATE_AUTHORITY);
    d.raw(&[0u8; 32]);
    call(&TOKEN_2022, &[AccountMeta::writable(&mint_key), AccountMeta::readonly_signer(coin_key)], &[mint, coin_acc], d.out(), coin_signer)
}

/// The DAMM v2 pool, with the coin PDA as the position owner. Its price floor is the opening price.
#[inline(never)]
fn open_pool(a: &[&AccountInfo; 18], coin_signer: &[Signer], fee_bps: u16, sqrt_min: u128, sqrt_max: u128, liquidity: u128, sqrt_price: u128) -> ProgramResult {
    let [coin_acc, nft_mint, nft_account, payer, pool_authority, pool, position, mint, wsol_mint, coin_vault, sol_vault, payer_coin, payer_wsol, t22, token, system, damm_events, damm_program] = *a;
    let mut d = Wr::<112>::new(&damm::IX_INIT_CUSTOMIZABLE_POOL);
    d.raw(&pool_fee_params(fee_bps))
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
            AccountMeta::readonly(coin_acc.key()),
            AccountMeta::writable_signer(nft_mint.key()),
            AccountMeta::writable(nft_account.key()),
            AccountMeta::writable_signer(payer.key()),
            AccountMeta::readonly(pool_authority.key()),
            AccountMeta::writable(pool.key()),
            AccountMeta::writable(position.key()),
            AccountMeta::readonly(mint.key()),
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
            coin_acc, nft_mint, nft_account, payer, pool_authority, pool, position, mint, wsol_mint, coin_vault, sol_vault, payer_coin, payer_wsol, t22, token,
            t22, system, damm_events, damm_program,
        ],
        d.out(),
        coin_signer,
    )
}

/// Checks the DAMM v2 accounts shared by `claim_fees` and `collect` against the coin's record.
fn check_position(s: &[u8], pool: &AccountInfo, position: &AccountInfo, nft_account: &AccountInfo) -> ProgramResult {
    req!(is_key(pool, &rd_key(s, coin::POOL)), E::BadPool);
    req!(is_key(position, &rd_key(s, coin::POSITION)), E::BadAccount);
    req!(is_key(nft_account, &rd_key(s, coin::NFT_ACCOUNT)), E::BadAccount);
    req!(position.is_owned_by(&DAMM), E::BadAccount);
    Ok(())
}

/// Pulls the position's trading fees (SOL) and splits them: the platform the larger of 20% of the fee and 0.2% of
/// the volume, the creator the rest. Anyone can call it.
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
        &[pool_authority, pool, position, coin_coin, coin_wsol, coin_vault, sol_vault, mint, wsol_mint, nft_account, coin_acc, t22, token, damm_events, damm_program],
        &damm::IX_CLAIM_POSITION_FEE,
        &coin_signer,
    )?;
    let total = token_amount(coin_wsol)?;
    let claimed = total.saturating_sub(before);
    if total == 0 {
        return Ok(());
    }
    let fee_bps = u16::from_le_bytes([s[coin::FEE_BPS], s[coin::FEE_BPS + 1]]);
    let to_platform = math::mul_div(total as u128, platform_share_bps(fee_bps) as u128, BPS as u128).ok_or_else(|| fail(E::Math))? as u64;
    let to_creator = total - to_platform;
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

/// Admin only: removes `bps` of the position's liquidity and sends the coins and SOL to the given accounts.
/// Fees already earned stay in the position for `claim_fees`.
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
        &[pool_authority, pool, position, to_coin, to_wsol, coin_vault, sol_vault, mint, wsol_mint, nft_account, coin_acc, t22, token, damm_events, damm_program],
        d.out(),
        &[Signer::from(&coin_seeds)],
    )?;
    let coins = token_amount(to_coin)?.saturating_sub(coins_before);
    let sol = token_amount(to_wsol)?.saturating_sub(sol_before);
    Wr::<160>::new(&EV_COLLECTED).raw(&mint_key).u16(bps).u128(delta).u64(coins).u64(sol).raw(to_coin.key()).raw(to_wsol.key()).emit();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn platform_share_follows_the_fee() {
        assert_eq!(platform_share_bps(100), 2_000); // 1%: 20% of the fee = 0.2% of volume
        assert_eq!(platform_share_bps(500), 2_000); // 5%: 20% of the fee is more
        assert_eq!(platform_share_bps(100), 2_000); // 1% again: the floor
    }

    #[test]
    fn flat_fee_params() {
        let p = pool_fee_params(100);
        assert_eq!(u64::from_le_bytes(p[0..8].try_into().unwrap()), 100 * damm::NUMERATOR_PER_BPS);
        assert_eq!(&p[8..26], &[0u8; 18]);
    }
}
