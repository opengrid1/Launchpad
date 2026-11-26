//! Equo on Solana: launches a coin straight into a Raydium CLMM pool.
//!
//! A launch, in one transaction:
//!   - makes the Token-2022 coin: 1B, 9 decimals, metadata on the mint, no freeze authority, immutable metadata,
//!     and no mint authority once the 1B exists;
//!   - opens a Raydium CLMM pool against the chosen pair (SOL or one of a fixed list of xStocks) with fees taken
//!     in the pair token only, at a $3,000 market cap priced by Pyth;
//!   - puts the 1B into one position, from the opening price to the end of the price range, so the pool holds
//!     only coins at the start (single sided). The position NFT belongs to the coin's PDA.
//!
//! The creator's launch buy is optional and built into the opening price: the pool opens at the price a fee-free
//! buy of that much would reach, so nobody trades before it. Those coins stay with the creator.
//!
//! Fees: anyone can call `claim_fees`, which pulls the position's fees (pair token) and pays the platform the
//! larger of 20% of the trading fee and 0.2% of the volume it came from, and the creator the rest. Raydium keeps
//! its own protocol share of the fee first, so the platform's part is worked out on what reaches the position.
//!
//! `collect` lets the admin remove a share of the position's liquidity.
//!
//! The pool is created by a PDA of this program, so nobody else holds the pool's reward-admin role.
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

/// 6mdh7toDGpPEk8CYokVLi2aQMLDnB9jVkzhP5n9Dt4wR
pub const ID: Pubkey = [85, 185, 122, 72, 204, 62, 38, 139, 255, 139, 164, 242, 55, 203, 199, 48, 217, 155, 7, 38, 245, 10, 245, 11, 2, 244, 160, 66, 100, 199, 88, 184];
/// Raydium CLMM, CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK
pub const CLMM: Pubkey = [165, 213, 202, 158, 4, 207, 93, 181, 144, 183, 20, 186, 47, 227, 44, 177, 89, 19, 63, 193, 193, 146, 183, 34, 87, 253, 7, 211, 156, 176, 64, 30];
/// Pyth Solana receiver, rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ
pub const PYTH_RECEIVER: Pubkey = [12, 183, 250, 187, 82, 247, 166, 72, 187, 91, 49, 125, 154, 1, 139, 144, 87, 203, 2, 71, 116, 250, 254, 1, 230, 196, 223, 152, 204, 56, 88, 129];
/// MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr
pub const MEMO: Pubkey = [5, 74, 83, 90, 153, 41, 33, 6, 77, 36, 232, 113, 96, 218, 56, 124, 124, 53, 181, 221, 188, 146, 187, 129, 228, 31, 168, 64, 65, 5, 68, 141];
/// SysvarRent111111111111111111111111111111111
pub const RENT: Pubkey = [6, 167, 213, 23, 25, 44, 92, 81, 33, 140, 201, 76, 61, 74, 241, 127, 88, 218, 238, 8, 155, 161, 253, 68, 227, 219, 217, 138, 0, 0, 0, 0];
/// TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb
pub const TOKEN_2022: Pubkey = [6, 221, 246, 225, 238, 117, 143, 222, 24, 66, 93, 188, 228, 108, 205, 218, 182, 26, 252, 77, 131, 185, 13, 39, 254, 189, 249, 40, 216, 161, 139, 252];
/// TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA
pub const TOKEN: Pubkey = [6, 221, 246, 225, 215, 101, 161, 147, 217, 203, 225, 70, 206, 235, 121, 172, 28, 180, 133, 237, 95, 91, 55, 145, 58, 140, 245, 133, 126, 255, 0, 169];
/// ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL
pub const ATA: Pubkey = [140, 151, 37, 143, 78, 36, 137, 241, 187, 61, 16, 41, 20, 142, 13, 131, 11, 90, 19, 153, 218, 255, 16, 132, 4, 142, 123, 216, 219, 233, 248, 89];
/// 11111111111111111111111111111111
pub const SYSTEM: Pubkey = [0; 32];
/// BPFLoaderUpgradeab1e11111111111111111111111
pub const BPF_UPGRADEABLE: Pubkey = [2, 168, 246, 145, 78, 136, 161, 176, 226, 16, 21, 62, 247, 99, 174, 43, 0, 194, 185, 61, 22, 193, 36, 210, 192, 83, 122, 16, 4, 128, 0, 0];

/// The pairs a coin can launch against, fixed at deployment: (mint, Pyth USD price feed id). The first is wrapped
/// SOL; the rest are xStocks (Token-2022, whitelisted on Raydium CLMM, 24/7 Pyth feeds).
pub const PAIRS: [(Pubkey, [u8; 32]); 11] = [
    // SOL So11111111111111111111111111111111111111112
    ([6, 155, 136, 87, 254, 171, 129, 132, 251, 104, 127, 99, 70, 24, 192, 53, 218, 196, 57, 220, 26, 235, 59, 85, 152, 160, 240, 0, 0, 0, 0, 1], [239, 13, 139, 111, 218, 44, 235, 164, 29, 161, 93, 64, 149, 209, 218, 57, 42, 13, 47, 142, 208, 198, 199, 188, 15, 76, 250, 200, 194, 128, 181, 109]),
    // SPYx XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W
    ([7, 232, 220, 44, 222, 123, 35, 160, 215, 67, 248, 241, 39, 107, 101, 125, 138, 158, 234, 6, 149, 11, 166, 122, 141, 48, 51, 197, 60, 76, 222, 79], [40, 23, 183, 132, 56, 199, 105, 53, 113, 130, 192, 67, 70, 253, 218, 173, 17, 120, 200, 47, 64, 72, 130, 143, 224, 153, 124, 60, 100, 98, 78, 20]),
    // QQQx Xs8S1uUs1zvS2p7iwtsG3b6fkhpvmwz4GYU3gWAmWHZ
    ([7, 232, 26, 181, 9, 225, 229, 41, 148, 110, 122, 99, 136, 123, 19, 6, 23, 170, 226, 221, 133, 239, 237, 26, 4, 218, 86, 12, 6, 35, 118, 36], [23, 138, 111, 115, 165, 174, 222, 157, 13, 104, 46, 134, 176, 4, 124, 159, 51, 62, 208, 239, 229, 198, 83, 124, 169, 55, 86, 82, 25, 196, 5, 77]),
    // NVDAx Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh
    ([7, 232, 165, 14, 20, 15, 218, 87, 145, 244, 86, 106, 149, 127, 211, 174, 63, 135, 62, 106, 52, 102, 255, 193, 61, 121, 17, 157, 250, 154, 181, 10], [66, 68, 208, 120, 144, 228, 97, 15, 70, 187, 222, 103, 222, 143, 67, 164, 191, 139, 86, 158, 235, 233, 4, 241, 54, 180, 105, 241, 72, 80, 59, 127]),
    // TSLAx XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB
    ([7, 232, 53, 130, 65, 31, 234, 20, 130, 240, 153, 75, 128, 170, 81, 42, 151, 201, 79, 37, 223, 40, 59, 236, 90, 103, 163, 129, 252, 134, 43, 74], [71, 161, 86, 71, 2, 136, 133, 10, 68, 13, 243, 166, 206, 133, 165, 89, 23, 184, 19, 161, 155, 181, 179, 17, 40, 163, 58, 152, 101, 102, 163, 98]),
    // AAPLx XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp
    ([7, 232, 160, 123, 86, 206, 146, 102, 185, 146, 170, 95, 214, 68, 92, 60, 119, 152, 178, 235, 183, 51, 60, 30, 126, 222, 6, 44, 107, 134, 7, 229], [151, 142, 108, 198, 138, 17, 156, 224, 102, 170, 131, 0, 23, 49, 133, 99, 169, 237, 4, 236, 58, 10, 100, 57, 1, 15, 193, 18, 150, 165, 134, 117]),
    // GOOGLx XsCPL9dNWBMvFtTmwcCA5v3xWPSMEBCszbQdiLLq6aN
    ([7, 232, 46, 112, 90, 42, 90, 57, 217, 138, 137, 180, 2, 130, 139, 67, 85, 42, 44, 76, 139, 144, 110, 115, 196, 32, 132, 213, 171, 65, 77, 19], [185, 17, 176, 50, 144, 40, 205, 2, 131, 228, 37, 156, 51, 128, 157, 98, 148, 43, 210, 113, 106, 88, 8, 78, 95, 49, 214, 76, 0, 181, 66, 78]),
    // METAx Xsa62P5mvPszXL1krVUnU5ar38bBSVcWAB6fmPCo5Zu
    ([7, 232, 154, 190, 180, 199, 45, 33, 80, 55, 245, 197, 105, 3, 154, 71, 212, 93, 182, 110, 30, 6, 184, 241, 129, 15, 62, 103, 65, 143, 65, 164], [191, 62, 88, 113, 190, 63, 128, 171, 122, 77, 31, 31, 208, 57, 20, 81, 121, 251, 88, 86, 158, 21, 154, 238, 28, 205, 71, 40, 104, 234, 89, 0]),
    // CRCLx XsueG8BtpquVJX9LVLLEGuViXUungE6WmK5YZ3p3bd1
    ([7, 232, 252, 87, 138, 237, 15, 221, 117, 35, 210, 175, 115, 6, 3, 137, 140, 33, 62, 196, 253, 247, 32, 214, 102, 234, 38, 232, 85, 92, 217, 240], [193, 49, 132, 70, 28, 12, 128, 217, 143, 252, 216, 155, 230, 39, 194, 34, 11, 148, 169, 108, 124, 103, 240, 196, 177, 107, 193, 47, 211, 177, 119, 88]),
    // MSTRx XsP7xzNPvEHS1m6qfanPUGjNmdnmsLKEoNAnHjdxxyZ
    ([7, 232, 100, 3, 175, 143, 251, 134, 191, 227, 71, 136, 245, 196, 67, 218, 54, 75, 71, 124, 12, 37, 17, 110, 101, 188, 99, 12, 48, 17, 200, 36], [83, 249, 91, 164, 226, 62, 209, 94, 165, 96, 131, 226, 238, 154, 94, 236, 72, 5, 93, 111, 89, 3, 61, 75, 185, 95, 28, 162, 162, 52, 156, 40]),
    // COINx Xs7ZdzSHLU9ftNJsii5fCeJhoRWSC32SQGzGQtePxNu
    ([7, 232, 22, 95, 82, 84, 145, 63, 16, 159, 43, 16, 178, 54, 231, 174, 55, 21, 130, 135, 59, 114, 233, 38, 245, 50, 12, 254, 97, 38, 169, 146], [100, 20, 53, 213, 223, 251, 83, 17, 20, 11, 72, 5, 23, 199, 153, 134, 216, 72, 141, 92, 240, 138, 17, 238, 197, 59, 131, 173, 2, 202, 179, 63]),
];

pub const COIN_DECIMALS: u8 = 9;
/// Every coin's supply: 1B.
pub const SUPPLY: u64 = 1_000_000_000 * 1_000_000_000;
/// Coins kept out of the position so the pool's rounding never asks for more than the supply. They stay with the
/// creator, with any launch buy.
pub const SUPPLY_MARGIN: u64 = 4;
/// Every coin opens at this market cap, in USD.
pub const START_MCAP_USD: u128 = 3_000;
/// A Pyth price older than this cannot price a launch.
pub const MAX_PRICE_AGE: i64 = 600;
pub const BPS: u64 = 10_000;
/// Raydium fee rates are in millionths.
pub const FEE_RATE_DENOM: u64 = 1_000_000;
/// The CLMM fee tiers a coin may use: 0.25% to 4%.
pub const MIN_TRADE_FEE: u32 = 2_500;
pub const MAX_TRADE_FEE: u32 = 40_000;
/// Fee tiers with a tick spacing below this need CLMM's bitmap extension for a full-range position.
pub const MIN_TICK_SPACING: u16 = 60;
/// The platform's part of a fee: the larger of a fifth of the trading fee and 0.2% of the volume (in millionths).
pub const PLATFORM_FEE_DIVISOR: u64 = 5;
pub const PLATFORM_VOLUME_RATE: u64 = 2_000;
/// Lamports lent to the pool-creator PDA to pay the pool's accounts; the rest comes back in the same instruction.
pub const POOL_RENT_BUDGET: u64 = 100_000_000;
pub const MAX_NAME: usize = 32;
pub const MAX_SYMBOL: usize = 10;
pub const MAX_URI: usize = 200;

pub const CONFIG_SEED: &[u8] = b"config3";
pub const COIN_SEED: &[u8] = b"coin3";
pub const POOL_PAYER_SEED: &[u8] = b"pool_payer";

/// Raydium CLMM.
pub mod clmm {
    pub const IX_CREATE_CUSTOMIZABLE_POOL: [u8; 8] = [43, 68, 212, 167, 89, 47, 164, 1];
    pub const IX_OPEN_POSITION_T22: [u8; 8] = [77, 255, 174, 82, 125, 29, 201, 46];
    pub const IX_DECREASE_LIQUIDITY_V2: [u8; 8] = [58, 127, 188, 62, 79, 82, 196, 96];
    pub const AMM_CONFIG_DISC: [u8; 8] = [218, 244, 33, 104, 203, 203, 43, 111];
    pub const COLLECT_FEE_ON_TOKEN0: u8 = 1;
    pub const COLLECT_FEE_ON_TOKEN1: u8 = 2;
    // AmmConfig
    pub const CFG_PROTOCOL_FEE: usize = 43;
    pub const CFG_TRADE_FEE: usize = 47;
    pub const CFG_TICK_SPACING: usize = 51;
    pub const CFG_FUND_FEE: usize = 53;
    pub const CFG_LEN: usize = 117;
    // PersonalPositionState
    pub const POSITION_LIQUIDITY: usize = 81;
}

/// Pyth PriceUpdateV2.
mod pyth {
    pub const DISC: [u8; 8] = [34, 241, 35, 99, 157, 126, 244, 205];
    pub const VERIFICATION: usize = 40; // 1: Full
    pub const FEED_ID: usize = 41;
    pub const PRICE: usize = 73;
    pub const EXPONENT: usize = 89;
    pub const PUBLISH_TIME: usize = 93;
}

// sha256("global:<name>")[..8]
const IX_INITIALIZE: [u8; 8] = [175, 175, 109, 31, 13, 152, 155, 237];
const IX_SET_FEE_RECIPIENT: [u8; 8] = [227, 18, 215, 42, 237, 246, 151, 66];
const IX_LAUNCH: [u8; 8] = [153, 241, 93, 225, 22, 69, 74, 61];
const IX_CLAIM_FEES: [u8; 8] = [82, 251, 233, 156, 12, 52, 184, 202];
const IX_SET_CREATOR: [u8; 8] = [254, 148, 255, 112, 207, 142, 170, 165];
const IX_COLLECT: [u8; 8] = [208, 47, 194, 155, 17, 98, 82, 236];

// sha256("account:<Name>")[..8]
const CONFIG_DISC: [u8; 8] = [108, 45, 17, 49, 178, 80, 175, 54];
const COIN_DISC: [u8; 8] = [11, 123, 101, 18, 254, 139, 29, 122];

// sha256("event:<Name>")[..8]
const EV_INITIALIZED: [u8; 8] = [208, 213, 115, 98, 115, 82, 201, 209];
const EV_FEE_RECIPIENT_SET: [u8; 8] = [99, 140, 80, 35, 245, 176, 179, 110];
const EV_COIN_LAUNCHED: [u8; 8] = [169, 65, 49, 61, 3, 18, 32, 179];
const EV_FEES_CLAIMED: [u8; 8] = [22, 104, 110, 222, 38, 157, 14, 62];
const EV_CREATOR_SET: [u8; 8] = [95, 242, 20, 222, 81, 81, 181, 66];
const EV_COLLECTED: [u8; 8] = [67, 109, 138, 167, 168, 239, 2, 207];

// spl-token-metadata-interface: sha256("spl_token_metadata_interface:<name>")[..8]
const META_INITIALIZE: [u8; 8] = [210, 225, 30, 162, 88, 184, 77, 141];
const META_UPDATE_AUTHORITY: [u8; 8] = [215, 228, 166, 228, 84, 100, 86, 123];

/// Token-2022 mint with the MetadataPointer extension, before the metadata TLV entry.
const MINT_WITH_POINTER_LEN: usize = 234;

// -------------------------------------------------------------------------
// Errors
// -------------------------------------------------------------------------

#[derive(Clone, Copy)]
#[repr(u32)]
pub enum E {
    NotUpgradeAuthority,
    NotAdmin,
    BadMetadata,
    BadFeeTier,
    BadPair,
    BadPrice,
    StalePrice,
    BadTick,
    Math,
    BadFeeRecipient,
    BadCreator,
    BadPool,
    BadBps,
    NothingToCollect,
    BadAccount,
    BadInstruction,
}

const ERR_LOG: [&str; 16] = [
    "Error: NotUpgradeAuthority. Signer is not the program's upgrade authority",
    "Error: NotAdmin. Signer is not the admin",
    "Error: BadMetadata. Name, symbol or URI is empty or too long",
    "Error: BadFeeTier. Use a Raydium CLMM fee tier from 0.25% to 4%",
    "Error: BadPair. The pair is not one of Equo's pairs",
    "Error: BadPrice. Wrong or unusable Pyth price account",
    "Error: StalePrice. The Pyth price is too old",
    "Error: BadTick. The start tick does not match the $3,000 opening price",
    "Error: Math. Math overflow",
    "Error: BadFeeRecipient. Wrong fee recipient",
    "Error: BadCreator. Wrong creator",
    "Error: BadPool. Wrong pool or position",
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
    fn u16(&mut self) -> Result<u16, ProgramError> {
        Ok(u16::from_le_bytes(self.take(2)?.try_into().unwrap()))
    }
    fn u32(&mut self) -> Result<u32, ProgramError> {
        Ok(u32::from_le_bytes(self.take(4)?.try_into().unwrap()))
    }
    fn i32(&mut self) -> Result<i32, ProgramError> {
        Ok(i32::from_le_bytes(self.take(4)?.try_into().unwrap()))
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
}

fn rd_u16(d: &[u8], o: usize) -> u16 {
    u16::from_le_bytes(d[o..o + 2].try_into().unwrap())
}
fn rd_u32(d: &[u8], o: usize) -> u32 {
    u32::from_le_bytes(d[o..o + 4].try_into().unwrap())
}
fn rd_i32(d: &[u8], o: usize) -> i32 {
    i32::from_le_bytes(d[o..o + 4].try_into().unwrap())
}
fn rd_i64(d: &[u8], o: usize) -> i64 {
    i64::from_le_bytes(d[o..o + 8].try_into().unwrap())
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
    fn i32(&mut self, v: i32) -> &mut Self {
        self.raw(&v.to_le_bytes())
    }
    fn u64(&mut self, v: u64) -> &mut Self {
        self.raw(&v.to_le_bytes())
    }
    fn i64(&mut self, v: i64) -> &mut Self {
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

/// The token program that owns a mint, and the mint's decimals.
fn mint_info(a: &AccountInfo) -> Result<(&'static Pubkey, u8), ProgramError> {
    let prog = if a.is_owned_by(&TOKEN) {
        &TOKEN
    } else if a.is_owned_by(&TOKEN_2022) {
        &TOKEN_2022
    } else {
        return Err(fail(E::BadAccount));
    };
    let d = a.try_borrow_data()?;
    req!(d.len() >= 82 && d[45] == 1, E::BadAccount);
    Ok((prog, d[44]))
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

fn sys_transfer(from: &AccountInfo, to: &AccountInfo, lamports: u64, signers: &[Signer]) -> ProgramResult {
    let mut d = Wr::<16>::new(&2u32.to_le_bytes());
    d.u64(lamports);
    call(&SYSTEM, &[AccountMeta::writable_signer(from.key()), AccountMeta::writable(to.key())], &[from, to], d.out(), signers)
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

#[allow(clippy::too_many_arguments)]
fn transfer_checked(token_program: &Pubkey, from: &AccountInfo, mint: &AccountInfo, to: &AccountInfo, authority: &AccountInfo, amount: u64, decimals: u8, signers: &[Signer]) -> ProgramResult {
    let mut d = Wr::<16>::new(&[12]);
    d.u64(amount).u8(decimals);
    call(
        token_program,
        &[AccountMeta::writable(from.key()), AccountMeta::readonly(mint.key()), AccountMeta::writable(to.key()), AccountMeta::readonly_signer(authority.key())],
        &[from, mint, to, authority],
        d.out(),
        signers,
    )
}

// -------------------------------------------------------------------------
// State
// -------------------------------------------------------------------------

/// ConfigV3, after the 8-byte discriminator.
mod cfg {
    pub const ADMIN: usize = 8;
    pub const FEE_RECIPIENT: usize = 40;
    pub const LAUNCHES: usize = 72;
    pub const BUMP: usize = 80;
    pub const LEN: usize = 81;
}

/// CoinV3, after the 8-byte discriminator.
mod coin {
    pub const MINT: usize = 8;
    pub const CREATOR: usize = 40;
    pub const POOL: usize = 72;
    pub const POSITION: usize = 104;
    pub const NFT_ACCOUNT: usize = 136;
    pub const QUOTE_MINT: usize = 168;
    pub const AMM_CONFIG: usize = 200;
    pub const TICK_LOWER: usize = 232;
    pub const TICK_UPPER: usize = 236;
    pub const COIN_IS_0: usize = 240;
    pub const TRADE_FEE: usize = 241; // millionths
    pub const PLATFORM_SHARE_BPS: usize = 245; // of what reaches the position
    pub const CREATED_AT: usize = 247;
    pub const CREATOR_FEES: usize = 255;
    pub const PLATFORM_FEES: usize = 263;
    pub const BUMP: usize = 271;
    pub const LEN: usize = 272;
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
        IX_SET_FEE_RECIPIENT => set_fee_recipient(accounts, &mut r),
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

    let b = [bump];
    let seeds = [Seed::from(CONFIG_SEED), Seed::from(&b)];
    sys_create(authority, config, Rent::get()?.minimum_balance(cfg::LEN), cfg::LEN as u64, &ID, &[Signer::from(&seeds)])?;
    let mut d = config.try_borrow_mut_data()?;
    d[..8].copy_from_slice(&CONFIG_DISC);
    d[cfg::ADMIN..cfg::ADMIN + 32].copy_from_slice(&admin);
    d[cfg::FEE_RECIPIENT..cfg::FEE_RECIPIENT + 32].copy_from_slice(&fee_recipient);
    d[cfg::BUMP] = bump;
    Wr::<80>::new(&EV_INITIALIZED).raw(&admin).raw(&fee_recipient).emit();
    Ok(())
}

#[inline(never)]
fn set_fee_recipient(accounts: &[AccountInfo], r: &mut Rd) -> ProgramResult {
    let [admin, config, ..] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    signer(admin)?;
    let c = load_config(config)?;
    req!(rd_key(&c, cfg::ADMIN) == *admin.key(), E::NotAdmin);
    req!(config.is_writable(), E::BadAccount);
    let k = r.key()?;
    write(config, cfg::FEE_RECIPIENT, &k)?;
    Wr::<80>::new(&EV_FEE_RECIPIENT_SET).raw(&k).emit();
    Ok(())
}

/// The platform's share of the fees that reach the position, in bps: the larger of a fifth of the trading fee and
/// 0.2% of the volume, over the trading fee less Raydium's protocol and fund shares; capped at all of it.
pub fn platform_share_bps(trade_fee: u32, protocol_fee: u32, fund_fee: u32) -> u16 {
    let t = trade_fee as u64;
    // what reaches the position, per unit of volume, in millionths squared
    let lp = t * FEE_RATE_DENOM.saturating_sub(protocol_fee as u64 + fund_fee as u64);
    if lp == 0 {
        return BPS as u16;
    }
    let platform = (t / PLATFORM_FEE_DIVISOR).max(PLATFORM_VOLUME_RATE) * FEE_RATE_DENOM;
    (platform * BPS).div_ceil(lp).min(BPS) as u16
}

/// USD price of one whole pair token from a Pyth PriceUpdateV2, as (price, 10^-exponent): fully verified, the
/// pair's feed, and fresh.
fn pyth_price(a: &AccountInfo, feed: &[u8; 32], now: i64) -> Result<(u128, u128), ProgramError> {
    req!(a.is_owned_by(&PYTH_RECEIVER), E::BadPrice);
    let d = a.try_borrow_data()?;
    req!(d.len() >= pyth::PUBLISH_TIME + 8 && d[..8] == pyth::DISC && d[pyth::VERIFICATION] == 1, E::BadPrice);
    req!(d[pyth::FEED_ID..pyth::FEED_ID + 32] == *feed, E::BadPrice);
    let price = rd_i64(&d, pyth::PRICE);
    let expo = rd_i32(&d, pyth::EXPONENT);
    let at = rd_i64(&d, pyth::PUBLISH_TIME);
    req!(price > 0 && (-12..=0).contains(&expo), E::BadPrice);
    req!(now - at <= MAX_PRICE_AGE, E::StalePrice);
    Ok((price as u128, 10u128.pow(expo.unsigned_abs())))
}

/// Opening terms worked out from the price: the position's ticks and liquidity and the pool's opening price.
struct Opening {
    coin_is_0: bool,
    lower: i32,
    upper: i32,
    liquidity: u128,
    sqrt_price: u128,
}

/// The coin's position covers [start, end of range] on the coin's side of the opening price. `tick` is the start:
/// the first tick at or past the $3,000 price, so the coin opens at $3,000 to $3,000 plus one tick spacing.
fn opening(coin_is_0: bool, cap: u64, spacing: i32, tick: i32, first_buy: u64) -> Result<Opening, ProgramError> {
    let coins = SUPPLY - SUPPLY_MARGIN;
    let end = math::max_tick(spacing);
    req!(tick % spacing == 0 && tick > -end && tick < end, E::BadTick);
    let at = |t: i32| math::sqrt_price_at_tick(t).ok_or_else(|| fail(E::BadTick));
    if coin_is_0 {
        // price = pair per coin; the position sits above it
        let target = math::sqrt_price_for_cap(cap, SUPPLY).ok_or_else(|| fail(E::BadPrice))?;
        req!(at(tick - spacing)? < target && target <= at(tick)?, E::BadTick);
        let (liquidity, sqrt_price) = math::open_coin0(coins, at(tick)?, at(end)?, first_buy).ok_or_else(|| fail(E::Math))?;
        Ok(Opening { coin_is_0, lower: tick, upper: end, liquidity, sqrt_price })
    } else {
        // price = coins per pair token; the position sits below it
        let target = math::sqrt_price_for_cap(SUPPLY, cap).ok_or_else(|| fail(E::BadPrice))?;
        req!(at(tick)? <= target && target < at(tick + spacing)?, E::BadTick);
        let (liquidity, sqrt_price) = math::open_coin1(coins, at(-end)?, at(tick)?, first_buy).ok_or_else(|| fail(E::Math))?;
        Ok(Opening { coin_is_0, lower: -end, upper: tick, liquidity, sqrt_price })
    }
}

/// Makes the coin and opens its pool. Data: name, symbol, uri (u32-prefixed), start tick i32, launch buy u64 (in
/// the pair token's raw units; 0 for none).
///
/// The payer is the creator. The pair token for the launch buy must sit in `payer_quote`, plus 2 units for the
/// pool's rounding (the account must exist even without a launch buy).
#[inline(never)]
fn launch(accounts: &[AccountInfo], r: &mut Rd) -> ProgramResult {
    let [payer, config, mint, coin_acc, pool_payer, payer_coin, payer_quote, quote_mint, price, amm_config, pool, vault_0, vault_1, observation, bitmap, nft_mint, nft_account, position, protocol_position, tick_lower, tick_upper, support_mint, clmm_program, token, t22, ata_program, system, rent_sysvar, ..] =
        accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    signer(payer)?;
    signer(mint)?;
    signer(nft_mint)?;
    program(clmm_program, &CLMM)?;
    program(t22, &TOKEN_2022)?;
    program(token, &TOKEN)?;
    program(ata_program, &ATA)?;
    program(system, &SYSTEM)?;
    program(rent_sysvar, &RENT)?;
    req!(config.is_writable(), E::BadAccount);
    let c = load_config(config)?;

    let name = r.bytes()?;
    let symbol = r.bytes()?;
    let uri = r.bytes()?;
    let tick = r.i32()?;
    let first_buy = r.u64()?;
    req!(!name.is_empty() && name.len() <= MAX_NAME && core::str::from_utf8(name).is_ok(), E::BadMetadata);
    req!(!symbol.is_empty() && symbol.len() <= MAX_SYMBOL && core::str::from_utf8(symbol).is_ok(), E::BadMetadata);
    req!(uri.len() <= MAX_URI && core::str::from_utf8(uri).is_ok(), E::BadMetadata);

    // the pair and its price
    let quote_key = *quote_mint.key();
    let feed = PAIRS.iter().find(|p| p.0 == quote_key).map(|p| p.1).ok_or_else(|| fail(E::BadPair))?;
    let (quote_program, quote_decimals) = mint_info(quote_mint)?;
    let now = Clock::get()?.unix_timestamp;
    let (usd, scale) = pyth_price(price, &feed, now)?;
    // the pair token's raw units worth $3,000
    let cap = math::mul_div(START_MCAP_USD * 10u128.pow(quote_decimals as u32), scale, usd)
        .and_then(|v| u64::try_from(v).ok())
        .ok_or_else(|| fail(E::BadPrice))?;

    // the fee tier
    let (trade_fee, share_bps, spacing) = {
        req!(amm_config.is_owned_by(&CLMM), E::BadFeeTier);
        let d = amm_config.try_borrow_data()?;
        req!(d.len() >= clmm::CFG_LEN && d[..8] == clmm::AMM_CONFIG_DISC, E::BadFeeTier);
        let trade_fee = rd_u32(&d, clmm::CFG_TRADE_FEE);
        let spacing = rd_u16(&d, clmm::CFG_TICK_SPACING);
        req!((MIN_TRADE_FEE..=MAX_TRADE_FEE).contains(&trade_fee) && spacing >= MIN_TICK_SPACING, E::BadFeeTier);
        (trade_fee, platform_share_bps(trade_fee, rd_u32(&d, clmm::CFG_PROTOCOL_FEE), rd_u32(&d, clmm::CFG_FUND_FEE)), spacing as i32)
    };

    let mint_key = *mint.key();
    let o = opening(mint_key < quote_key, cap, spacing, tick, first_buy)?;
    let (pmint, powner, _) = token_account(payer_quote, quote_program)?;
    req!(pmint == quote_key && powner == *payer.key(), E::BadAccount);

    // the coin
    let (coin_key, coin_bump) = find_program_address(&[COIN_SEED, &mint_key], &ID);
    req!(*coin_acc.key() == coin_key && coin_acc.data_is_empty(), E::BadAccount);
    let cb = [coin_bump];
    let coin_seeds = [Seed::from(COIN_SEED), Seed::from(&mint_key), Seed::from(&cb)];
    let coin_signer = [Signer::from(&coin_seeds)];
    let rent = Rent::get()?;
    sys_create(payer, coin_acc, rent.minimum_balance(coin::LEN), coin::LEN as u64, &ID, &coin_signer)?;
    make_mint(payer, mint, coin_acc, &coin_key, &coin_signer, name, symbol, uri, &rent)?;
    mint_supply(payer, payer_coin, mint, coin_acc, &coin_key, &coin_signer, system, t22)?;

    // the pool, created by this program's PDA so nobody else is its owner
    let (pp_key, pp_bump) = find_program_address(&[POOL_PAYER_SEED, &mint_key], &ID);
    req!(*pool_payer.key() == pp_key, E::BadAccount);
    let ppb = [pp_bump];
    let pp_seeds = [Seed::from(POOL_PAYER_SEED), Seed::from(&mint_key), Seed::from(&ppb)];
    let pp_signer = [Signer::from(&pp_seeds)];
    sys_transfer(payer, pool_payer, POOL_RENT_BUDGET, &[])?;
    let (token_0, token_1, prog_0, prog_1) = if o.coin_is_0 { (mint, quote_mint, &TOKEN_2022, quote_program) } else { (quote_mint, mint, quote_program, &TOKEN_2022) };
    create_pool(
        &[pool_payer, amm_config, pool, token_0, token_1, vault_0, vault_1, observation, bitmap, token, t22, system, rent_sysvar, support_mint, clmm_program],
        prog_0,
        prog_1,
        o.sqrt_price,
        if o.coin_is_0 { clmm::COLLECT_FEE_ON_TOKEN1 } else { clmm::COLLECT_FEE_ON_TOKEN0 },
        &pp_signer,
    )?;
    sys_transfer(pool_payer, payer, pool_payer.lamports(), &pp_signer)?;
    req!(pool.is_owned_by(&CLMM), E::BadPool);

    // the position: all coins (less the margin), plus the launch buy in the pair token
    let coins_before = token_amount(payer_coin)?;
    let (acct_0, acct_1) = if o.coin_is_0 { (payer_coin, payer_quote) } else { (payer_quote, payer_coin) };
    let buy_max = if first_buy > 0 { first_buy + 2 } else { 0 };
    let (max_0, max_1) = if o.coin_is_0 { (SUPPLY, buy_max) } else { (buy_max, SUPPLY) };
    open_position(
        &[payer, coin_acc, nft_mint, nft_account, pool, protocol_position, tick_lower, tick_upper, position, acct_0, acct_1, vault_0, vault_1, rent_sysvar, system, token, ata_program, t22, token_0, token_1, clmm_program],
        &o,
        spacing,
        max_0,
        max_1,
    )?;
    let kept = token_amount(payer_coin)?;
    let bought = kept.saturating_sub(SUPPLY_MARGIN);
    let pooled = coins_before - kept;

    {
        let mut st = coin_acc.try_borrow_mut_data()?;
        st[..8].copy_from_slice(&COIN_DISC);
        st[coin::MINT..coin::MINT + 32].copy_from_slice(&mint_key);
        st[coin::CREATOR..coin::CREATOR + 32].copy_from_slice(payer.key());
        st[coin::POOL..coin::POOL + 32].copy_from_slice(pool.key());
        st[coin::POSITION..coin::POSITION + 32].copy_from_slice(position.key());
        st[coin::NFT_ACCOUNT..coin::NFT_ACCOUNT + 32].copy_from_slice(nft_account.key());
        st[coin::QUOTE_MINT..coin::QUOTE_MINT + 32].copy_from_slice(&quote_key);
        st[coin::AMM_CONFIG..coin::AMM_CONFIG + 32].copy_from_slice(amm_config.key());
        st[coin::TICK_LOWER..coin::TICK_LOWER + 4].copy_from_slice(&o.lower.to_le_bytes());
        st[coin::TICK_UPPER..coin::TICK_UPPER + 4].copy_from_slice(&o.upper.to_le_bytes());
        st[coin::COIN_IS_0] = o.coin_is_0 as u8;
        st[coin::TRADE_FEE..coin::TRADE_FEE + 4].copy_from_slice(&trade_fee.to_le_bytes());
        st[coin::PLATFORM_SHARE_BPS..coin::PLATFORM_SHARE_BPS + 2].copy_from_slice(&share_bps.to_le_bytes());
        st[coin::CREATED_AT..coin::CREATED_AT + 8].copy_from_slice(&now.to_le_bytes());
        st[coin::BUMP] = coin_bump;
    }
    let launches = rd_u64(&c, cfg::LAUNCHES) + 1;
    write(config, cfg::LAUNCHES, &launches.to_le_bytes())?;

    Wr::<512>::new(&EV_COIN_LAUNCHED)
        .raw(&mint_key)
        .raw(payer.key())
        .raw(pool.key())
        .raw(&quote_key)
        .raw(amm_config.key())
        .str(name)
        .str(symbol)
        .str(uri)
        .u32(trade_fee)
        .u64(cap)
        .u128(usd)
        .u128(scale)
        .i32(tick)
        .u64(first_buy)
        .u64(bought)
        .u64(pooled)
        .i64(now)
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

/// Mints the 1B to the payer and drops the mint authority: the supply is fixed from here.
#[inline(never)]
#[allow(clippy::too_many_arguments)]
fn mint_supply(payer: &AccountInfo, payer_coin: &AccountInfo, mint: &AccountInfo, coin_acc: &AccountInfo, coin_key: &Pubkey, coin_signer: &[Signer], system: &AccountInfo, t22: &AccountInfo) -> ProgramResult {
    let mint_key = *mint.key();
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
    let mut d = Wr::<16>::new(&[7]);
    d.u64(SUPPLY);
    call(
        &TOKEN_2022,
        &[AccountMeta::writable(&mint_key), AccountMeta::writable(payer_coin.key()), AccountMeta::readonly_signer(coin_key)],
        &[mint, payer_coin, coin_acc],
        d.out(),
        coin_signer,
    )?;
    // SetAuthority { MintTokens, None }
    call(&TOKEN_2022, &[AccountMeta::writable(&mint_key), AccountMeta::readonly_signer(coin_key)], &[mint, coin_acc], &[6, 0, 0], coin_signer)
}

/// CLMM `create_customizable_pool`, fees taken in the pair token only, no dynamic fee.
#[inline(never)]
fn create_pool(a: &[&AccountInfo; 15], prog_0: &Pubkey, prog_1: &Pubkey, sqrt_price: u128, fee_on: u8, signers: &[Signer]) -> ProgramResult {
    let [creator, amm_config, pool, token_0, token_1, vault_0, vault_1, observation, bitmap, token, t22, system, rent, support_mint, clmm_program] = *a;
    let p0 = if *prog_0 == TOKEN { token } else { t22 };
    let p1 = if *prog_1 == TOKEN { token } else { t22 };
    let mut d = Wr::<32>::new(&clmm::IX_CREATE_CUSTOMIZABLE_POOL);
    d.u128(sqrt_price).u8(fee_on).u8(0);
    call(
        &CLMM,
        &[
            AccountMeta::writable_signer(creator.key()),
            AccountMeta::readonly(amm_config.key()),
            AccountMeta::writable(pool.key()),
            AccountMeta::readonly(token_0.key()),
            AccountMeta::readonly(token_1.key()),
            AccountMeta::writable(vault_0.key()),
            AccountMeta::writable(vault_1.key()),
            AccountMeta::writable(observation.key()),
            AccountMeta::writable(bitmap.key()),
            AccountMeta::readonly(prog_0),
            AccountMeta::readonly(prog_1),
            AccountMeta::readonly(&SYSTEM),
            AccountMeta::readonly(&RENT),
            AccountMeta::readonly(support_mint.key()),
        ],
        &[creator, amm_config, pool, token_0, token_1, vault_0, vault_1, observation, bitmap, p0, p1, system, rent, support_mint, clmm_program],
        d.out(),
        signers,
    )
}

/// CLMM `open_position_with_token22_nft`: the position NFT goes to the coin PDA.
#[inline(never)]
fn open_position(a: &[&AccountInfo; 21], o: &Opening, spacing: i32, max_0: u64, max_1: u64) -> ProgramResult {
    let [payer, owner, nft_mint, nft_account, pool, protocol_position, tick_lower, tick_upper, position, acct_0, acct_1, vault_0, vault_1, rent, system, token, ata_program, t22, mint_0, mint_1, clmm_program] = *a;
    let mut d = Wr::<64>::new(&clmm::IX_OPEN_POSITION_T22);
    d.i32(o.lower)
        .i32(o.upper)
        .i32(math::tick_array_start(o.lower, spacing))
        .i32(math::tick_array_start(o.upper, spacing))
        .u128(o.liquidity)
        .u64(max_0)
        .u64(max_1)
        .u8(0) // with_metadata
        .u8(0); // base_flag: None, the liquidity is given
    call(
        &CLMM,
        &[
            AccountMeta::writable_signer(payer.key()),
            AccountMeta::readonly(owner.key()),
            AccountMeta::writable_signer(nft_mint.key()),
            AccountMeta::writable(nft_account.key()),
            AccountMeta::writable(pool.key()),
            AccountMeta::readonly(protocol_position.key()),
            AccountMeta::writable(tick_lower.key()),
            AccountMeta::writable(tick_upper.key()),
            AccountMeta::writable(position.key()),
            AccountMeta::writable(acct_0.key()),
            AccountMeta::writable(acct_1.key()),
            AccountMeta::writable(vault_0.key()),
            AccountMeta::writable(vault_1.key()),
            AccountMeta::readonly(&RENT),
            AccountMeta::readonly(&SYSTEM),
            AccountMeta::readonly(&TOKEN),
            AccountMeta::readonly(&ATA),
            AccountMeta::readonly(&TOKEN_2022),
            AccountMeta::readonly(mint_0.key()),
            AccountMeta::readonly(mint_1.key()),
        ],
        &[payer, owner, nft_mint, nft_account, pool, protocol_position, tick_lower, tick_upper, position, acct_0, acct_1, vault_0, vault_1, rent, system, token, ata_program, t22, mint_0, mint_1, clmm_program],
        d.out(),
        &[],
    )
}

/// CLMM `decrease_liquidity_v2`, signed by the coin PDA as the position NFT's owner. With `liquidity` 0 it only
/// pulls the fees.
#[inline(never)]
fn decrease(a: &[&AccountInfo; 17], liquidity: u128, signers: &[Signer]) -> ProgramResult {
    let [owner, nft_account, position, pool, protocol_position, vault_0, vault_1, tick_lower, tick_upper, to_0, to_1, token, t22, memo, mint_0, mint_1, clmm_program] = *a;
    let mut d = Wr::<40>::new(&clmm::IX_DECREASE_LIQUIDITY_V2);
    d.u128(liquidity).u64(0).u64(0);
    call(
        &CLMM,
        &[
            AccountMeta::readonly_signer(owner.key()),
            AccountMeta::readonly(nft_account.key()),
            AccountMeta::writable(position.key()),
            AccountMeta::writable(pool.key()),
            AccountMeta::writable(protocol_position.key()),
            AccountMeta::writable(vault_0.key()),
            AccountMeta::writable(vault_1.key()),
            AccountMeta::writable(tick_lower.key()),
            AccountMeta::writable(tick_upper.key()),
            AccountMeta::writable(to_0.key()),
            AccountMeta::writable(to_1.key()),
            AccountMeta::readonly(&TOKEN),
            AccountMeta::readonly(&TOKEN_2022),
            AccountMeta::readonly(&MEMO),
            AccountMeta::readonly(mint_0.key()),
            AccountMeta::readonly(mint_1.key()),
        ],
        &[owner, nft_account, position, pool, protocol_position, vault_0, vault_1, tick_lower, tick_upper, to_0, to_1, token, t22, memo, mint_0, mint_1, clmm_program],
        d.out(),
        signers,
    )
}

/// Checks the CLMM accounts shared by `claim_fees` and `collect` against the coin's record. CLMM checks the rest
/// (vaults, tick arrays and the NFT account against the position).
fn check_position(s: &[u8], quote_mint: &AccountInfo, pool: &AccountInfo, position: &AccountInfo, nft_account: &AccountInfo) -> ProgramResult {
    req!(is_key(quote_mint, &rd_key(s, coin::QUOTE_MINT)), E::BadPair);
    req!(is_key(pool, &rd_key(s, coin::POOL)), E::BadPool);
    req!(is_key(position, &rd_key(s, coin::POSITION)), E::BadPool);
    req!(is_key(nft_account, &rd_key(s, coin::NFT_ACCOUNT)), E::BadPool);
    req!(position.is_owned_by(&CLMM), E::BadPool);
    Ok(())
}

/// Pulls the position's fees (pair token) and splits them: the platform the larger of 20% of the trading fee and
/// 0.2% of the volume, the creator the rest. Anyone can call it.
#[inline(never)]
fn claim_fees(accounts: &[AccountInfo]) -> ProgramResult {
    let [payer, config, coin_acc, mint, quote_mint, coin_coin, coin_quote, creator, creator_quote, fee_recipient, platform_quote, pool, position, nft_account, vault_0, vault_1, tick_lower, tick_upper, protocol_position, clmm_program, token, t22, memo, ata_program, system, ..] =
        accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    signer(payer)?;
    program(clmm_program, &CLMM)?;
    program(t22, &TOKEN_2022)?;
    program(token, &TOKEN)?;
    program(memo, &MEMO)?;
    program(ata_program, &ATA)?;
    program(system, &SYSTEM)?;
    let c = load_config(config)?;
    let mint_key = *mint.key();
    let s = load_coin(coin_acc, &mint_key)?;
    req!(coin_acc.is_writable(), E::BadAccount);
    check_position(&s, quote_mint, pool, position, nft_account)?;
    req!(is_key(creator, &rd_key(&s, coin::CREATOR)), E::BadCreator);
    req!(is_key(fee_recipient, &rd_key(&c, cfg::FEE_RECIPIENT)), E::BadFeeRecipient);
    let (quote_program, quote_decimals) = mint_info(quote_mint)?;
    let quote_prog_acc = if *quote_program == TOKEN { token } else { t22 };

    ata_idempotent(payer, coin_coin, coin_acc, mint, system, t22)?;
    ata_idempotent(payer, coin_quote, coin_acc, quote_mint, system, quote_prog_acc)?;
    ata_idempotent(payer, creator_quote, creator, quote_mint, system, quote_prog_acc)?;
    ata_idempotent(payer, platform_quote, fee_recipient, quote_mint, system, quote_prog_acc)?;

    let cb = [s[coin::BUMP]];
    let coin_seeds = [Seed::from(COIN_SEED), Seed::from(&mint_key), Seed::from(&cb)];
    let coin_signer = [Signer::from(&coin_seeds)];
    let before = token_amount(coin_quote)?;
    let coin_is_0 = s[coin::COIN_IS_0] == 1;
    let (to_0, to_1, mint_0, mint_1) = if coin_is_0 { (coin_coin, coin_quote, mint, quote_mint) } else { (coin_quote, coin_coin, quote_mint, mint) };
    decrease(
        &[coin_acc, nft_account, position, pool, protocol_position, vault_0, vault_1, tick_lower, tick_upper, to_0, to_1, token, t22, memo, mint_0, mint_1, clmm_program],
        0,
        &coin_signer,
    )?;
    // everything in the coin's pair-token account is fees: `collect` leaves its fees there too
    let total = token_amount(coin_quote)?;
    let claimed = total.saturating_sub(before);
    if total == 0 {
        return Ok(());
    }
    let share = rd_u16(&s, coin::PLATFORM_SHARE_BPS);
    let to_platform = math::mul_div(total as u128, share as u128, BPS as u128).ok_or_else(|| fail(E::Math))? as u64;
    let to_creator = total - to_platform;
    if to_creator > 0 {
        transfer_checked(quote_program, coin_quote, quote_mint, creator_quote, coin_acc, to_creator, quote_decimals, &coin_signer)?;
    }
    if to_platform > 0 {
        transfer_checked(quote_program, coin_quote, quote_mint, platform_quote, coin_acc, to_platform, quote_decimals, &coin_signer)?;
    }
    let cf = rd_u64(&s, coin::CREATOR_FEES).saturating_add(to_creator);
    let pf = rd_u64(&s, coin::PLATFORM_FEES).saturating_add(to_platform);
    write(coin_acc, coin::CREATOR_FEES, &cf.to_le_bytes())?;
    write(coin_acc, coin::PLATFORM_FEES, &pf.to_le_bytes())?;
    Wr::<112>::new(&EV_FEES_CLAIMED).raw(&mint_key).raw(quote_mint.key()).u64(claimed).u64(to_creator).u64(to_platform).emit();
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

/// Admin only: removes `bps` of the position's liquidity and sends the coins and pair tokens to the given
/// accounts. The fees earned so far first go to the coin's own pair-token account, for `claim_fees`.
#[inline(never)]
fn collect(accounts: &[AccountInfo], r: &mut Rd) -> ProgramResult {
    let [admin, config, coin_acc, mint, quote_mint, coin_coin, coin_quote, to_coin, to_quote, pool, position, nft_account, vault_0, vault_1, tick_lower, tick_upper, protocol_position, clmm_program, token, t22, memo, ..] =
        accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    signer(admin)?;
    let c = load_config(config)?;
    req!(rd_key(&c, cfg::ADMIN) == *admin.key(), E::NotAdmin);
    program(clmm_program, &CLMM)?;
    program(t22, &TOKEN_2022)?;
    program(token, &TOKEN)?;
    program(memo, &MEMO)?;
    let mint_key = *mint.key();
    let s = load_coin(coin_acc, &mint_key)?;
    check_position(&s, quote_mint, pool, position, nft_account)?;
    let (quote_program, _) = mint_info(quote_mint)?;
    let quote_key = *quote_mint.key();
    let (cm, co, _) = token_account(coin_coin, &TOKEN_2022)?;
    req!(cm == mint_key && co == *coin_acc.key(), E::BadAccount);
    let (qm, qo, _) = token_account(coin_quote, quote_program)?;
    req!(qm == quote_key && qo == *coin_acc.key(), E::BadAccount);
    let (cm, _, coins_before) = token_account(to_coin, &TOKEN_2022)?;
    req!(cm == mint_key, E::BadAccount);
    let (qm, _, quote_before) = token_account(to_quote, quote_program)?;
    req!(qm == quote_key, E::BadAccount);

    let bps = r.u16()?;
    req!(bps > 0 && bps as u64 <= BPS, E::BadBps);
    let held = {
        let d = position.try_borrow_data()?;
        req!(d.len() >= clmm::POSITION_LIQUIDITY + 16, E::BadAccount);
        rd_u128(&d, clmm::POSITION_LIQUIDITY)
    };
    let delta = math::mul_div(held, bps as u128, BPS as u128).ok_or_else(|| fail(E::Math))?;
    req!(delta > 0, E::NothingToCollect);

    let cb = [s[coin::BUMP]];
    let coin_seeds = [Seed::from(COIN_SEED), Seed::from(&mint_key), Seed::from(&cb)];
    let coin_signer = [Signer::from(&coin_seeds)];
    let coin_is_0 = s[coin::COIN_IS_0] == 1;
    let (mint_0, mint_1) = if coin_is_0 { (mint, quote_mint) } else { (quote_mint, mint) };
    let (fee_0, fee_1) = if coin_is_0 { (coin_coin, coin_quote) } else { (coin_quote, coin_coin) };
    decrease(
        &[coin_acc, nft_account, position, pool, protocol_position, vault_0, vault_1, tick_lower, tick_upper, fee_0, fee_1, token, t22, memo, mint_0, mint_1, clmm_program],
        0,
        &coin_signer,
    )?;
    let (out_0, out_1) = if coin_is_0 { (to_coin, to_quote) } else { (to_quote, to_coin) };
    decrease(
        &[coin_acc, nft_account, position, pool, protocol_position, vault_0, vault_1, tick_lower, tick_upper, out_0, out_1, token, t22, memo, mint_0, mint_1, clmm_program],
        delta,
        &coin_signer,
    )?;
    let coins = token_amount(to_coin)?.saturating_sub(coins_before);
    let quote = token_amount(to_quote)?.saturating_sub(quote_before);
    Wr::<160>::new(&EV_COLLECTED).raw(&mint_key).u16(bps).u128(delta).u64(coins).u64(quote).raw(to_coin.key()).raw(to_quote.key()).emit();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn platform_share_follows_the_fee() {
        // Raydium keeps 12% + 4% of the trading fee; the position gets 84%
        assert_eq!(platform_share_bps(10_000, 120_000, 40_000), 2_381); // 1%: 0.2% of volume out of 0.84%
        assert_eq!(platform_share_bps(40_000, 120_000, 40_000), 2_381); // 4%: a fifth of the fee is more
        assert_eq!(platform_share_bps(2_500, 120_000, 40_000), 9_524); // 0.25%: 0.2% out of 0.21%
        assert_eq!(platform_share_bps(10_000, 0, 0), 2_000); // no protocol share: a fifth of the fee
        assert_eq!(platform_share_bps(1_000, 0, 0), 10_000); // capped
    }

    #[test]
    fn opening_is_at_the_first_tick_past_3000_usd() {
        // SOL at $101.27: $3,000 is 29.62 SOL
        let cap = 29_623_879_634u64;
        let at = |t| math::sqrt_price_at_tick(t).unwrap();
        for coin_is_0 in [true, false] {
            let target = if coin_is_0 { math::sqrt_price_for_cap(cap, SUPPLY) } else { math::sqrt_price_for_cap(SUPPLY, cap) }.unwrap();
            // the tick a client would send
            let mut t = 0i32;
            if coin_is_0 {
                while at(t) >= target {
                    t -= 120;
                }
                while at(t) < target {
                    t += 120;
                }
            } else {
                while at(t) <= target {
                    t += 120;
                }
                while at(t) > target {
                    t -= 120;
                }
            }
            assert!(opening(coin_is_0, cap, 120, t, 0).is_ok());
            assert!(opening(coin_is_0, cap, 120, t + 120, 0).is_err());
            assert!(opening(coin_is_0, cap, 120, t - 120, 0).is_err());
            assert!(opening(coin_is_0, cap, 120, t + 1, 0).is_err());
            let o = opening(coin_is_0, cap, 120, t, 500_000_000).unwrap();
            assert_eq!((o.lower, o.upper), if coin_is_0 { (t, 443_520) } else { (-443_520, t) });
        }
    }
}
