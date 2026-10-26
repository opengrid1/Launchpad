//! Opening-price math for the Raydium CLMM position.
//!
//! CLMM prices are sqrt(token_1 / token_0) in Q64.64, in raw units; liquidity is unscaled. For a position over
//! [sqrt_a, sqrt_b] at sqrt price p the pool holds
//!   amount_0 = L * 2^64 * (sqrt_b - p) / (p * sqrt_b)
//!   amount_1 = L * (p - sqrt_a) / 2^64
//! The coin's position sits on one side of the opening price, so a pool opened at the edge of the range holds
//! only coins; a pool opened a little inside it also holds the creator's launch buy in the pair token.
//!
//! A small 256-bit integer is enough here and keeps the program small.

/// CLMM's sqrt price bounds (`tick_math::MIN_SQRT_PRICE_X64` / `MAX_SQRT_PRICE_X64`).
pub const MAX_SQRT_PRICE: u128 = 79226673521066979257578248091;
pub const MIN_SQRT_PRICE: u128 = 4295048016;
pub const MIN_TICK: i32 = -443636;
pub const MAX_TICK: i32 = 443636;
/// Ticks per CLMM tick array, in units of the tick spacing.
pub const TICK_ARRAY_SIZE: i32 = 60;

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

    pub fn add(self, b: U256) -> Option<U256> {
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

/// sqrt(1.0001^tick) in Q64.64, bit for bit as CLMM's `get_sqrt_price_at_tick`.
pub fn sqrt_price_at_tick(tick: i32) -> Option<u128> {
    if !(MIN_TICK..=MAX_TICK).contains(&tick) {
        return None;
    }
    const F: [u128; 19] = [
        0xfffcb933bd6fb800, 0xfff97272373d4000, 0xfff2e50f5f657000, 0xffe5caca7e10f000, 0xffcb9843d60f7000, 0xff973b41fa98e800,
        0xff2ea16466c9b000, 0xfe5dee046a9a3800, 0xfcbe86c7900bb000, 0xf987a7253ac65800, 0xf3392b0822bb6000, 0xe7159475a2caf000,
        0xd097f3bdfd2f2000, 0xa9f746462d9f8000, 0x70d869a156f31c00, 0x31be135f97ed3200, 0x9aa508b5b85a500, 0x5d6af8dedc582c, 0x2216e584f5fa,
    ];
    let abs = tick.unsigned_abs();
    let mut ratio: u128 = if abs & 1 != 0 { F[0] } else { 1 << 64 };
    for (i, f) in F.iter().enumerate().skip(1) {
        if abs & (1 << i) != 0 {
            ratio = (ratio * f) >> 64;
        }
    }
    if tick > 0 {
        ratio = U256::from(u128::MAX).div(U256::from(ratio))?.to_u128()?;
    }
    Some(ratio)
}

/// First tick of the tick array holding `tick`.
pub fn tick_array_start(tick: i32, spacing: i32) -> i32 {
    let n = spacing * TICK_ARRAY_SIZE;
    let mut s = tick / n;
    if tick < 0 && tick % n != 0 {
        s -= 1;
    }
    s * n
}

/// The furthest tick a position may reach with this spacing.
pub fn max_tick(spacing: i32) -> i32 {
    MAX_TICK - MAX_TICK % spacing
}

/// Coin is token 0, the position spans [sqrt_a, sqrt_b] above the opening price. Returns the liquidity that holds
/// `coins` with the price at sqrt_a, and the opening sqrt price after a fee-free buy of `quote` from sqrt_a.
/// Rounded so the pool never takes more than `coins` or `quote`.
pub fn open_coin0(coins: u64, sqrt_a: u128, sqrt_b: u128, quote: u64) -> Option<(u128, u128)> {
    if sqrt_a >= sqrt_b {
        return None;
    }
    // amount_0 = L * 2^64 * (b - a) / (a * b)
    let l = U256::mul(coins as u128, sqrt_a).mul_u128(sqrt_b)?.div(U256::from(sqrt_b - sqrt_a).shl(64))?.to_u128()?;
    if l == 0 {
        return None;
    }
    // amount_1 = L * (p - a) / 2^64
    let step = U256::from(quote as u128).shl(64).div(U256::from(l))?.to_u128()?;
    let p = sqrt_a.checked_add(step)?;
    if p >= sqrt_b {
        return None;
    }
    Some((l, p))
}

/// Coin is token 1, the position spans [sqrt_a, sqrt_b] below the opening price. Returns the liquidity that holds
/// `coins` with the price at sqrt_b, and the opening sqrt price after a fee-free buy of `quote` from sqrt_b.
pub fn open_coin1(coins: u64, sqrt_a: u128, sqrt_b: u128, quote: u64) -> Option<(u128, u128)> {
    if sqrt_a >= sqrt_b {
        return None;
    }
    // amount_1 = L * (b - a) / 2^64
    let l = U256::from(coins as u128).shl(64).div(U256::from(sqrt_b - sqrt_a))?.to_u128()?;
    if l == 0 {
        return None;
    }
    if quote == 0 {
        return Some((l, sqrt_b));
    }
    // amount_0 = L * 2^64 * (b - p) / (p * b)  =>  p = L * 2^64 * b / (L * 2^64 + quote * b), rounded up
    let l64 = U256::from(l).shl(64);
    let p = l64.mul_u128(sqrt_b)?.div_ceil(l64.add(U256::mul(quote as u128, sqrt_b))?)?.to_u128()?;
    if p <= sqrt_a {
        return None;
    }
    Some((l, p))
}

/// Token 0 held by liquidity `l` between p and sqrt_b (CLMM rounds up).
pub fn amount_0(l: u128, p: u128, sqrt_b: u128) -> Option<u64> {
    let num = U256::from(l).shl(64).mul_u128(sqrt_b.checked_sub(p)?)?;
    num.div_ceil(U256::from(sqrt_b))?.div_ceil(U256::from(p))?.to_u64()
}

/// Token 1 held by liquidity `l` between sqrt_a and p (CLMM rounds up).
pub fn amount_1(l: u128, sqrt_a: u128, p: u128) -> Option<u64> {
    U256::mul(l, p.checked_sub(sqrt_a)?).div_ceil(U256::from(1).shl(64))?.to_u64()
}

#[cfg(test)]
mod tests {
    use super::*;

    const TOTAL: u64 = 1_000_000_000 * 1_000_000_000;

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
    }

    #[test]
    fn ticks_match_clmm() {
        assert_eq!(sqrt_price_at_tick(0), Some(1 << 64));
        assert_eq!(sqrt_price_at_tick(MIN_TICK), Some(MIN_SQRT_PRICE));
        assert_eq!(sqrt_price_at_tick(MAX_TICK), Some(MAX_SQRT_PRICE));
        assert_eq!(sqrt_price_at_tick(MAX_TICK + 1), None);
        // 1.0001^(t/2) to within float precision
        for t in [-200_000, -120, -1, 1, 60, 7_200, 100_000] {
            let want = 1.0001f64.powf(t as f64 / 2.0) * 18446744073709551616.0;
            let got = sqrt_price_at_tick(t).unwrap() as f64;
            assert!((got / want - 1.0).abs() < 1e-9, "t={t} {}", got / want - 1.0);
        }
        let mut last = 0;
        for t in (-1000..1000).step_by(7) {
            let s = sqrt_price_at_tick(t).unwrap();
            assert!(s > last);
            last = s;
        }
        assert_eq!(tick_array_start(0, 120), 0);
        assert_eq!(tick_array_start(7_199, 120), 0);
        assert_eq!(tick_array_start(7_200, 120), 7_200);
        assert_eq!(tick_array_start(-1, 120), -7_200);
        assert_eq!(tick_array_start(-7_200, 120), -7_200);
        assert_eq!(max_tick(120), 443_520);
        assert_eq!(max_tick(60), 443_580);
    }

    // a $3,000 cap for 1B coins at $100/SOL: 30 SOL
    const CAP: u64 = 30_000_000_000;

    #[test]
    fn coin0_opens_single_sided_and_prices_the_buy() {
        let a = sqrt_price_for_cap(CAP, TOTAL).unwrap();
        let b = sqrt_price_at_tick(max_tick(120)).unwrap();
        let (l, p) = open_coin0(TOTAL - 4, a, b, 0).unwrap();
        assert_eq!(p, a);
        let c = amount_0(l, p, b).unwrap();
        // what liquidity rounding leaves out is dust: a few millionths of a coin
        assert!(c <= TOTAL && TOTAL - c < 10_000, "c={c}");
        assert_eq!(amount_1(l, a, p).unwrap(), 0);
        // 1 SOL into a 30 SOL x*y curve buys 1/31 of the coins
        let buy = 1_000_000_000;
        let (l2, p2) = open_coin0(TOTAL - 4, a, b, buy).unwrap();
        assert_eq!(l2, l);
        let q = amount_1(l, a, p2).unwrap();
        assert!(q <= buy && buy - q <= 1, "q={q}");
        let bought = TOTAL - amount_0(l, p2, b).unwrap();
        let want = TOTAL as u128 / 31;
        assert!((bought as u128).abs_diff(want) * 10_000 < want, "bought={bought}");
    }

    #[test]
    fn coin1_opens_single_sided_and_prices_the_buy() {
        // coin is token 1: the price is coins per lamport
        let b = sqrt_price_for_cap(TOTAL, CAP).unwrap();
        let a = sqrt_price_at_tick(-max_tick(120)).unwrap();
        let (l, p) = open_coin1(TOTAL - 4, a, b, 0).unwrap();
        assert_eq!(p, b);
        let c = amount_1(l, a, p).unwrap();
        assert!(c <= TOTAL && TOTAL - c < 10_000, "c={c}");
        let buy = 1_000_000_000;
        let (_, p2) = open_coin1(TOTAL - 4, a, b, buy).unwrap();
        let q = amount_0(l, p2, b).unwrap();
        assert!(q <= buy + 1 && q + 2 >= buy, "q={q}");
        let bought = TOTAL - amount_1(l, a, p2).unwrap();
        let want = TOTAL as u128 / 31;
        assert!((bought as u128).abs_diff(want) * 10_000 < want, "bought={bought}");
    }
}
