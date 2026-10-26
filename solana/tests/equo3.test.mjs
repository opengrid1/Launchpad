// Equo on Solana (Raydium CLMM), end to end against a local validator that runs the real Raydium CLMM program,
// its fee tiers and SPYx (cloned from mainnet), with Pyth price accounts copied from mainnet and stamped fresh.
// Start it with scripts/test-validator.sh, then run `node --test tests/equo3.test.mjs`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import {
  AddressLookupTableProgram, ComputeBudgetProgram, Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram,
  Transaction, TransactionInstruction, TransactionMessage, VersionedTransaction, sendAndConfirmTransaction,
} from '@solana/web3.js';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID, NATIVE_MINT, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction, createSyncNativeInstruction, getAccount, getAssociatedTokenAddressSync,
  getMint, getTokenMetadata,
} from '@solana/spl-token';

const RPC = process.env.RPC || 'http://127.0.0.1:8899';
const cx = new Connection(RPC, 'confirmed');
const PROGRAM = new PublicKey(process.env.EQUO_SOL || '6mdh7toDGpPEk8CYokVLi2aQMLDnB9jVkzhP5n9Dt4wR');
const CLMM = new PublicKey('CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK');
const MEMO = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
const RENT = new PublicKey('SysvarRent111111111111111111111111111111111');
const BPF_UPGRADEABLE = new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111');
const FEE_1 = new PublicKey('A1BBtTYJd4i3xU8D6Tc2FzU6ZN4oXZWXKZnCxwbHXr8x'); // 1%, spacing 120
const FEE_025 = new PublicKey('E64NGkDLLCdQ2yFNPcavaKptrEgmiQaNykUuLC1Qgwyp'); // 0.25%, spacing 60
const FEE_001 = new PublicKey('9iFER3bpjf1PTTCQCfTRu17EJgvsxo9pVyA9QWwEuX4x'); // 0.01%, spacing 1: not allowed
const SPYX = new PublicKey('XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W');
const PYTH_SOL = new PublicKey('7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE');
const PYTH_SPYX = new PublicKey('jf8MarLKgBte4f3NWufbNpGRCuBfJLhuZPuFigvSQR2');
const META = JSON.parse(readFileSync(process.env.EQUO_TEST_META || new URL('../.test-accounts/meta.json', import.meta.url), 'utf8'));
const PYTH_STALE = new PublicKey(META.stalePrice);
const SPYX_HOLDER = new PublicKey(META.spyxHolder);
const SUPPLY = 1_000_000_000n * 1_000_000_000n;
const MAX_TICK = 443636;

const wallet = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(`${homedir()}/.config/solana/id.json`, 'utf8'))));

// ---- encoding ----------------------------------------------------------
const disc = (name, ns = 'global') => createHash('sha256').update(`${ns}:${name}`).digest().subarray(0, 8);
const u8 = (v) => Buffer.from([v]);
const u16 = (v) => { const b = Buffer.alloc(2); b.writeUInt16LE(v); return b; };
const i32 = (v) => { const b = Buffer.alloc(4); b.writeInt32LE(v); return b; };
const i32be = (v) => { const b = Buffer.alloc(4); b.writeInt32BE(v); return b; };
const u64 = (v) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(v)); return b; };
const u128 = (v) => { const b = Buffer.alloc(16); b.writeBigUInt64LE(BigInt(v) & ((1n << 64n) - 1n)); b.writeBigUInt64LE(BigInt(v) >> 64n, 8); return b; };
const str = (s) => { const d = Buffer.from(s, 'utf8'); return Buffer.concat([u32(d.length), d]); };
const u32 = (v) => { const b = Buffer.alloc(4); b.writeUInt32LE(v); return b; };
const rdU128 = (d, o) => d.readBigUInt64LE(o) + (d.readBigUInt64LE(o + 8) << 64n);
const w = (pubkey, isSigner = false) => ({ pubkey, isSigner, isWritable: true });
const r = (pubkey, isSigner = false) => ({ pubkey, isSigner, isWritable: false });
const ix = (name, keys, ...args) => new TransactionInstruction({ programId: PROGRAM, keys, data: Buffer.concat([disc(name), ...args]) });

const pda = (seeds, prog = PROGRAM) => PublicKey.findProgramAddressSync(seeds, prog)[0];
const CONFIG = pda([Buffer.from('config3')]);
const coinPda = (mint) => pda([Buffer.from('coin3'), mint.toBuffer()]);
const poolPayer = (mint) => pda([Buffer.from('pool_payer'), mint.toBuffer()]);
const ata = (owner, mint, prog) => getAssociatedTokenAddressSync(mint, owner, true, prog);
const ray = {
  pool: (cfg, m0, m1) => pda([Buffer.from('pool'), cfg.toBuffer(), m0.toBuffer(), m1.toBuffer()], CLMM),
  vault: (pool, m) => pda([Buffer.from('pool_vault'), pool.toBuffer(), m.toBuffer()], CLMM),
  observation: (pool) => pda([Buffer.from('observation'), pool.toBuffer()], CLMM),
  bitmap: (pool) => pda([Buffer.from('pool_tick_array_bitmap_extension'), pool.toBuffer()], CLMM),
  tickArray: (pool, start) => pda([Buffer.from('tick_array'), pool.toBuffer(), i32be(start)], CLMM),
  position: (nft) => pda([Buffer.from('position'), nft.toBuffer()], CLMM),
  protocolPosition: (pool, lo, hi) => pda([Buffer.from('position'), pool.toBuffer(), i32be(lo), i32be(hi)], CLMM),
  support: (m) => pda([Buffer.from('support_mint'), m.toBuffer()], CLMM),
};

// ---- CLMM price math (the program's, in BigInt) ---------------------------
const F = [0xfffcb933bd6fb800n, 0xfff97272373d4000n, 0xfff2e50f5f657000n, 0xffe5caca7e10f000n, 0xffcb9843d60f7000n, 0xff973b41fa98e800n,
  0xff2ea16466c9b000n, 0xfe5dee046a9a3800n, 0xfcbe86c7900bb000n, 0xf987a7253ac65800n, 0xf3392b0822bb6000n, 0xe7159475a2caf000n,
  0xd097f3bdfd2f2000n, 0xa9f746462d9f8000n, 0x70d869a156f31c00n, 0x31be135f97ed3200n, 0x9aa508b5b85a500n, 0x5d6af8dedc582cn, 0x2216e584f5fan];
function sqrtAt(t) {
  const a = Math.abs(t);
  let x = a & 1 ? F[0] : 1n << 64n;
  for (let i = 1; i < 19; i++) if (a & (1 << i)) x = (x * F[i]) >> 64n;
  return t > 0 ? ((1n << 128n) - 1n) / x : x;
}
function isqrt(n) {
  if (n < 2n) return n;
  let x = BigInt(Math.floor(Math.sqrt(Number(n))));
  while (x * x > n) x--;
  while ((x + 1n) * (x + 1n) <= n) x++;
  return x;
}
const arrayStart = (t, s) => Math.floor(t / (s * 60)) * s * 60;
const maxTick = (s) => MAX_TICK - (MAX_TICK % s);

/** Pair raw units worth $3,000, from a Pyth account. */
async function capOf(priceAcc, decimals) {
  const d = (await cx.getAccountInfo(priceAcc)).data;
  const price = d.readBigInt64LE(73), expo = d.readInt32LE(89);
  return (3000n * 10n ** BigInt(decimals) * 10n ** BigInt(-expo)) / price;
}
/** The start tick the program expects. */
function startTick(coinIs0, cap, s) {
  const target = coinIs0 ? isqrt((cap << 128n) / SUPPLY) : isqrt((SUPPLY << 128n) / cap);
  let t = Math.floor(Math.log(Number(target) / 2 ** 64) * 2 / Math.log(1.0001));
  t -= ((t % s) + s) % s;
  if (coinIs0) { while (sqrtAt(t) >= target) t -= s; while (sqrtAt(t) < target) t += s; }
  else { while (sqrtAt(t) <= target) t += s; while (sqrtAt(t) > target) t -= s; }
  return t;
}

// ---- transactions --------------------------------------------------------
const CU = ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 });
async function send(ixs, signers) {
  return sendAndConfirmTransaction(cx, new Transaction().add(CU, ...ixs), signers, { commitment: 'confirmed' });
}
let lut;
async function sendV0(ixs, signers) {
  const { blockhash } = await cx.getLatestBlockhash();
  const msg = new TransactionMessage({ payerKey: signers[0].publicKey, recentBlockhash: blockhash, instructions: [CU, ...ixs] }).compileToV0Message([lut]);
  const tx = new VersionedTransaction(msg);
  tx.sign(signers);
  const raw = tx.serialize();
  const sig = await cx.sendRawTransaction(raw, { skipPreflight: false });
  const res = await cx.confirmTransaction(sig, 'confirmed');
  if (res.value.err) throw Object.assign(new Error(JSON.stringify(res.value.err)), { logs: (await cx.getTransaction(sig, { maxSupportedTransactionVersion: 0, commitment: 'confirmed' }))?.meta?.logMessages });
  return { sig, size: raw.length };
}
async function expectFail(p, re) {
  try { await p; } catch (e) {
    const logs = (e.logs || e.transactionLogs || []).join('\n') + String(e.message);
    if (re) assert.match(logs, re);
    return;
  }
  assert.fail('expected the transaction to fail');
}
async function fund(pk, sol = 100) {
  const sig = await cx.requestAirdrop(pk, sol * LAMPORTS_PER_SOL);
  await cx.confirmTransaction(sig, 'confirmed');
}
const bal = async (a) => BigInt((await getAccount(cx, a, 'confirmed', (await cx.getAccountInfo(a)).owner)).amount);

/** A mint keypair on the wanted side of `quote` (CLMM orders a pool's mints by address). */
function mintKeypair(coinIs0, quote) {
  for (;;) {
    const k = Keypair.generate();
    if ((Buffer.compare(k.publicKey.toBuffer(), quote.toBuffer()) < 0) === coinIs0) return k;
  }
}

/** Every account a launch names, worked out the way a client would. */
function launchAccounts({ payer, mint, nft, quote, price, cfg, spacing, coinIs0, tick, payerQuote }) {
  const [m0, m1] = coinIs0 ? [mint, quote] : [quote, mint];
  const pool = ray.pool(cfg, m0, m1);
  const end = maxTick(spacing);
  const [lo, hi] = coinIs0 ? [tick, end] : [-end, tick];
  const coin = coinPda(mint);
  const a = {
    coin, pool, m0, m1, lo, hi,
    vault0: ray.vault(pool, m0), vault1: ray.vault(pool, m1),
    tickLower: ray.tickArray(pool, arrayStart(lo, spacing)), tickUpper: ray.tickArray(pool, arrayStart(hi, spacing)),
    position: ray.position(nft), protocolPosition: ray.protocolPosition(pool, lo, hi),
    nftAccount: ata(coin, nft, TOKEN_2022_PROGRAM_ID), payerCoin: ata(payer, mint, TOKEN_2022_PROGRAM_ID),
  };
  a.keys = [
    w(payer, true), w(CONFIG), w(mint, true), w(coin), w(poolPayer(mint)), w(a.payerCoin), w(payerQuote), r(quote), r(price), r(cfg),
    w(pool), w(a.vault0), w(a.vault1), w(ray.observation(pool)), w(ray.bitmap(pool)), w(nft, true), w(a.nftAccount), w(a.position),
    r(a.protocolPosition), w(a.tickLower), w(a.tickUpper), r(ray.support(quote)), r(CLMM), r(TOKEN_PROGRAM_ID), r(TOKEN_2022_PROGRAM_ID),
    r(ASSOCIATED_TOKEN_PROGRAM_ID), r(SystemProgram.programId), r(RENT),
  ];
  return a;
}

/** Wraps `lamports` (plus 2 for the pool's rounding) into the payer's WSOL account. */
async function wrap(kp, lamports) {
  const acc = ata(kp.publicKey, NATIVE_MINT, TOKEN_PROGRAM_ID);
  const ixs = [createAssociatedTokenAccountIdempotentInstruction(kp.publicKey, acc, kp.publicKey, NATIVE_MINT, TOKEN_PROGRAM_ID)];
  if (lamports > 0n) ixs.push(SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: acc, lamports: lamports + 2n }), createSyncNativeInstruction(acc));
  await send(ixs, [kp]);
  return acc;
}

async function launch({ creator, coinIs0 = false, quote = NATIVE_MINT, price = PYTH_SOL, cfg = FEE_1, spacing = 120, buy = 0n, name = 'Equo Test', symbol = 'EQT', uri = 'https://equo.fun/c/eqt.json', tickShift = 0, payerQuote }) {
  const mint = mintKeypair(coinIs0, quote);
  const nft = Keypair.generate();
  const decimals = quote.equals(NATIVE_MINT) ? 9 : 8;
  const cap = await capOf(price.equals(PYTH_STALE) ? PYTH_SOL : price, decimals);
  const tick = startTick(coinIs0, cap, spacing) + tickShift;
  payerQuote ??= await wrap(creator, buy);
  const a = launchAccounts({ payer: creator.publicKey, mint: mint.publicKey, nft: nft.publicKey, quote, price, cfg, spacing, coinIs0, tick, payerQuote });
  const data = [str(name), str(symbol), str(uri), i32(tick), u64(buy)];
  const res = await sendV0([ix('launch', a.keys, ...data)], [creator, mint, nft]);
  return { ...a, mint: mint.publicKey, nft: nft.publicKey, quote, cfg, spacing, coinIs0, tick, cap, creator, payerQuote, size: res.size };
}

const poolState = async (pool) => {
  const d = (await cx.getAccountInfo(pool)).data;
  return { liquidity: rdU128(d, 237), sqrt: rdU128(d, 253), tick: d.readInt32LE(269), feeOn: d };
};

/** Raydium swap_v2, exact input; `buy` swaps the pair token for coins. Amounts are raw units (BigInt above 2^53). */
async function swap(kp, L, buy, amount) {
  const coinVault = L.coinIs0 ? L.vault0 : L.vault1, quoteVault = L.coinIs0 ? L.vault1 : L.vault0;
  const quoteProg = L.quote.equals(NATIVE_MINT) ? TOKEN_PROGRAM_ID : TOKEN_2022_PROGRAM_ID;
  const myCoin = ata(kp.publicKey, L.mint, TOKEN_2022_PROGRAM_ID);
  const myQuote = L.quote.equals(SPYX) && kp.publicKey.equals(wallet.publicKey) ? SPYX_HOLDER : ata(kp.publicKey, L.quote, quoteProg);
  const pre = [createAssociatedTokenAccountIdempotentInstruction(kp.publicKey, myCoin, kp.publicKey, L.mint, TOKEN_2022_PROGRAM_ID)];
  if (L.quote.equals(NATIVE_MINT)) {
    pre.push(createAssociatedTokenAccountIdempotentInstruction(kp.publicKey, myQuote, kp.publicKey, NATIVE_MINT, TOKEN_PROGRAM_ID));
    if (buy) pre.push(SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: myQuote, lamports: Number(amount) }), createSyncNativeInstruction(myQuote));
  }
  const [inAcc, outAcc, inVault, outVault, inMint, outMint] = buy
    ? [myQuote, myCoin, quoteVault, coinVault, L.quote, L.mint]
    : [myCoin, myQuote, coinVault, quoteVault, L.mint, L.quote];
  // price goes up when token 1 comes in
  const up = inMint.equals(L.m1);
  const arrays = up ? [L.tickLower, L.tickUpper] : [L.tickUpper, L.tickLower];
  const uniq = arrays.filter((a, i) => arrays.findIndex((b) => b.equals(a)) === i);
  const data = Buffer.concat([disc('swap_v2'), u64(amount), u64(0), u128(0), u8(1)]);
  const swapIx = new TransactionInstruction({
    programId: CLMM,
    keys: [r(kp.publicKey, true), r(L.cfg), w(L.pool), w(inAcc), w(outAcc), w(inVault), w(outVault), w(ray.observation(L.pool)),
      r(TOKEN_PROGRAM_ID), r(TOKEN_2022_PROGRAM_ID), r(MEMO), r(inMint), r(outMint), w(ray.bitmap(L.pool)), ...uniq.map((a) => w(a))],
    data,
  });
  const before = await bal(outAcc).catch(() => 0n);
  await send([...pre, swapIx], [kp]);
  return (await bal(outAcc)) - before;
}

function claimKeys(payer, L, feeRecipient) {
  const quoteProg = L.quote.equals(NATIVE_MINT) ? TOKEN_PROGRAM_ID : TOKEN_2022_PROGRAM_ID;
  return [
    w(payer, true), r(CONFIG), w(L.coin), r(L.mint), r(L.quote), w(ata(L.coin, L.mint, TOKEN_2022_PROGRAM_ID)), w(ata(L.coin, L.quote, quoteProg)),
    r(L.creatorKey ?? L.creator.publicKey), w(ata(L.creatorKey ?? L.creator.publicKey, L.quote, quoteProg)), r(feeRecipient), w(ata(feeRecipient, L.quote, quoteProg)),
    w(L.pool), w(L.position), r(L.nftAccount), w(L.vault0), w(L.vault1), w(L.tickLower), w(L.tickUpper), w(L.protocolPosition),
    r(CLMM), r(TOKEN_PROGRAM_ID), r(TOKEN_2022_PROGRAM_ID), r(MEMO), r(ASSOCIATED_TOKEN_PROGRAM_ID), r(SystemProgram.programId),
  ];
}

// ---- the suite -----------------------------------------------------------
const admin = Keypair.generate();
const feeRecipient = Keypair.generate();
const alice = Keypair.generate();
const bob = Keypair.generate();
let launched = {};

test('setup: fund, initialize, lookup table', async () => {
  for (const k of [wallet.publicKey, admin.publicKey, alice.publicKey, bob.publicKey]) await fund(k, 200);
  const programData = pda([PROGRAM.toBuffer()], BPF_UPGRADEABLE);
  const init = (signer) => ix('initialize', [w(signer.publicKey, true), w(CONFIG), r(PROGRAM), r(programData), r(SystemProgram.programId)], admin.publicKey.toBuffer(), feeRecipient.publicKey.toBuffer());
  await expectFail(send([init(alice)], [alice]), /NotUpgradeAuthority/);
  await send([init(wallet)], [wallet]);
  await expectFail(send([init(wallet)], [wallet]), /BadAccount|already in use/);

  const slot = await cx.getSlot('finalized');
  const [create, table] = AddressLookupTableProgram.createLookupTable({ authority: wallet.publicKey, payer: wallet.publicKey, recentSlot: slot });
  const addresses = [CONFIG, CLMM, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, SystemProgram.programId, RENT, MEMO,
    ComputeBudgetProgram.programId, NATIVE_MINT, SPYX, PYTH_SOL, PYTH_SPYX, PYTH_STALE, FEE_1, FEE_025, FEE_001, ray.support(NATIVE_MINT), ray.support(SPYX)];
  await send([create, AddressLookupTableProgram.extendLookupTable({ lookupTable: table, authority: wallet.publicKey, payer: wallet.publicKey, addresses })], [wallet]);
  for (let i = 0; i < 30; i++) {
    lut = (await cx.getAddressLookupTable(table)).value;
    if (lut && lut.state.addresses.length === addresses.length && (await cx.getSlot()) > lut.state.lastExtendedSlot) break;
    await new Promise((s) => setTimeout(s, 500));
  }
  await new Promise((s) => setTimeout(s, 1000));
});

for (const coinIs0 of [false, true]) {
  test(`launch on SOL, no launch buy, coin is token ${coinIs0 ? 0 : 1}`, async () => {
    const L = await launch({ creator: alice, coinIs0 });
    launched[coinIs0 ? 'sol0' : 'sol1'] = L;
    assert.ok(L.size <= 1232, `tx ${L.size} bytes`);

    // the coin: 1B, no mint or freeze authority, metadata fixed
    const mint = await getMint(cx, L.mint, 'confirmed', TOKEN_2022_PROGRAM_ID);
    assert.equal(mint.supply, SUPPLY);
    assert.equal(mint.decimals, 9);
    assert.equal(mint.mintAuthority, null);
    assert.equal(mint.freezeAuthority, null);
    const md = await getTokenMetadata(cx, L.mint, 'confirmed', TOKEN_2022_PROGRAM_ID);
    assert.equal(md.name, 'Equo Test');
    assert.equal(md.updateAuthority, undefined);

    // all but dust in the pool; the creator keeps the margin
    const kept = await bal(L.payerCoin);
    assert.ok(kept >= 4n && kept < 10_000n, `kept ${kept}`);
    const coinVault = coinIs0 ? L.vault0 : L.vault1;
    assert.equal(await bal(coinVault), SUPPLY - kept);

    // the position belongs to the coin PDA and spans start..end of range
    const nft = await getAccount(cx, L.nftAccount, 'confirmed', TOKEN_2022_PROGRAM_ID);
    assert.ok(nft.owner.equals(L.coin));
    assert.equal(nft.amount, 1n);
    const pos = (await cx.getAccountInfo(L.position)).data;
    assert.deepEqual([pos.readInt32LE(73), pos.readInt32LE(77)], [L.lo, L.hi]);

    // opening price: $3,000 (within one tick spacing above)
    const ps = await poolState(L.pool);
    const sqrt = Number(ps.sqrt) / 2 ** 64;
    const pairPerCoin = coinIs0 ? sqrt * sqrt : 1 / (sqrt * sqrt);
    const mcapInPair = pairPerCoin * Number(SUPPLY);
    const ratio = mcapInPair / Number(L.cap);
    assert.ok(ratio >= 0.999999 && ratio < 1.0121, `mcap/$3000 = ${ratio}`);
    // the pool creator is the program's PDA, not the creator
    const owner = new PublicKey((await cx.getAccountInfo(L.pool)).data.subarray(41, 73));
    assert.ok(owner.equals(poolPayer(L.mint)));
    // and the PDA gave back what the pool did not use
    assert.equal(await cx.getBalance(poolPayer(L.mint)), 0);

    const st = (await cx.getAccountInfo(L.coin)).data;
    assert.ok(new PublicKey(st.subarray(40, 72)).equals(alice.publicKey));
    assert.equal(st.readUInt16LE(245), 2381);
  });
}

test('launch buy is priced on the curve, fee-free, and stays with the creator', async () => {
  const buy = 1_000_000_000n; // 1 SOL
  for (const coinIs0 of [false, true]) {
    const solBefore = await cx.getBalance(bob.publicKey);
    const L = await launch({ creator: bob, coinIs0, buy, symbol: 'BUY' });
    const got = await bal(L.payerCoin);
    // 1 SOL into a curve holding $3,000 of coins buys ~1/(cap+1) of them
    const capSol = Number(L.cap) / 1e9;
    const want = Number(SUPPLY) / (capSol + 1);
    assert.ok(Math.abs(Number(got) / want - 1) < 0.013, `got ${got} want ${want}`);
    const quoteVault = coinIs0 ? L.vault1 : L.vault0;
    const pooled = await bal(quoteVault);
    assert.ok(pooled <= buy + 2n && pooled >= buy - 2n, `pooled ${pooled}`);
    const spent = (solBefore - (await cx.getBalance(bob.publicKey))) / 1e9;
    console.log(`  launch cost with 1 SOL buy (coin token ${coinIs0 ? 0 : 1}): ${spent.toFixed(4)} SOL, tx ${L.size} bytes`);
  }
});

test('trades pay the pool fee in SOL; claim_fees splits it', async () => {
  const L = launched.sol1;
  const coins = await swap(bob, L, true, 2_000_000_000); // buy 2 SOL
  assert.ok(coins > 0n);
  const back = await swap(bob, L, false, coins / 2n); // sell half
  assert.ok(back > 0n);
  // no coin-side fees: everything is in SOL
  const claim = ix('claim_fees', claimKeys(alice.publicKey, L, feeRecipient.publicKey));
  const creatorWsol = ata(alice.publicKey, NATIVE_MINT, TOKEN_PROGRAM_ID);
  const before = await bal(creatorWsol);
  await send([claim], [alice]);
  const toCreator = (await bal(creatorWsol)) - before;
  const toPlatform = await bal(ata(feeRecipient.publicKey, NATIVE_MINT, TOKEN_PROGRAM_ID));
  const total = toCreator + toPlatform;
  // 1% of (2 SOL + the half sold back) less Raydium's 16%
  const volume = 2_000_000_000n + back * 100n / 99n;
  const want = (volume * 84n) / 10_000n;
  assert.ok(Number(total) / Number(want) > 0.98 && Number(total) / Number(want) < 1.02, `total ${total} want ${want}`);
  assert.equal(toPlatform, (total * 2381n) / 10_000n);
  assert.equal(await bal(ata(L.coin, L.mint, TOKEN_2022_PROGRAM_ID)), 0n);
  // a second claim with nothing new pays nothing
  await send([ix('claim_fees', claimKeys(bob.publicKey, L, feeRecipient.publicKey))], [bob]);
  assert.equal(await bal(creatorWsol), before + toCreator);
  // wrong fee recipient or creator
  await expectFail(send([ix('claim_fees', claimKeys(bob.publicKey, L, bob.publicKey))], [bob]), /BadFeeRecipient/);
  await expectFail(send([ix('claim_fees', claimKeys(bob.publicKey, { ...L, creatorKey: bob.publicKey }, feeRecipient.publicKey))], [bob]), /BadCreator/);
});

test('sells stop at the opening price: the pool never pays out more SOL than came in', async () => {
  const L = launched.sol0;
  const coins = await swap(bob, L, true, 500_000_000);
  const vaultSol = await bal(L.vault1);
  const back = await swap(bob, L, false, coins);
  assert.ok(back < 500_000_000n && back <= vaultSol);
  const ps = await poolState(L.pool);
  assert.ok(ps.sqrt >= sqrtAt(L.lo) - 1n || ps.liquidity === 0n);
});

test('set_creator moves the creator share', async () => {
  const L = launched.sol1;
  await expectFail(send([ix('set_creator', [r(bob.publicKey, true), w(L.coin)], bob.publicKey.toBuffer())], [bob]), /BadCreator/);
  await send([ix('set_creator', [r(alice.publicKey, true), w(L.coin)], bob.publicKey.toBuffer())], [alice]);
  await swap(alice, L, true, 1_000_000_000);
  const bobWsol = ata(bob.publicKey, NATIVE_MINT, TOKEN_PROGRAM_ID);
  const before = await bal(bobWsol);
  await send([ix('claim_fees', claimKeys(alice.publicKey, { ...L, creatorKey: bob.publicKey }, feeRecipient.publicKey))], [alice]);
  assert.ok((await bal(bobWsol)) > before);
  await send([ix('set_creator', [r(bob.publicKey, true), w(L.coin)], alice.publicKey.toBuffer())], [bob]);
});

test('admin collect removes liquidity and leaves earned fees for the creator', async () => {
  const L = launched.sol1;
  await swap(bob, L, true, 1_000_000_000);
  const adminCoin = ata(admin.publicKey, L.mint, TOKEN_2022_PROGRAM_ID);
  const adminWsol = ata(admin.publicKey, NATIVE_MINT, TOKEN_PROGRAM_ID);
  const coinCoin = ata(L.coin, L.mint, TOKEN_2022_PROGRAM_ID), coinWsol = ata(L.coin, NATIVE_MINT, TOKEN_PROGRAM_ID);
  await send([
    createAssociatedTokenAccountIdempotentInstruction(admin.publicKey, adminCoin, admin.publicKey, L.mint, TOKEN_2022_PROGRAM_ID),
    createAssociatedTokenAccountIdempotentInstruction(admin.publicKey, adminWsol, admin.publicKey, NATIVE_MINT, TOKEN_PROGRAM_ID),
  ], [admin]);
  const keys = (who) => [
    r(who.publicKey, true), r(CONFIG), w(L.coin), r(L.mint), r(NATIVE_MINT), w(coinCoin), w(coinWsol), w(adminCoin), w(adminWsol),
    w(L.pool), w(L.position), r(L.nftAccount), w(L.vault0), w(L.vault1), w(L.tickLower), w(L.tickUpper), w(L.protocolPosition),
    r(CLMM), r(TOKEN_PROGRAM_ID), r(TOKEN_2022_PROGRAM_ID), r(MEMO),
  ];
  await expectFail(send([ix('collect', keys(alice), u16(5000))], [alice]), /NotAdmin/);
  await expectFail(send([ix('collect', keys(admin), u16(0))], [admin]), /BadBps/);
  const liq = rdU128((await cx.getAccountInfo(L.position)).data, 81);
  await send([ix('collect', keys(admin), u16(5000))], [admin]);
  assert.equal(rdU128((await cx.getAccountInfo(L.position)).data, 81), liq - liq / 2n);
  assert.ok((await bal(adminCoin)) > 0n);
  assert.ok((await bal(adminWsol)) > 0n);
  // the buy's fee went to the coin's own account, not the admin's
  const fees = await bal(coinWsol);
  assert.ok(fees > 0n, 'fees kept for the creator');
  const before = await bal(ata(alice.publicKey, NATIVE_MINT, TOKEN_PROGRAM_ID));
  await send([ix('claim_fees', claimKeys(alice.publicKey, L, feeRecipient.publicKey))], [alice]);
  const toCreator = (await bal(ata(alice.publicKey, NATIVE_MINT, TOKEN_PROGRAM_ID))) - before;
  assert.equal(toCreator, fees - (fees * 2381n) / 10_000n);
});

test('a 0.25% fee tier gives the platform 0.2% of volume; tiers below 0.25% are refused', async () => {
  const L = await launch({ creator: alice, cfg: FEE_025, spacing: 60, symbol: 'LOW' });
  assert.equal((await cx.getAccountInfo(L.coin)).data.readUInt16LE(245), 9524);
  await expectFail(launch({ creator: alice, cfg: FEE_001, spacing: 1, symbol: 'BAD' }), /BadFeeTier/);
});

test('launches are refused on a wrong tick, a stale or wrong price, or a pair not on the list', async () => {
  await expectFail(launch({ creator: alice, tickShift: 120 }), /BadTick/);
  await expectFail(launch({ creator: alice, tickShift: -120 }), /BadTick/);
  await expectFail(launch({ creator: alice, price: PYTH_STALE }), /StalePrice/);
  await expectFail(launch({ creator: alice, price: PYTH_SPYX }), /BadPrice/);
  await expectFail(launch({ creator: alice, name: '' }), /BadMetadata/);
  await expectFail(launch({ creator: alice, symbol: 'TOOLONGSYMBOL' }), /BadMetadata/);
  // an unlisted pair: a fresh Token-2022 mint would do, but the cloned 1% config with another quote is enough
  await expectFail(launch({ creator: alice, quote: TOKEN_2022_PROGRAM_ID }), /BadPair|BadAccount/);
});

test('launch on SPYx with a launch buy; fees come in SPYx', async () => {
  const buy = 1n * 10n ** 8n; // 1 SPYx
  const before = await bal(SPYX_HOLDER);
  const L = await launch({ creator: wallet, quote: SPYX, price: PYTH_SPYX, buy, payerQuote: SPYX_HOLDER, symbol: 'SPY' });
  const spent = before - (await bal(SPYX_HOLDER));
  assert.ok(spent <= buy + 2n && spent >= buy - 2n, `spent ${spent}`);
  // $3,000 of SPYx at ~$765 is ~3.9 SPYx; 1 SPYx buys ~1/4.9 of the coins
  const capSpyx = Number(L.cap) / 1e8;
  const got = Number(await bal(L.payerCoin));
  const want = Number(SUPPLY) / (capSpyx + 1);
  assert.ok(Math.abs(got / want - 1) < 0.013, `got ${got} want ${want}`);
  // a sell pays its fee in SPYx; claim splits it
  await swap(wallet, L, false, (await bal(L.payerCoin)) / 2n);
  await send([ix('claim_fees', claimKeys(wallet.publicKey, L, feeRecipient.publicKey))], [wallet]);
  assert.ok((await bal(ata(feeRecipient.publicKey, SPYX, TOKEN_2022_PROGRAM_ID))) > 0n);
});
