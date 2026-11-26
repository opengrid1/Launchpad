// Equo v3 on Solana (the Solana leg of a multichain launch), end to end against a local validator that runs the real Meteora DAMM v2 program (cloned
// from mainnet). Start it with
//   solana-test-validator --reset --url https://api.mainnet-beta.solana.com \
//     --clone-upgradeable-program cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG \
//     --upgradeable-program <program id> target/deploy/equo_sol.so <wallet pubkey>
// then run `node --test tests/omni.test.mjs`.
//
// The snapshot is signed with ethers exactly as the EVM factories expect it, so these tests also prove the
// program's keccak / secp256k1 checks agree with Solidity's EIP-712.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { createRequire } from 'node:module';
import {
  Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction,
  ComputeBudgetProgram, LAMPORTS_PER_SOL, sendAndConfirmTransaction,
} from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, NATIVE_MINT,
  getAssociatedTokenAddressSync, createAssociatedTokenAccountIdempotentInstruction,
  createSyncNativeInstruction, getMint, getAccount, getTokenMetadata,
} from '@solana/spl-token';

const { ethers } = createRequire(import.meta.url)('/home/user/Launchpad/node_modules/ethers');

const RPC = process.env.RPC || 'http://127.0.0.1:8899';
const cx = new Connection(RPC, 'confirmed');
const PROGRAM = new PublicKey(process.env.EQUO_SOL || '8tQmVEDRd4gBXP2brdgKxtmzXbTD3y8uEbY1erS1UFKq');
const DAMM = new PublicKey('cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG');
const OFT_PROGRAM = new PublicKey('RuyLPEWoYG2b6mGb6nvKotoNhW2F9KdhrjRghaRdGkz');
const BPF_UPGRADEABLE = new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111');
const CHAIN_SUPPLY = 1_000_000_000n * 1_000_000_000n; // 1B on every chain
const SOL_EID = 30168;

const wallet = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(`${homedir()}/.config/solana/id.json`, 'utf8'))));

// ---- encoding ----------------------------------------------------------
const disc = (name, ns = 'global') => createHash('sha256').update(`${ns}:${name}`).digest().subarray(0, 8);
const u8 = (v) => Buffer.from([v]);
const u16 = (v) => { const b = Buffer.alloc(2); b.writeUInt16LE(v); return b; };
const u32 = (v) => { const b = Buffer.alloc(4); b.writeUInt32LE(v); return b; };
const u64 = (v) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(v)); return b; };
const u128 = (v) => { const b = Buffer.alloc(16); b.writeBigUInt64LE(BigInt(v) & ((1n << 64n) - 1n)); b.writeBigUInt64LE(BigInt(v) >> 64n, 8); return b; };
const str = (s) => { const d = Buffer.from(s, 'utf8'); return Buffer.concat([u32(d.length), d]); };
const hex = (h) => Buffer.from(h.replace(/^0x/, ''), 'hex');
const pk = (p) => p.toBuffer();
const ix = (name, keys, ...args) => new TransactionInstruction({ programId: PROGRAM, keys, data: Buffer.concat([disc(name), ...args]) });
const w = (pubkey, isSigner = false) => ({ pubkey, isSigner, isWritable: true });
const r = (pubkey, isSigner = false) => ({ pubkey, isSigner, isWritable: false });

const pda = (seeds, prog = PROGRAM) => PublicKey.findProgramAddressSync(seeds, prog)[0];
const CONFIG = pda([Buffer.from('config2')]);
const coinPda = (mint) => pda([Buffer.from('coin2'), mint.toBuffer()]);
const markerPda = (id) => pda([Buffer.from('launch'), hex(id)]);
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
async function fund(kp, sol = 50) {
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
const bal = async (addr, prog) => { try { return (await getAccount(cx, addr, 'confirmed', prog)).amount; } catch { return 0n; } };
const coinsOf = (owner, mint) => bal(ata(owner, mint, TOKEN_2022_PROGRAM_ID), TOKEN_2022_PROGRAM_ID);
const wsolOf = (owner) => bal(ata(owner, NATIVE_MINT, TOKEN_PROGRAM_ID), TOKEN_PROGRAM_ID);

// ---- the snapshot, as the EVM factories take it -----------------------
const TYPES = {
  Snapshot: [
    { name: 'launchId', type: 'bytes32' }, { name: 'creator', type: 'address' }, { name: 'name', type: 'string' },
    { name: 'symbol', type: 'string' }, { name: 'metadataURI', type: 'string' }, { name: 'feeBps', type: 'uint16' },
    { name: 'deadline', type: 'uint64' }, { name: 'feeEid', type: 'uint32' }, { name: 'launchFeeUsd18', type: 'uint256' },
    { name: 'legs', type: 'Leg[]' },
  ],
  Leg: [
    { name: 'eid', type: 'uint32' }, { name: 'coin', type: 'bytes32' }, { name: 'legSalt', type: 'bytes32' }, { name: 'pair', type: 'bytes32' },
    { name: 'slice', type: 'uint256' }, { name: 'quoteUsd18', type: 'uint256' },
  ],
};
const DOMAIN = { name: 'Equo', version: '2' };
const attestor = ethers.Wallet.createRandom();
const SOL_USD18 = 150n * 10n ** 18n;

/** A four-leg snapshot (Ethereum, BNB, Solana, HyperEVM) whose Solana leg is this escrow's OFT store. */
async function snapshot(creatorSol, opts = {}) {
  const escrow = opts.escrow ?? Keypair.generate();
  const store = pda([Buffer.from('OFT'), escrow.publicKey.toBuffer()], OFT_PROGRAM);
  const solSlice = opts.solSlice ?? CHAIN_SUPPLY;
  const rest = CHAIN_SUPPLY;
  const evm = () => ethers.zeroPadValue(ethers.hexlify(ethers.randomBytes(20)), 32);
  const legs = [
    { eid: 30101, coin: evm(), legSalt: ethers.hexlify(ethers.randomBytes(32)), pair: ethers.ZeroHash, slice: rest, quoteUsd18: 3000n * 10n ** 18n },
    { eid: 30102, coin: evm(), legSalt: ethers.hexlify(ethers.randomBytes(32)), pair: ethers.ZeroHash, slice: rest, quoteUsd18: 700n * 10n ** 18n },
    { eid: SOL_EID, coin: ethers.hexlify(store.toBuffer()), legSalt: ethers.hexlify(creatorSol.toBuffer()), pair: ethers.ZeroHash, slice: solSlice, quoteUsd18: opts.quote ?? SOL_USD18 },
    { eid: 30367, coin: evm(), legSalt: ethers.hexlify(ethers.randomBytes(32)), pair: ethers.ZeroHash, slice: rest, quoteUsd18: 40n * 10n ** 18n },
  ];
  const now = (await cx.getBlockTime(await cx.getSlot('confirmed'))) ?? Math.floor(Date.now() / 1000);
  const snap = {
    launchId: ethers.hexlify(ethers.randomBytes(32)), creator: ethers.Wallet.createRandom().address,
    name: opts.name ?? 'Equo Nine', symbol: 'NINE', metadataURI: 'ipfs://equo', feeBps: opts.feeBps ?? 100,
    deadline: opts.deadline ?? now + 1800, feeEid: opts.feeEid ?? 30101, launchFeeUsd18: opts.launchFee ?? 0n, legs,
  };
  const sig = await (opts.signer ?? attestor).signTypedData(DOMAIN, TYPES, snap);
  return { snap, sig, escrow, store };
}

function postIx(payer, { snap, sig }) {
  const legs = snap.legs.map((l) => l.eid === SOL_EID
    ? Buffer.concat([u8(1), u32(l.eid), hex(l.coin), hex(l.legSalt), hex(l.pair), u64(l.slice), u128(l.quoteUsd18)])
    : Buffer.concat([u8(0), hex(ethers.TypedDataEncoder.from({ Leg: TYPES.Leg }).hashStruct('Leg', l))]));
  return ix('post_snapshot', [w(payer.publicKey, true), r(CONFIG), w(markerPda(snap.launchId)), r(SystemProgram.programId)],
    hex(snap.launchId), hex(snap.creator), str(snap.name), str(snap.symbol), str(snap.metadataURI), u16(snap.feeBps), u64(snap.deadline),
    u32(snap.feeEid), u128(snap.launchFeeUsd18), u32(legs.length), ...legs, hex(sig));
}

function launchIx(payer, mint, nft, s, creatorSol, firstBuy) {
  const pool = poolOf(mint.publicKey, NATIVE_MINT);
  return ix('launch', [
    w(payer.publicKey, true), w(CONFIG), w(mint.publicKey, true), w(coinPda(mint.publicKey)),
    w(ata(payer.publicKey, mint.publicKey, TOKEN_2022_PROGRAM_ID)), w(ata(payer.publicKey, NATIVE_MINT, TOKEN_PROGRAM_ID)), r(NATIVE_MINT),
    w(nft.publicKey, true), w(pda([Buffer.from('position_nft_account'), nft.publicKey.toBuffer()], DAMM)),
    w(pool), w(pda([Buffer.from('position'), nft.publicKey.toBuffer()], DAMM)),
    w(vaultOf(mint.publicKey, pool)), w(vaultOf(NATIVE_MINT, pool)), r(POOL_AUTH), r(DAMM_EVENTS), r(DAMM),
    r(TOKEN_2022_PROGRAM_ID), r(TOKEN_PROGRAM_ID), r(ASSOCIATED_TOKEN_PROGRAM_ID), r(SystemProgram.programId),
    w(markerPda(s.snap.launchId)), r(s.escrow.publicKey), r(creatorSol), w(ata(creatorSol, mint.publicKey, TOKEN_2022_PROGRAM_ID)),
    w(launcher.publicKey),
  ], u64(firstBuy));
}

async function launch(payer, creatorSol, opts = {}) {
  const s = opts.s ?? await snapshot(creatorSol, opts);
  if (!opts.s) await send([postIx(payer, s)], [payer]);
  const mint = Keypair.generate();
  const nft = Keypair.generate();
  const firstBuy = opts.firstBuy ?? LAMPORTS_PER_SOL / 10;
  await send(wrapIxs(payer.publicKey, Math.max(firstBuy, 1)), [payer]);
  await send([launchIx(payer, mint, nft, s, creatorSol, firstBuy)], [payer, mint, nft], 1_000_000);
  return { ...(await coinState(mint.publicKey)), s };
}

async function coinState(mint) {
  const coin = coinPda(mint);
  const d = (await cx.getAccountInfo(coin, 'confirmed')).data;
  let o = 8;
  const key = () => { const k = new PublicKey(d.subarray(o, o + 32)); o += 32; return k; };
  const s = { mint: key(), creator: key(), pool: key(), position: key(), positionNftAccount: key(), oftStore: key() };
  o += 32; // launch id
  s.fee_bps = d.readUInt16LE(o); o += 2;
  s.slice = d.readBigUInt64LE(o); o += 8;
  o += 16; o += 8;
  s.creator_fees = d.readBigUInt64LE(o); o += 8;
  s.platform_fees = d.readBigUInt64LE(o);
  s.coin = coin;
  return s;
}

function claimIx(payer, s) {
  return ix('claim_fees', [
    w(payer.publicKey, true), r(CONFIG), w(s.coin), r(s.mint), r(NATIVE_MINT),
    w(ata(s.coin, s.mint, TOKEN_2022_PROGRAM_ID)), w(ata(s.coin, NATIVE_MINT, TOKEN_PROGRAM_ID)),
    r(s.creator), w(ata(s.creator, NATIVE_MINT, TOKEN_PROGRAM_ID)),
    r(feeRecipient.publicKey), w(ata(feeRecipient.publicKey, NATIVE_MINT, TOKEN_PROGRAM_ID)),
    r(s.pool), w(s.position), r(s.positionNftAccount), w(vaultOf(s.mint, s.pool)), w(vaultOf(NATIVE_MINT, s.pool)),
    r(POOL_AUTH), r(DAMM_EVENTS), r(DAMM), r(TOKEN_2022_PROGRAM_ID), r(TOKEN_PROGRAM_ID), r(ASSOCIATED_TOKEN_PROGRAM_ID), r(SystemProgram.programId),
  ]);
}

function swapIx(trader, s, buy, amountIn) {
  const coinAcct = ata(trader.publicKey, s.mint, TOKEN_2022_PROGRAM_ID);
  const solAcct = ata(trader.publicKey, NATIVE_MINT, TOKEN_PROGRAM_ID);
  return new TransactionInstruction({
    programId: DAMM,
    keys: [
      r(POOL_AUTH), w(s.pool), w(buy ? solAcct : coinAcct), w(buy ? coinAcct : solAcct), w(vaultOf(s.mint, s.pool)), w(vaultOf(NATIVE_MINT, s.pool)),
      r(s.mint), r(NATIVE_MINT), r(trader.publicKey, true), r(TOKEN_2022_PROGRAM_ID), r(TOKEN_PROGRAM_ID), r(DAMM), r(DAMM_EVENTS), r(DAMM),
    ],
    data: Buffer.concat([disc('swap2'), u64(amountIn), u64(0), u8(0)]),
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

// ---- tests -------------------------------------------------------------
const admin = Keypair.generate();
const feeRecipient = Keypair.generate();
const launcher = Keypair.generate();
const creator = Keypair.generate();
const trader = Keypair.generate();
const stranger = Keypair.generate();

test('setup: only the upgrade authority can initialize', async () => {
  for (const k of [admin, launcher, creator, trader, stranger]) await fund(k);
  const programData = pda([PROGRAM.toBuffer()], BPF_UPGRADEABLE);
  const init = (signer) => ix('initialize', [w(signer.publicKey, true), w(CONFIG), r(PROGRAM), r(programData), r(SystemProgram.programId)],
    pk(admin.publicKey), pk(feeRecipient.publicKey), pk(launcher.publicKey), hex(attestor.address), u128(10n ** 18n), u128(10_000n * 10n ** 18n));
  await expectFail(send([init(stranger)], [stranger]), /NotUpgradeAuthority/);
  await send([init(wallet)], [wallet]);
  await expectFail(send([init(wallet)], [wallet]));
});

test('post_snapshot: the EVM signature checks out on Solana; wrong signer, stale, reused or outsider are refused', async () => {
  const good = await snapshot(creator.publicKey);
  await expectFail(send([postIx(stranger, good)], [stranger]), /NotAllowed/);
  const forged = await snapshot(creator.publicKey, { signer: ethers.Wallet.createRandom() });
  await expectFail(send([postIx(launcher, forged)], [launcher]), /BadSignature/);
  // a tampered field breaks the signature too
  const tampered = { ...good, snap: { ...good.snap, feeBps: 200 } };
  await expectFail(send([postIx(launcher, tampered)], [launcher]), /BadSignature/);
  const late = await snapshot(creator.publicKey, { deadline: Math.floor(Date.now() / 1000) + 7200 });
  await expectFail(send([postIx(launcher, late)], [launcher]), /Expired/);
  const cheap = await snapshot(creator.publicKey, { quote: 10n ** 17n });
  await expectFail(send([postIx(launcher, cheap)], [launcher]), /PriceOutOfBand/);
  await send([postIx(launcher, good)], [launcher]);
  await expectFail(send([postIx(launcher, good)], [launcher]), /AlreadyLaunched/);
});

let s1;
test('launch: 9-decimal coin, its slice, mint authority with the OFT store, no freeze, immutable metadata', async () => {
  s1 = await launch(launcher, creator.publicKey, { firstBuy: LAMPORTS_PER_SOL });
  const mint = await getMint(cx, s1.mint, 'confirmed', TOKEN_2022_PROGRAM_ID);
  assert.equal(mint.decimals, 9);
  assert.equal(mint.supply, s1.s.snap.legs[2].slice);
  assert.equal(mint.mintAuthority.toBase58(), s1.s.store.toBase58());
  assert.equal(mint.freezeAuthority, null);
  const md = await getTokenMetadata(cx, s1.mint, 'confirmed', TOKEN_2022_PROGRAM_ID);
  assert.equal(md.name, 'Equo Nine');
  assert.equal(md.updateAuthority, undefined);
  assert.equal(s1.creator.toBase58(), creator.publicKey.toBase58());
  assert.equal(s1.oftStore.toBase58(), s1.s.store.toBase58());
  // a posted snapshot launches once
  const mint2 = Keypair.generate(), nft2 = Keypair.generate();
  await send(wrapIxs(launcher.publicKey, 1), [launcher]);
  await expectFail(send([launchIx(launcher, mint2, nft2, s1.s, creator.publicKey, 0)], [launcher, mint2, nft2], 1_000_000), /AlreadyLaunched/);
});

test('launch buy: fee-free, priced on the curve from $3,000 for the chain\'s 1B, coins to the creator', async () => {
  // 1B at $3,000 and $150/SOL is 20 SOL
  const got = await coinsOf(creator.publicKey, s1.mint);
  const slice = Number(s1.s.snap.legs[2].slice);
  const capSol = 20;
  const want = slice * 1 / (1 + capSol);
  assert.ok(Math.abs(Number(got) - want) / want < 1e-6, `got ${got}, want ${want}`);
  assert.equal(await coinsOf(launcher.publicKey, s1.mint), 0n);
});

for (const [feeBps, share] of [[100, 2000n], [300, 2000n], [500, 2000n]]) {
  test(`a ${feeBps / 100}% fee splits: platform max(20% of fee, 0.2% of volume) = ${share} bps of it`, async () => {
    const s = await launch(launcher, creator.publicKey, { feeBps, firstBuy: LAMPORTS_PER_SOL / 10 });
    await buy(trader, s, 2 * LAMPORTS_PER_SOL);
    await sell(trader, s, (await coinsOf(trader.publicKey, s.mint)) / 2n);
    const c0 = await wsolOf(creator.publicKey), p0 = await wsolOf(feeRecipient.publicKey);
    await send([claimIx(stranger, s)], [stranger]);
    const toC = (await wsolOf(creator.publicKey)) - c0, toP = (await wsolOf(feeRecipient.publicKey)) - p0;
    assert.ok(toC + toP > 0n);
    assert.equal(toP, (toC + toP) * share / 10_000n);
  });
}

test('fees under 1% are refused, as on the EVM factories', async () => {
  const s = await snapshot(creator.publicKey, { feeBps: 50 });
  await expectFail(send([postIx(launcher, s)], [launcher]), /BadFee/);
});

test('launch fee: paid in SOL to the launcher when Solana is the creator\'s own leg, at the snapshot price', async () => {
  // $5 at $150/SOL = 1/30 SOL, rounded up by a lamport
  const fee = 5n * 10n ** 18n;
  const want = fee * 1_000_000_000n / SOL_USD18 + 1n;
  const before = BigInt(await cx.getBalance(launcher.publicKey, 'confirmed'));
  await launch(creator, creator.publicKey, { feeEid: SOL_EID, launchFee: fee, firstBuy: LAMPORTS_PER_SOL / 10 });
  const after = BigInt(await cx.getBalance(launcher.publicKey, 'confirmed'));
  assert.equal(after - before, want);
  // a fee above $50 is refused
  const big = await snapshot(creator.publicKey, { feeEid: SOL_EID, launchFee: 51n * 10n ** 18n });
  await expectFail(send([postIx(creator, big)], [creator]), /BadSnapshot/);
});

test('launch fee: nothing is paid here when another chain is the paying leg', async () => {
  const before = BigInt(await cx.getBalance(creator.publicKey, 'confirmed'));
  const s = await launch(launcher, creator.publicKey, { feeEid: 30101, launchFee: 5n * 10n ** 18n, firstBuy: 0 });
  assert.ok(s.mint);
  assert.equal(BigInt(await cx.getBalance(creator.publicKey, 'confirmed')), before);
});

test('collect: admin only', async () => {
  const toCoin = ata(admin.publicKey, s1.mint, TOKEN_2022_PROGRAM_ID);
  const toWsol = ata(admin.publicKey, NATIVE_MINT, TOKEN_PROGRAM_ID);
  await send([
    createAssociatedTokenAccountIdempotentInstruction(admin.publicKey, toCoin, admin.publicKey, s1.mint, TOKEN_2022_PROGRAM_ID),
    createAssociatedTokenAccountIdempotentInstruction(admin.publicKey, toWsol, admin.publicKey, NATIVE_MINT, TOKEN_PROGRAM_ID),
  ], [admin]);
  const collect = (signer, bps) => ix('collect', [
    r(signer.publicKey, true), r(CONFIG), r(s1.coin), r(s1.mint), r(NATIVE_MINT), w(toCoin), w(toWsol),
    w(s1.pool), w(s1.position), r(s1.positionNftAccount), w(vaultOf(s1.mint, s1.pool)), w(vaultOf(NATIVE_MINT, s1.pool)),
    r(POOL_AUTH), r(DAMM_EVENTS), r(DAMM), r(TOKEN_2022_PROGRAM_ID), r(TOKEN_PROGRAM_ID),
  ], u16(bps));
  await expectFail(send([collect(stranger, 5000)], [stranger]), /NotAdmin/);
  await send([collect(admin, 5000)], [admin]);
  assert.ok((await coinsOf(admin.publicKey, s1.mint)) > 0n);
});

test('admin settings are admin only', async () => {
  await expectFail(send([ix('set_signer', [r(stranger.publicKey, true), w(CONFIG)], hex(stranger.publicKey.toBuffer().subarray(0, 20).toString('hex')))], [stranger]), /NotAdmin/);
  await send([ix('set_quote_band', [r(admin.publicKey, true), w(CONFIG)], u128(10n ** 18n), u128(20_000n * 10n ** 18n))], [admin]);
  await send([ix('set_launcher', [r(admin.publicKey, true), w(CONFIG)], pk(launcher.publicKey))], [admin]);
});

// ---- LayerZero OFT (OFT=1: the validator also runs Equo's OFT program and LayerZero's endpoint and ULN) ----
if (process.env.OFT) {
  const lzSetup = await import('../lz/oft-setup.mjs');
  let sOft, store;
  let spentBefore;
  test('oft: the store over the snapshot escrow is the leg coin, and it takes the mint', async () => {
    spentBefore = await cx.getBalance(launcher.publicKey, 'confirmed');
    sOft = await launch(launcher, creator.publicKey, { firstBuy: 0 });
    console.log(`  launch tx: ${(spentBefore - await cx.getBalance(launcher.publicKey, 'confirmed')) / LAMPORTS_PER_SOL} SOL`);
    const { umi, signer } = lzSetup.umiFor(RPC, launcher);
    store = await lzSetup.init(umi, signer, sOft.mint, sOft.s.escrow);
    assert.equal(store.toBase58(), sOft.s.store.toBase58());
    const mint = await getMint(cx, sOft.mint, 'confirmed', TOKEN_2022_PROGRAM_ID);
    assert.equal(mint.mintAuthority.toBase58(), store.toBase58());
  });

  test('oft: wired to every EVM leg with LayerZero Labs + Horizen and the pathway confirmations', async () => {
    const { umi, signer } = lzSetup.umiFor(RPC, launcher);
    const evm = sOft.s.snap.legs.filter((l) => l.eid !== SOL_EID);
    for (const l of evm) await lzSetup.wire(umi, signer, store, l.eid, l.coin);
    const got = await lzSetup.inspect(umi, store, evm.map((l) => l.eid));
    for (const l of evm) {
      const g = got[l.eid];
      assert.equal(String(g.peer).replace(/^0x/, '').toLowerCase(), l.coin.replace(/^0x/, '').toLowerCase());
      const send = g.cfg.sendLibraryConfig.ulnSendConfig.uln, recv = g.cfg.receiveLibraryConfig.ulnReceiveConfig.uln;
      const d = Object.values(lzSetup.DEFAULTS).find((x) => x.eid === l.eid);
      assert.equal(Number(send.confirmations), d.sendConfirmations);
      assert.equal(Number(recv.confirmations), d.receiveConfirmations);
      assert.deepEqual(send.requiredDvns.map(String), lzSetup.DVNS.map(String));
      assert.deepEqual(recv.requiredDvns.map(String), lzSetup.DVNS.map(String));
    }
  });

  test('oft: sealed, nobody can change peers or configs afterwards', async () => {
    const { umi, signer } = lzSetup.umiFor(RPC, launcher);
    await lzSetup.seal(umi, signer, store);
    const legs = sOft.s.snap.legs.length - 1;
    console.log(`  whole Solana leg with ${legs} EVM peers: ${(spentBefore - await cx.getBalance(launcher.publicKey, 'confirmed')) / LAMPORTS_PER_SOL} SOL`);
    const { oft } = await import('../lz/node_modules/@layerzerolabs/oft-v2-solana-sdk/dist/index.mjs');
    const st = await oft.accounts.fetchOFTStore(umi, store.toBase58());
    assert.equal(String(st.admin), lzSetup.NOBODY.toBase58());
    // the old admin can no longer set a peer, nor wire a new chain
    await assert.rejects(lzSetup.wire(umi, signer, store, 30184, '0x' + '11'.repeat(32)));
  });

  test('service leg: post, launch and the OFT setup run as resumable steps', async () => {
    const leg = await import('../lz/leg.mjs');
    const launchId = ethers.hexlify(ethers.randomBytes(32));
    const keys = leg.legKeys(Buffer.from('test secret'), launchId);
    // the same keys again from the same secret and launch id
    assert.equal(leg.legKeys(Buffer.from('test secret'), launchId).store.toBase58(), keys.store.toBase58());
    const s = await snapshot(creator.publicKey, { escrow: keys.escrow });
    s.snap.launchId = launchId;
    s.sig = await attestor.signTypedData(DOMAIN, TYPES, s.snap);
    const { umi, signer } = lzSetup.umiFor(RPC, launcher);
    const p = leg.legPlan({ cx, ethers, launcher, umi, signer, snap: s.snap, sig: s.sig, keys, feeTo: launcher.publicKey });
    const all = leg.legStepIds(p);
    // a first call that runs out of time after a few steps
    const done = new Set();
    let n = 0;
    await leg.runLeg(umi, p, done, { onDone: async () => { if (++n === 4) throw new Error('out of time'); } }).catch((e) => assert.match(e.message, /out of time/));
    assert.equal(done.size, 4);
    // the next call picks up where it stopped
    await leg.runLeg(umi, p, done);
    assert.deepEqual([...done], all);
    const mint = await getMint(cx, keys.mint.publicKey, 'confirmed', TOKEN_2022_PROGRAM_ID);
    assert.equal(mint.mintAuthority.toBase58(), keys.store.toBase58());
    const { oft } = await import('../lz/node_modules/@layerzerolabs/oft-v2-solana-sdk/dist/index.mjs');
    assert.equal(String((await oft.accounts.fetchOFTStore(umi, keys.store.toBase58())).admin), lzSetup.NOBODY.toBase58());
  });
}
