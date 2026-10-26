//! Opening-price math for the Meteora DAMM v2 position.
//!
//! DAMM v2 prices are sqrt(token_b / token_a) in Q64.64, with token_a the coin
//! and token_b wrapped SOL, both in raw units. For a position over
//! [sqrt_min, sqrt_max] at sqrt_price p the pool holds
//!   a = L * (sqrt_max - p) / (p * sqrt_max)
//!   b = L * (p - sqrt_min) / 2^128
//! so a pool opened at p = sqrt_min holds only coins (single sided), and a
//! pool opened slightly above it holds the creator's first buy in SOL.
//!
//! A small 256-bit integer is enough here and keeps the program small.

/// DAMM v2's upper sqrt price bound (`constants::MAX_SQRT_PRICE`).
pub const MAX_SQRT_PRICE: u128 = 79226673521066979257578248091;
/// DAMM v2's lower sqrt price bound (`constants::MIN_SQRT_PRICE`).
pub const MIN_SQRT_PRICE: u128 = 4295048016;

/// Unsigned 256-bit integer as (high, low) 128-bit halves.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
#[cfg_attr(test, derive(Debug))]
pub struct U256 {
    hi: u128,
    lo: u128,
}

impl U256 {
    pub const ZERO: U256 = U256 { hi: 0, lo: 0 };

    pub const fn from(v: u128) -> U256 {
        U256 { hi: 0, lo: v }
    }

    /// a * b, exact.
    pub fn mul(a: u128, b: u128) -> U256 {
        const M: u128 = u64::MAX as u128;
        let (a1, a0) = (a >> 64, a & M);
        let (b1, b0) = (b >> 64, b & M);
        let p00 = a0 * b0;
        let p01 = a0 * b1;
        let p10 = a1 * b0;
        let p11 = a1 * b1;
        // middle terms each < 2^128; sum them with carries
        let mid = (p00 >> 64) + (p01 & M) + (p10 & M);
        let lo = (p00 & M) | (mid << 64);
        let hi = p11 + (p01 >> 64) + (p10 >> 64) + (mid >> 64);
        U256 { hi, lo }
    }

    /// self * b, or None on overflow.
    pub fn mul_u128(self, b: u128) -> Option<U256> {
        let low = U256::mul(self.lo, b);
        let high = U256::mul(self.hi, b);
        if high.hi != 0 {
            return None;
        }
        let hi = low.hi.checked_add(high.lo)?;
        Some(U256 { hi, lo: low.lo })
    }

    pub fn shl(self, n: u32) -> U256 {
        match n {
            0 => self,
            1..=127 => U256 { hi: (self.hi << n) | (self.lo >> (128 - n)), lo: self.lo << n },
            128..=255 => U256 { hi: self.lo << (n - 128), lo: 0 },
            _ => U256::ZERO,
        }
    }

    fn shr1(self) -> U256 {
        U256 { hi: self.hi >> 1, lo: (self.lo >> 1) | (self.hi << 127) }
    }

    fn sub(self, b: U256) -> U256 {
        let (lo, borrow) = self.lo.overflowing_sub(b.lo);
        U256 { hi: self.hi - b.hi - borrow as u128, lo }
    }

    fn add(self, b: U256) -> Option<U256> {
        let (lo, carry) = self.lo.overflowing_add(b.lo);
        Some(U256 { hi: self.hi.checked_add(b.hi)?.checked_add(carry as u128)?, lo })
    }

    fn bits(self) -> u32 {
        if self.hi != 0 {
            256 - self.hi.leading_zeros()
        } else {
            128 - self.lo.leading_zeros()
        }
    }

    fn bit(self, i: u32) -> bool {
        if i >= 128 {
            (self.hi >> (i - 128)) & 1 == 1
        } else {
            (self.lo >> i) & 1 == 1
        }
    }

    /// (quotient, remainder), or None when dividing by zero. Shift and
    /// subtract: slow, but it runs a handful of times per launch.
    pub fn div_rem(self, d: U256) -> Option<(U256, U256)> {
        if d == U256::ZERO {
            return None;
        }
        let mut q = U256::ZERO;
        let mut r = U256::ZERO;
        let mut i = self.bits();
        while i > 0 {
            i -= 1;
            r = r.shl(1);
            if self.bit(i) {
                r.lo |= 1;
            }
            if r >= d {
                r = r.sub(d);
                q = q.add(U256::from(1).shl(i))?;
            }
        }
        Some((q, r))
    }

    pub fn div(self, d: U256) -> Option<U256> {
        Some(self.div_rem(d)?.0)
    }

    pub fn div_ceil(self, d: U256) -> Option<U256> {
        let (q, r) = self.div_rem(d)?;
        if r == U256::ZERO {
            Some(q)
        } else {
            q.add(U256::from(1))
        }
    }

    pub fn to_u128(self) -> Option<u128> {
        if self.hi == 0 {
            Some(self.lo)
        } else {
            None
        }
    }

    pub fn to_u64(self) -> Option<u64> {
        u64::try_from(self.to_u128()?).ok()
    }

    /// floor(sqrt(self)), digit by digit (no division).
    pub fn isqrt(self) -> U256 {
        let mut rem = self;
        let mut res = U256::ZERO;
        // highest power of four <= self
        let b = self.bits();
        if b == 0 {
            return U256::ZERO;
        }
        let mut bit = U256::from(1).shl((b - 1) & !1);
        while bit != U256::ZERO {
            let t = res.add(bit).unwrap_or(U256 { hi: u128::MAX, lo: u128::MAX });
            if rem >= t {
                rem = rem.sub(t);
                res = res.shr1().add(bit).unwrap_or(res);
            } else {
                res = res.shr1();
            }
            bit = bit.shr1().shr1();
        }
        res
    }
}

/// a * b / c, rounded down, without u128 division (keeps the program small).
pub fn mul_div(a: u128, b: u128, c: u128) -> Option<u128> {
    U256::mul(a, b).div(U256::from(c))?.to_u128()
}

/// sqrt(cap_lamports / total_raw) in Q64.64: the price at which `total_raw`
/// coins are worth `cap_lamports`.
pub fn sqrt_price_for_cap(cap_lamports: u64, total_raw: u64) -> Option<u128> {
    if cap_lamports == 0 || total_raw == 0 {
        return None;
    }
    let q = U256::from(cap_lamports as u128).shl(128).div(U256::from(total_raw as u128))?;
    let s = q.isqrt().to_u128()?;
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
    let num = U256::mul(amount_a as u128, sqrt_min).mul_u128(sqrt_max)?;
    num.div(U256::from(sqrt_max - sqrt_min))?.to_u128()
}

/// Opening sqrt price that puts `lamports` of SOL into the pool on top of the
/// coin side: the price after a fee-free buy of `lamports` from `sqrt_min`.
/// Rounded down, so the pool never asks for more SOL than `lamports`.
pub fn sqrt_price_after_buy(sqrt_min: u128, liquidity: u128, lamports: u64) -> Option<u128> {
    if liquidity == 0 {
        return None;
    }
    let step = U256::from(lamports as u128).shl(128).div(U256::from(liquidity))?.to_u128()?;
    sqrt_min.checked_add(step)
}

/// Coins the pool takes in at `sqrt_price` (DAMM v2 rounds this up).
pub fn coins_in_pool(liquidity: u128, sqrt_price: u128, sqrt_max: u128) -> Option<u64> {
    let num = U256::mul(liquidity, sqrt_max.checked_sub(sqrt_price)?);
    let den = U256::mul(sqrt_price, sqrt_max);
    num.div_ceil(den)?.to_u64()
}

/// SOL the pool takes in at `sqrt_price` (DAMM v2 rounds this up).
pub fn sol_in_pool(liquidity: u128, sqrt_min: u128, sqrt_price: u128) -> Option<u64> {
    let prod = U256::mul(liquidity, sqrt_price.checked_sub(sqrt_min)?);
    prod.div_ceil(U256::from(1).shl(128))?.to_u64()
}

#[cfg(test)]
mod tests {
    use super::*;

    const TOTAL: u64 = 1_000_000_000 * 1_000_000;

    #[test]
    fn u256_mul_div() {
        let a = u128::MAX;
        let p = U256::mul(a, a); // (2^128-1)^2 = 2^256 - 2^129 + 1
        assert_eq!(p, U256 { hi: u128::MAX - 1, lo: 1 });
        let (q, r) = p.div_rem(U256::from(a)).unwrap();
        assert_eq!((q, r), (U256::from(a), U256::ZERO));
        let x = U256::from(12345678901234567890u128).shl(100);
        let (q, r) = x.div_rem(U256::from(987654321)).unwrap();
        assert_eq!(q.mul_u128(987654321).unwrap().add(r).unwrap(), x);
        assert!(r < U256::from(987654321));
    }

    #[test]
    fn isqrt_exact() {
        for n in [0u128, 1, 2, 3, 4, 15, 16, 17, 1 << 40, u64::MAX as u128, u128::MAX] {
            let r = U256::from(n).isqrt();
            let rr = r.mul_u128(r.to_u128().unwrap()).unwrap();
            let r1 = r.to_u128().unwrap() + 1;
            assert!(rr <= U256::from(n) && U256::mul(r1, r1) > U256::from(n), "n={n}");
        }
        let big = U256::from(3u128 << 100).shl(120);
        let r = big.isqrt();
        let r0 = r.to_u128().unwrap();
        assert!(U256::mul(r0, r0) <= big && U256::mul(r0 + 1, r0 + 1) > big);
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
