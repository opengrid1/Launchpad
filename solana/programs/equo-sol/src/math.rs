//! Opening-price math for the Meteora DAMM v2 position.
//!
//! DAMM v2 prices are sqrt(token_b / token_a) in Q64.64, with token_a the coin
//! and token_b wrapped SOL, both in raw units. For a position over
//! [sqrt_min, sqrt_max] at sqrt_price p the pool holds
//!   a = L * (sqrt_max - p) / (p * sqrt_max)
//!   b = L * (p - sqrt_min) / 2^128
//! so a pool opened at p = sqrt_min holds only coins (single sided), and a
//! pool opened slightly above it holds the creator's first buy in SOL.

use ruint::aliases::U256;

/// DAMM v2's upper sqrt price bound (`constants::MAX_SQRT_PRICE`).
pub const MAX_SQRT_PRICE: u128 = 79226673521066979257578248091;
/// DAMM v2's lower sqrt price bound (`constants::MIN_SQRT_PRICE`).
pub const MIN_SQRT_PRICE: u128 = 4295048016;

fn isqrt(n: U256) -> U256 {
    if n.is_zero() {
        return n;
    }
    // Newton's method from a power-of-two guess above sqrt(n)
    let bits = 256 - n.leading_zeros();
    let mut x = U256::from(1u8) << ((bits + 1) / 2);
    loop {
        let y = (x + n / x) >> 1;
        if y >= x {
            return x;
        }
        x = y;
    }
}

fn to_u128(v: U256) -> Option<u128> {
    if v > U256::from(u128::MAX) {
        None
    } else {
        Some(v.to::<u128>())
    }
}

/// sqrt(cap_lamports / total_raw) in Q64.64: the price at which `total_raw`
/// coins are worth `cap_lamports`.
pub fn sqrt_price_for_cap(cap_lamports: u64, total_raw: u64) -> Option<u128> {
    if cap_lamports == 0 || total_raw == 0 {
        return None;
    }
    let q = (U256::from(cap_lamports) << 128) / U256::from(total_raw);
    let s = to_u128(isqrt(q))?;
    if s < MIN_SQRT_PRICE || s >= MAX_SQRT_PRICE {
        return None;
    }
    Some(s)
}

/// Liquidity that holds `amount_a` coins between `sqrt_min` and `sqrt_max`
/// when the price sits at `sqrt_min`. Rounded down, so the pool never asks
/// for more coins than `amount_a`.
pub fn liquidity_for_coins(amount_a: u64, sqrt_min: u128, sqrt_max: u128) -> Option<u128> {
    if sqrt_min >= sqrt_max {
        return None;
    }
    let num = U256::from(amount_a)
        .checked_mul(U256::from(sqrt_min))?
        .checked_mul(U256::from(sqrt_max))?;
    to_u128(num / U256::from(sqrt_max - sqrt_min))
}

/// Opening sqrt price that puts `lamports` of SOL into the pool on top of the
/// coin side: the price after a fee-free buy of `lamports` from `sqrt_min`.
/// Rounded down, so the pool never asks for more SOL than `lamports`.
pub fn sqrt_price_after_buy(sqrt_min: u128, liquidity: u128, lamports: u64) -> Option<u128> {
    if liquidity == 0 {
        return None;
    }
    let step = (U256::from(lamports) << 128) / U256::from(liquidity);
    to_u128(U256::from(sqrt_min).checked_add(step)?)
}

/// Coins the pool takes in at `sqrt_price` (DAMM v2 rounds this up).
pub fn coins_in_pool(liquidity: u128, sqrt_price: u128, sqrt_max: u128) -> Option<u64> {
    let num = U256::from(liquidity).checked_mul(U256::from(sqrt_max - sqrt_price))?;
    let den = U256::from(sqrt_price).checked_mul(U256::from(sqrt_max))?;
    let v = num.div_ceil(den);
    if v > U256::from(u64::MAX) {
        None
    } else {
        Some(v.to::<u64>())
    }
}

/// SOL the pool takes in at `sqrt_price` (DAMM v2 rounds this up).
pub fn sol_in_pool(liquidity: u128, sqrt_min: u128, sqrt_price: u128) -> Option<u64> {
    let prod = U256::from(liquidity).checked_mul(U256::from(sqrt_price - sqrt_min))?;
    let v = prod.div_ceil(U256::from(1u8) << 128);
    if v > U256::from(u64::MAX) {
        None
    } else {
        Some(v.to::<u64>())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const TOTAL: u64 = 1_000_000_000 * 1_000_000;

    #[test]
    fn isqrt_exact() {
        for n in [0u64, 1, 2, 3, 4, 15, 16, 17, 1 << 40, u64::MAX] {
            let r = isqrt(U256::from(n)).to::<u128>();
            assert!(r * r <= n as u128 && (r + 1) * (r + 1) > n as u128, "n={n}");
        }
    }

    #[test]
    fn single_sided_pool_holds_the_slice() {
        // 30 SOL market cap for 1B coins, the pool holds a 1/3 slice
        let sl = sqrt_price_for_cap(30_000_000_000, TOTAL).unwrap();
        let slice = TOTAL / 3;
        let l = liquidity_for_coins(slice, sl, MAX_SQRT_PRICE).unwrap();
        let a = coins_in_pool(l, sl, MAX_SQRT_PRICE).unwrap();
        assert!(a <= slice && slice - a <= 1, "a={a}");
        assert_eq!(sol_in_pool(l, sl, sl).unwrap(), 0);
    }

    #[test]
    fn first_buy_is_priced_on_the_curve() {
        let sl = sqrt_price_for_cap(30_000_000_000, TOTAL).unwrap();
        let l = liquidity_for_coins(TOTAL, sl, MAX_SQRT_PRICE).unwrap();
        let buy = 1_000_000_000; // 1 SOL
        let sp = sqrt_price_after_buy(sl, l, buy).unwrap();
        let b = sol_in_pool(l, sl, sp).unwrap();
        assert!(b <= buy && buy - b <= 1, "b={b}");
        let a = coins_in_pool(l, sp, MAX_SQRT_PRICE).unwrap();
        let bought = TOTAL - a;
        // 1 SOL into a 30 SOL x*y curve buys 1B * 1/31 coins
        let want = TOTAL as u128 / 31;
        let got = bought as u128;
        assert!(got.abs_diff(want) * 10_000 < want, "got={got} want={want}");
    }
}
