// Equo on Solana, end to end against a local validator that runs the real
// Meteora DAMM v2 program (cloned from mainnet). Start it with
//   solana-test-validator --reset --url https://api.mainnet-beta.solana.com \
//     --clone-upgradeable-program cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG \
//     --upgradeable-program <program id> target/deploy/equo_sol.so <wallet pubkey>
// then run `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import {
  Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction,
  ComputeBudgetProgram, LAMPORTS_PER_SOL, sendAndConfirmTransaction,
} from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, NATIVE_MINT,
  getAssociatedTokenAddressSync, createAssociatedTokenAccountIdempotentInstruction,
  createSyncNativeInstruction, getMint, getAccount, getTokenMetadata,
} from '@solana/spl-token';

const RPC = process.env.RPC || 'http://127.0.0.1:8899';
const cx = new Connection(RPC, 'confirmed');
const PROGRAM = new PublicKey(process.env.EQUO_SOL || '6mdh7toDGpPEk8CYokVLi2aQMLDnB9jVkzhP5n9Dt4wR');
const DAMM = new PublicKey('cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG');
const BPF_UPGRADEABLE = new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111');
const TOTAL = 1_000_000_000n * 1_000_000n;

const wallet = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(`${homedir()}/.config/solana/id.json`, 'utf8'))));

// ---- encoding ----------------------------------------------------------
const disc = (name, ns = 'global') => createHash('sha256').update(`${ns}:${name}`).digest().subarray(0, 8);
const u8 = (v) => Buffer.from([v]);
const u16 = (v) => { const b = Buffer.alloc(2); b.writeUInt16LE(v); return b; };
const u32 = (v) => { const b = Buffer.alloc(4); b.writeUInt32LE(v); return b; };
const u64 = (v) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(v)); return b; };
const bool = (v) => u8(v ? 1 : 0);
const str = (s) => { const d = Buffer.from(s, 'utf8'); return Buffer.concat([u32(d.length), d]); };
const vecU64 = (a) => Buffer.concat([u32(a.length), ...a.map(u64)]);
const pk = (p) => p.toBuffer();
const ix = (name, keys, ...args) => new TransactionInstruction({ programId: PROGRAM, keys, data: Buffer.concat([disc(name), ...args]) });
const w = (pubkey, isSigner = false) => ({ pubkey, isSigner, isWritable: true });
const r = (pubkey, isSigner = false) => ({ pubkey, isSigner, isWritable: false });

const pda = (seeds, prog = PROGRAM) => PublicKey.findProgramAddressSync(seeds, prog)[0];
const CONFIG = pda([Buffer.from('config')]);
const coinPda = (mint) => pda([Buffer.from('coin'), mint.toBuffer()]);
const POOL_AUTH = pda([Buffer.from('pool_authority')], DAMM);
const DAMM_EVENTS = pda([Buffer.from('__event_authority')], DAMM);
const poolOf = (a, b) => {
  const [hi, lo] = Buffer.compare(a.toBuffer(), b.toBuffer()) > 0 ? [a, b] : [b, a];
  return pda([Buffer.from('cpool'), hi.toBuffer(), lo.toBuffer()], DAMM);
};
const vaultOf = (mint, pool) => pda([Buffer.from('token_vault'), mint.toBuffer(), pool.toBuffer()], DAMM);
const ata = (owner, mint, prog) => getAssociatedTokenAddressSync(mint, owner, true, prog);

async function send(ixs, signers, cu = 600_000) {
  const tx = new Transaction().add(ComputeBudgetProgram.setComputeUnitLimit({ units: cu }), ...ixs);
  return sendAndConfirmTransaction(cx, tx, signers, { commitment: 'confirmed' });
}
async function expectFail(p, re) {
  try { await p; } catch (e) {
    const logs = (e.logs || e.transactionLogs || []).join('\n') + String(e.message);
    if (re) assert.match(logs, re);
    return;
  }
  assert.fail('expected the transaction to fail');
}
async function fund(kp, sol = 20) {
  const sig = await cx.requestAirdrop(kp.publicKey, sol * LAMPORTS_PER_SOL);
  await cx.confirmTransaction(sig, 'confirmed');
}
const wrapIxs = (owner, lamports) => {
  const a = ata(owner, NATIVE_MINT, TOKEN_PROGRAM_ID);
  return [
    createAssociatedTokenAccountIdempotentInstruction(owner, a, owner, NATIVE_MINT, TOKEN_PROGRAM_ID),
    SystemProgram.transfer({ fromPubkey: owner, toPubkey: a, lamports: BigInt(lamports) }),
    createSyncNativeInstruction(a, TOKEN_PROGRAM_ID),
  ];
};
const bal = async (a) => { try { return (await getAccount(cx, a.addr, 'confirmed', a.prog)).amount; } catch { return 0n; } };

// ---- program calls -----------------------------------------------------
const admin = Keypair.generate();
const feeRecipient = Keypair.generate();
const updater = Keypair.generate();
const PRESETS = [5_000e8, 12_500e8, 25_000e8];

function launchIx(payer, mint, nft, a) {
  const pool = poolOf(mint.publicKey, NATIVE_MINT);
  const data = Buffer.concat([
    str(a.name), str(a.symbol), str(a.uri), u16(a.fee_bps), u16(a.snipe_bps), u32(a.snipe_secs),
    u8(a.split), u8(a.cap_preset), u64(a.first_buy),
  ]);
  return ix('launch', [
    w(payer.publicKey, true), w(CONFIG), w(a.feeRecipient || feeRecipient.publicKey),
    w(mint.publicKey, true), w(coinPda(mint.publicKey)),
    w(ata(payer.publicKey, mint.publicKey, TOKEN_2022_PROGRAM_ID)),
    w(ata(payer.publicKey, NATIVE_MINT, TOKEN_PROGRAM_ID)), r(NATIVE_MINT),
    w(nft.publicKey, true), w(pda([Buffer.from('position_nft_account'), nft.publicKey.toBuffer()], DAMM)),
    w(pool), w(pda([Buffer.from('position'), nft.publicKey.toBuffer()], DAMM)),
    w(vaultOf(mint.publicKey, pool)), w(vaultOf(NATIVE_MINT, pool)),
    r(POOL_AUTH), r(DAMM_EVENTS), r(DAMM),
    r(TOKEN_2022_PROGRAM_ID), r(TOKEN_PROGRAM_ID), r(ASSOCIATED_TOKEN_PROGRAM_ID), r(SystemProgram.programId),
  ], data);
}

async function launch(payer, a = {}) {
  const args = { name: 'Equo Test', symbol: 'EQT', uri: 'https://equo.fun/m/eqt.json', fee_bps: 100, snipe_bps: 0, snipe_secs: 0, split: 1, cap_preset: 0, first_buy: LAMPORTS_PER_SOL / 10, ...a };
  const mint = Keypair.generate();
  const nft = Keypair.generate();
  const sig = await send([...wrapIxs(payer.publicKey, Math.max(Number(args.first_buy), 1)), launchIx(payer, mint, nft, args)], [payer, mint, nft], 1_000_000);
  if (process.env.SHOW_COST) {
    const t = await cx.getTransaction(sig, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
    console.log(`launch: ${t.meta.computeUnitsConsumed} CU, ${t.transaction.message.serialize().length + 64 * 3 + 1} bytes, fee+rent ${(t.meta.preBalances[0] - t.meta.postBalances[0] - Number(args.first_buy)) / 1e9} SOL`);
  }
  return coinState(mint.publicKey);
}

async function coinState(mint) {
  const coin = coinPda(mint);
  const d = (await cx.getAccountInfo(coin, 'confirmed')).data;
  let o = 8;
  const key = () => { const k = new PublicKey(d.subarray(o, o + 32)); o += 32; return k; };
  const s = { mint: key(), creator: key(), pool: key(), position: key(), positionNftAccount: key() };
  s.fee_bps = d.readUInt16LE(o); o += 2;
  s.snipe_bps = d.readUInt16LE(o); o += 2;
  s.snipe_secs = d.readUInt32LE(o); o += 4;
  s.split = d[o]; o += 1;
  s.cap_usd8 = d.readBigUInt64LE(o); o += 8;
  s.created_at = d.readBigInt64LE(o); o += 8;
  s.creator_fees = d.readBigUInt64LE(o); o += 8;
  s.platform_fees = d.readBigUInt64LE(o); o += 8;
  s.coin = coin;
  return s;
}

function claimIx(payer, s) {
  return ix('claim_fees', [
    w(payer.publicKey, true), r(CONFIG), w(s.coin), r(s.mint), r(NATIVE_MINT),
    w(ata(s.coin, s.mint, TOKEN_2022_PROGRAM_ID)), w(ata(s.coin, NATIVE_MINT, TOKEN_PROGRAM_ID)),
    r(s.creator), w(ata(s.creator, NATIVE_MINT, TOKEN_PROGRAM_ID)),
    r(feeRecipient.publicKey), w(ata(feeRecipient.publicKey, NATIVE_MINT, TOKEN_PROGRAM_ID)),
    r(s.pool), w(s.position), r(s.positionNftAccount),
    w(vaultOf(s.mint, s.pool)), w(vaultOf(NATIVE_MINT, s.pool)),
    r(POOL_AUTH), r(DAMM_EVENTS), r(DAMM),
    r(TOKEN_2022_PROGRAM_ID), r(TOKEN_PROGRAM_ID), r(ASSOCIATED_TOKEN_PROGRAM_ID), r(SystemProgram.programId),
  ]);
}

function collectIx(signer, s, toCoin, toWsol, bps) {
  return ix('collect', [
    r(signer.publicKey, true), r(CONFIG), r(s.coin), r(s.mint), r(NATIVE_MINT), w(toCoin), w(toWsol),
    w(s.pool), w(s.position), r(s.positionNftAccount),
    w(vaultOf(s.mint, s.pool)), w(vaultOf(NATIVE_MINT, s.pool)),
    r(POOL_AUTH), r(DAMM_EVENTS), r(DAMM), r(TOKEN_2022_PROGRAM_ID), r(TOKEN_PROGRAM_ID),
  ], u16(bps));
}

// DAMM v2 swap2 (ExactIn), straight against the pool
function swapIx(trader, s, buy, amountIn, minOut = 0) {
  const coinAcct = ata(trader.publicKey, s.mint, TOKEN_2022_PROGRAM_ID);
  const solAcct = ata(trader.publicKey, NATIVE_MINT, TOKEN_PROGRAM_ID);
  return new TransactionInstruction({
    programId: DAMM,
    keys: [
      r(POOL_AUTH), w(s.pool), w(buy ? solAcct : coinAcct), w(buy ? coinAcct : solAcct),
      w(vaultOf(s.mint, s.pool)), w(vaultOf(NATIVE_MINT, s.pool)), r(s.mint), r(NATIVE_MINT),
      r(trader.publicKey, true), r(TOKEN_2022_PROGRAM_ID), r(TOKEN_PROGRAM_ID), r(DAMM), r(DAMM_EVENTS), r(DAMM),
    ],
    data: Buffer.concat([disc('swap2'), u64(amountIn), u64(minOut), u8(0)]),
  });
}
async function buy(trader, s, lamports) {
  await send([
    createAssociatedTokenAccountIdempotentInstruction(trader.publicKey, ata(trader.publicKey, s.mint, TOKEN_2022_PROGRAM_ID), trader.publicKey, s.mint, TOKEN_2022_PROGRAM_ID),
    ...wrapIxs(trader.publicKey, lamports), swapIx(trader, s, true, lamports),
  ], [trader]);
}
async function sell(trader, s, coins) {
  await send([
    createAssociatedTokenAccountIdempotentInstruction(trader.publicKey, ata(trader.publicKey, NATIVE_MINT, TOKEN_PROGRAM_ID), trader.publicKey, NATIVE_MINT, TOKEN_PROGRAM_ID),
    swapIx(trader, s, false, coins),
  ], [trader]);
}
const coinsOf = (owner, mint) => bal({ addr: ata(owner, mint, TOKEN_2022_PROGRAM_ID), prog: TOKEN_2022_PROGRAM_ID });
const wsolOf = (owner) => bal({ addr: ata(owner, NATIVE_MINT, TOKEN_PROGRAM_ID), prog: TOKEN_PROGRAM_ID });

// ---- tests -------------------------------------------------------------
const creator = Keypair.generate();
const trader = Keypair.generate();
const stranger = Keypair.generate();
const SOL_USD8 = 150e8;

test('setup: only the upgrade authority can initialize', async () => {
  for (const k of [admin, creator, trader, stranger, updater]) await fund(k);
  const programData = pda([PROGRAM.toBuffer()], BPF_UPGRADEABLE);
  const init = (signer) => ix('initialize', [w(signer.publicKey, true), w(CONFIG), r(PROGRAM), r(programData), r(SystemProgram.programId)],
    pk(admin.publicKey), pk(feeRecipient.publicKey), pk(updater.publicKey), u64(LAMPORTS_PER_SOL / 100), u64(0), u32(3600), vecU64(PRESETS));
  await expectFail(send([init(stranger)], [stranger]), /NotUpgradeAuthority/);
  await send([init(wallet)], [wallet]);
  await expectFail(send([init(wallet)], [wallet]));
});

test('launch needs a fresh SOL price, and only the updater or admin sets it', async () => {
  await expectFail(launch(creator), /StalePrice/);
  await expectFail(send([ix('set_sol_price', [r(stranger.publicKey, true), w(CONFIG)], u64(SOL_USD8))], [stranger]), /NotPriceUpdater/);
  await send([ix('set_sol_price', [r(updater.publicKey, true), w(CONFIG)], u64(SOL_USD8))], [updater]);
});

let s1;
test('launch: Token-2022 coin with no mint/freeze authority, immutable metadata, pool owned by the coin PDA', async () => {
  const before = await cx.getBalance(feeRecipient.publicKey);
  s1 = await launch(creator, { first_buy: LAMPORTS_PER_SOL });
  const mint = await getMint(cx, s1.mint, 'confirmed', TOKEN_2022_PROGRAM_ID);
  assert.equal(mint.mintAuthority, null);
  assert.equal(mint.freezeAuthority, null);
  assert.equal(mint.decimals, 6);
  assert.equal(mint.supply, TOTAL);
  const md = await getTokenMetadata(cx, s1.mint, 'confirmed', TOKEN_2022_PROGRAM_ID);
  assert.equal(md.name, 'Equo Test');
  assert.equal(md.symbol, 'EQT');
  assert.equal(md.updateAuthority, undefined);
  assert.equal(s1.creator.toBase58(), creator.publicKey.toBase58());
  // the position NFT sits with the coin PDA
  const nft = await getAccount(cx, s1.positionNftAccount, 'confirmed', TOKEN_2022_PROGRAM_ID);
  assert.equal(nft.owner.toBase58(), s1.coin.toBase58());
  assert.equal(nft.amount, 1n);
  assert.equal(await cx.getBalance(feeRecipient.publicKey), before); // no launch fee set
});

test('first buy: priced on the curve, fee free, SOL lands in the pool', async () => {
  // $5,000 cap at $150/SOL = 33.33 SOL for 1B coins; 1 SOL buys 1B / (1 + 33.33) of them
  const got = await coinsOf(creator.publicKey, s1.mint);
  const capSol = 5_000 / 150;
  const want = Number(TOTAL) / (1 + capSol);
  assert.ok(Math.abs(Number(got) - want) / want < 1e-6, `got ${got}, want ${want}`);
  const solVault = await bal({ addr: vaultOf(NATIVE_MINT, s1.pool), prog: TOKEN_PROGRAM_ID });
  assert.ok(solVault <= BigInt(LAMPORTS_PER_SOL) && BigInt(LAMPORTS_PER_SOL) - solVault <= 1n, `vault ${solVault}`);
});

test('first buy below the minimum is refused', async () => {
  await expectFail(launch(creator, { first_buy: 1000 }), /FirstBuyTooSmall/);
});

test('launch parameter caps', async () => {
  await expectFail(launch(creator, { fee_bps: 5 }), /BadFee/);
  await expectFail(launch(creator, { fee_bps: 301 }), /BadFee/);
  await expectFail(launch(creator, { snipe_bps: 3001, snipe_secs: 60 }), /BadSnipe/);
  await expectFail(launch(creator, { snipe_bps: 2000, snipe_secs: 0 }), /BadSnipe/);
  await expectFail(launch(creator, { snipe_bps: 2000, snipe_secs: 86_401 }), /BadSnipe/);
  await expectFail(launch(creator, { split: 0 }), /BadSplit/);
  await expectFail(launch(creator, { split: 21 }), /BadSplit/);
  await expectFail(launch(creator, { cap_preset: 3 }), /BadPreset/);
  await expectFail(launch(creator, { feeRecipient: stranger.publicKey }), /BadFeeRecipient/);
});

test('trading fees are SOL only and split 70/30 by anyone', async () => {
  await buy(trader, s1, 2 * LAMPORTS_PER_SOL);
  const coins = await coinsOf(trader.publicKey, s1.mint);
  await sell(trader, s1, coins / 2n);
  const cBefore = await wsolOf(creator.publicKey);
  const pBefore = await wsolOf(feeRecipient.publicKey);
  await send([claimIx(stranger, s1)], [stranger]);
  const toCreator = (await wsolOf(creator.publicKey)) - cBefore;
  const toPlatform = (await wsolOf(feeRecipient.publicKey)) - pBefore;
  const total = toCreator + toPlatform;
  assert.ok(total > 0n, 'fees claimed');
  assert.equal(toCreator, total * 7000n / 10000n);
  // the coin PDA keeps nothing and earned no coin-side fees
  assert.equal(await wsolOf(s1.coin), 0n);
  assert.equal(await coinsOf(s1.coin, s1.mint), 0n);
  // ~1% of ~3 SOL volume, less Meteora's 20% protocol share
  const s = await coinState(s1.mint);
  assert.equal(s.creator_fees, toCreator);
  assert.equal(s.platform_fees, toPlatform);
  // a second claim with nothing new pays nothing
  await send([claimIx(stranger, s1)], [stranger]);
  assert.equal((await coinState(s1.mint)).creator_fees, toCreator);
});

test('creator can hand off the creator share; nobody else can', async () => {
  const next = Keypair.generate();
  const setCreator = (signer, to) => ix('set_creator', [r(signer.publicKey, true), w(s1.coin)], pk(to));
  await expectFail(send([setCreator(stranger, stranger.publicKey)], [stranger]), /BadCreator/);
  await send([setCreator(creator, next.publicKey)], [creator]);
  assert.equal((await coinState(s1.mint)).creator.toBase58(), next.publicKey.toBase58());
  await send([setCreator(next, creator.publicKey)], [next]).catch(async () => {
    await fund(next, 1);
    await send([setCreator(next, creator.publicKey)], [next]);
  });
  s1 = await coinState(s1.mint);
});

test('collect: admin only, removes the asked share of liquidity', async () => {
  const toCoin = ata(admin.publicKey, s1.mint, TOKEN_2022_PROGRAM_ID);
  const toWsol = ata(admin.publicKey, NATIVE_MINT, TOKEN_PROGRAM_ID);
  await send([
    createAssociatedTokenAccountIdempotentInstruction(admin.publicKey, toCoin, admin.publicKey, s1.mint, TOKEN_2022_PROGRAM_ID),
    createAssociatedTokenAccountIdempotentInstruction(admin.publicKey, toWsol, admin.publicKey, NATIVE_MINT, TOKEN_PROGRAM_ID),
  ], [admin]);
  await expectFail(send([collectIx(stranger, s1, toCoin, toWsol, 10_000)], [stranger]), /NotAdmin/);
  await expectFail(send([collectIx(admin, s1, toCoin, toWsol, 0)], [admin]), /BadBps/);
  await expectFail(send([collectIx(admin, s1, toCoin, toWsol, 10_001)], [admin]), /BadBps/);

  const vaultSol = await bal({ addr: vaultOf(NATIVE_MINT, s1.pool), prog: TOKEN_PROGRAM_ID });
  await send([collectIx(admin, s1, toCoin, toWsol, 2_500)], [admin]);
  const gotSol = await wsolOf(admin.publicKey);
  assert.ok(gotSol > 0n && gotSol <= vaultSol / 4n + 1n, `quarter of the SOL: ${gotSol} of ${vaultSol}`);
  assert.ok((await coinsOf(admin.publicKey, s1.mint)) > 0n);

  // trading still works on what is left, and fees still split
  await buy(trader, s1, LAMPORTS_PER_SOL / 10);
  await send([collectIx(admin, s1, toCoin, toWsol, 10_000)], [admin]);
  await expectFail(send([collectIx(admin, s1, toCoin, toWsol, 10_000)], [admin]), /NothingToCollect/);
  const before = await wsolOf(creator.publicKey);
  await send([claimIx(stranger, s1)], [stranger]);
  assert.ok((await wsolOf(creator.publicKey)) > before, 'fees earned before the full collect are still paid');
});

test('split launch: the pool gets 1B / split, priced for the 1B total', async () => {
  const s = await launch(creator, { split: 4, first_buy: LAMPORTS_PER_SOL / 100, cap_preset: 1 });
  const mint = await getMint(cx, s.mint, 'confirmed', TOKEN_2022_PROGRAM_ID);
  assert.equal(mint.supply, TOTAL / 4n);
  assert.equal(s.cap_usd8, BigInt(PRESETS[1]));
});

test('anti-snipe: buys right after launch pay the starting fee', async () => {
  const plain = await launch(creator);
  const sniped = await launch(creator, { snipe_bps: 2_000, snipe_secs: 30 });
  const a = Keypair.generate(); const b = Keypair.generate();
  await fund(a); await fund(b);
  await buy(a, plain, LAMPORTS_PER_SOL);
  await buy(b, sniped, LAMPORTS_PER_SOL);
  const got = Number(await coinsOf(b.publicKey, sniped.mint)) / Number(await coinsOf(a.publicKey, plain.mint));
  // ~20% fee instead of 1% on the SOL in, so ~0.8 / 0.99 of the coins (a bit more: less price impact)
  assert.ok(got > 0.78 && got < 0.86, `ratio ${got}`);
});

test('admin settings are admin only', async () => {
  const setPaused = (signer, p) => ix('set_paused', [r(signer.publicKey, true), w(CONFIG)], bool(p));
  await expectFail(send([setPaused(stranger, true)], [stranger]), /NotAdmin/);
  await send([setPaused(admin, true)], [admin]);
  await expectFail(launch(creator), /Paused/);
  await send([setPaused(admin, false)], [admin]);
  await expectFail(send([ix('set_cap_presets', [r(admin.publicKey, true), w(CONFIG)], vecU64([]))], [admin]), /BadPreset/);
  await send([ix('set_launch_terms', [r(admin.publicKey, true), w(CONFIG)], u64(LAMPORTS_PER_SOL / 100), u64(LAMPORTS_PER_SOL / 50), u32(3600))], [admin]);
  const before = await cx.getBalance(feeRecipient.publicKey);
  await launch(creator);
  assert.equal(await cx.getBalance(feeRecipient.publicKey) - before, LAMPORTS_PER_SOL / 50);
});

test('wrong accounts are refused', async () => {
  const other = await launch(creator);
  const fake = Keypair.generate().publicKey;
  // launch through a fake DAMM program, or with someone else's WSOL account
  {
    const mint = Keypair.generate(); const nft = Keypair.generate();
    const args = { name: 'X', symbol: 'X', uri: '', fee_bps: 100, snipe_bps: 0, snipe_secs: 0, split: 1, cap_preset: 0, first_buy: LAMPORTS_PER_SOL / 10 };
    const bad = launchIx(creator, mint, nft, args);
    bad.keys[16] = r(fake);
    await expectFail(send([...wrapIxs(creator.publicKey, args.first_buy), bad], [creator, mint, nft], 1_000_000), /BadAccount/);
    const theirs = launchIx(creator, mint, nft, args);
    theirs.keys[6] = w(ata(trader.publicKey, NATIVE_MINT, TOKEN_PROGRAM_ID));
    await expectFail(send([theirs], [creator, mint, nft], 1_000_000), /BadAccount/);
  }
  // claim: another coin's pool, or fees routed to someone who is not the creator
  {
    const crossed = claimIx(stranger, s1);
    crossed.keys[11] = r(other.pool);
    await expectFail(send([crossed], [stranger]), /BadPool/);
    const thief = claimIx(stranger, s1);
    thief.keys[7] = r(stranger.publicKey);
    thief.keys[8] = w(ata(stranger.publicKey, NATIVE_MINT, TOKEN_PROGRAM_ID));
    await expectFail(send([thief], [stranger]), /BadCreator/);
    const platform = claimIx(stranger, s1);
    platform.keys[9] = r(stranger.publicKey);
    platform.keys[10] = w(ata(stranger.publicKey, NATIVE_MINT, TOKEN_PROGRAM_ID));
    await expectFail(send([platform], [stranger]), /BadFeeRecipient/);
  }
  // collect into an account of the wrong mint
  {
    const toWsol = ata(admin.publicKey, NATIVE_MINT, TOKEN_PROGRAM_ID);
    const wrongCoin = ata(admin.publicKey, other.mint, TOKEN_2022_PROGRAM_ID);
    await send([createAssociatedTokenAccountIdempotentInstruction(admin.publicKey, wrongCoin, admin.publicKey, other.mint, TOKEN_2022_PROGRAM_ID)], [admin]);
    const st = await coinState(other.mint);
    const bad = collectIx(admin, st, ata(admin.publicKey, s1.mint, TOKEN_2022_PROGRAM_ID), toWsol, 100);
    await expectFail(send([bad], [admin]), /BadAccount/);
  }
  // set_creator on an account that is not a coin
  await expectFail(send([ix('set_creator', [r(creator.publicKey, true), w(CONFIG)], pk(creator.publicKey))], [creator]), /BadAccount/);
});
