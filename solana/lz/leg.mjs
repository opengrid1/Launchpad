// The Solana leg of an Equo launch, as the launch service runs it: post the signed snapshot, launch the coin into
// its DAMM v2 pool (Equo's Solana program), then the coin's LayerZero OFT setup (oft-setup.mjs). Every step is one
// transaction with a name, so a caller can record what is done and resume.
//
// The escrow (whose OFT store is the leg's `coin`), the mint and the pool position's NFT are keypairs derived from
// a service secret and the launch id: a retry rebuilds the same ones, and the quote can name the store up front.
import {
  Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction, ComputeBudgetProgram, sendAndConfirmTransaction,
} from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, NATIVE_MINT,
  getAssociatedTokenAddressSync, createAssociatedTokenAccountIdempotentInstruction, createSyncNativeInstruction,
} from '@solana/spl-token';
import { createHash } from 'node:crypto';
import { plan, runSteps, storeOf } from './oft-setup.mjs';

export const PROGRAM = new PublicKey(process.env.EQUO_SOL_PROGRAM || '8tQmVEDRd4gBXP2brdgKxtmzXbTD3y8uEbY1erS1UFKq');
export const DAMM = new PublicKey('cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG');
export const SOL_EID = 30168;
export const WSOL = 'So11111111111111111111111111111111111111112';

const disc = (name) => createHash('sha256').update(`global:${name}`).digest().subarray(0, 8);
const u8 = (v) => Buffer.from([v]);
const u16 = (v) => { const b = Buffer.alloc(2); b.writeUInt16LE(v); return b; };
const u32 = (v) => { const b = Buffer.alloc(4); b.writeUInt32LE(v); return b; };
const u64 = (v) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(v)); return b; };
const u128 = (v) => { const b = Buffer.alloc(16); b.writeBigUInt64LE(BigInt(v) & ((1n << 64n) - 1n)); b.writeBigUInt64LE(BigInt(v) >> 64n, 8); return b; };
const str = (s) => { const d = Buffer.from(s, 'utf8'); return Buffer.concat([u32(d.length), d]); };
const hex = (h) => Buffer.from(String(h).replace(/^0x/, ''), 'hex');
const w = (pubkey, isSigner = false) => ({ pubkey, isSigner, isWritable: true });
const r = (pubkey, isSigner = false) => ({ pubkey, isSigner, isWritable: false });
const pda = (seeds, prog = PROGRAM) => PublicKey.findProgramAddressSync(seeds, prog)[0];
const ata = (owner, mint, prog) => getAssociatedTokenAddressSync(mint, owner, true, prog);

export const CONFIG = pda([Buffer.from('config2')]);
export const coinPda = (mint) => pda([Buffer.from('coin2'), mint.toBuffer()]);
export const markerPda = (launchId) => pda([Buffer.from('launch'), hex(launchId)]);
const POOL_AUTH = pda([Buffer.from('pool_authority')], DAMM);
const DAMM_EVENTS = pda([Buffer.from('__event_authority')], DAMM);
export const poolOf = (a, b) => {
  const [hi, lo] = Buffer.compare(a.toBuffer(), b.toBuffer()) > 0 ? [a, b] : [b, a];
  return pda([Buffer.from('cpool'), hi.toBuffer(), lo.toBuffer()], DAMM);
};
const vaultOf = (mint, pool) => pda([Buffer.from('token_vault'), mint.toBuffer(), pool.toBuffer()], DAMM);

/** The leg's keypairs for a launch id, from the service's secret (any bytes it keeps). */
export function legKeys(secret, launchId) {
  const k = (tag) => Keypair.fromSeed(createHash('sha256').update(Buffer.concat([Buffer.from(`equo-sol-${tag}:`), Buffer.from(secret), hex(launchId)])).digest());
  const escrow = k('escrow');
  return { escrow, mint: k('mint'), nft: k('nft'), store: storeOf(escrow.publicKey) };
}

/** EIP-712 hash of a leg, as the EVM factories compute it. */
function legHash(ethers, l) {
  const LEG = [{ name: 'eid', type: 'uint32' }, { name: 'coin', type: 'bytes32' }, { name: 'legSalt', type: 'bytes32' }, { name: 'pair', type: 'bytes32' }, { name: 'slice', type: 'uint256' }, { name: 'quoteUsd18', type: 'uint256' }];
  return ethers.TypedDataEncoder.from({ Leg: LEG }).hashStruct('Leg', l);
}

/** post_snapshot: only the Solana leg is spelled out, every other leg goes as its hash. */
export function postIx(ethers, payer, snap, sig) {
  const legs = snap.legs.map((l) => Number(l.eid) === SOL_EID
    ? Buffer.concat([u8(1), u32(SOL_EID), hex(l.coin), hex(l.legSalt), hex(l.pair), u64(l.slice), u128(l.quoteUsd18)])
    : Buffer.concat([u8(0), hex(legHash(ethers, l))]));
  return new TransactionInstruction({
    programId: PROGRAM,
    keys: [w(payer), r(CONFIG), w(markerPda(snap.launchId)), r(SystemProgram.programId)],
    data: Buffer.concat([disc('post_snapshot'), hex(snap.launchId), hex(snap.creator), str(snap.name), str(snap.symbol), str(snap.metadataURI),
      u16(Number(snap.feeBps)), u64(snap.deadline), u32(Number(snap.feeEid)), u128(snap.launchFeeUsd18), u32(legs.length), ...legs, hex(sig)]),
  });
}

/** launch: makes the coin and its pool; `creator` is the leg's Solana wallet (legSalt), `feeTo` the program's launcher. */
export function launchIx(payer, keys, snap, creator, feeTo, firstBuy = 0n) {
  const mint = keys.mint.publicKey, nft = keys.nft.publicKey, pool = poolOf(mint, NATIVE_MINT);
  return new TransactionInstruction({
    programId: PROGRAM,
    keys: [
      w(payer, true), w(CONFIG), w(mint, true), w(coinPda(mint)),
      w(ata(payer, mint, TOKEN_2022_PROGRAM_ID)), w(ata(payer, NATIVE_MINT, TOKEN_PROGRAM_ID)), r(NATIVE_MINT),
      w(nft, true), w(pda([Buffer.from('position_nft_account'), nft.toBuffer()], DAMM)),
      w(pool), w(pda([Buffer.from('position'), nft.toBuffer()], DAMM)),
      w(vaultOf(mint, pool)), w(vaultOf(NATIVE_MINT, pool)), r(POOL_AUTH), r(DAMM_EVENTS), r(DAMM),
      r(TOKEN_2022_PROGRAM_ID), r(TOKEN_PROGRAM_ID), r(ASSOCIATED_TOKEN_PROGRAM_ID), r(SystemProgram.programId),
      w(markerPda(snap.launchId)), r(keys.escrow.publicKey), r(creator), w(ata(creator, mint, TOKEN_2022_PROGRAM_ID)), w(feeTo),
    ],
    data: Buffer.concat([disc('launch'), u64(firstBuy)]),
  });
}

/** Wrapped SOL for the launch: DAMM v2 takes at least one unit of each side, so a launch with no buy needs 1 lamport. */
function wrapIxs(owner, lamports) {
  const a = ata(owner, NATIVE_MINT, TOKEN_PROGRAM_ID);
  return [createAssociatedTokenAccountIdempotentInstruction(owner, a, owner, NATIVE_MINT, TOKEN_PROGRAM_ID),
    SystemProgram.transfer({ fromPubkey: owner, toPubkey: a, lamports: BigInt(lamports) }), createSyncNativeInstruction(a, TOKEN_PROGRAM_ID)];
}

/**
 * Every step of the Solana leg, in order: `post`, `launch`, then the OFT setup's steps. `launcher` is a web3 Keypair,
 * `umi`/`signer` the same wallet for the LayerZero SDK (oft-setup.umiFor). `peers` maps each EVM eid to its coin.
 */
export function legPlan({ cx, ethers, launcher, umi, signer, snap, sig, keys, feeTo }) {
  const sol = snap.legs.find((l) => Number(l.eid) === SOL_EID);
  if (!sol) throw new Error('the snapshot has no Solana leg');
  if (hex(sol.coin).toString('hex') !== keys.store.toBuffer().toString('hex')) throw new Error('the Solana leg does not name this escrow\'s store');
  const creator = new PublicKey(hex(sol.legSalt));
  const sendTx = (ixs, signers, cu = 400_000) => sendAndConfirmTransaction(cx, new Transaction().add(ComputeBudgetProgram.setComputeUnitLimit({ units: cu }), ...ixs), signers, { commitment: 'confirmed' });
  const peers = Object.fromEntries(snap.legs.filter((l) => Number(l.eid) !== SOL_EID).map((l) => [Number(l.eid), l.coin]));
  const oft = plan(umi, signer, { mint: keys.mint.publicKey, escrowKeypair: keys.escrow, peers });
  const steps = [
    { id: 'post', run: () => sendTx([postIx(ethers, launcher.publicKey, snap, sig)], [launcher]) },
    { id: 'launch', run: () => sendTx([...wrapIxs(launcher.publicKey, 1), launchIx(launcher.publicKey, keys, snap, creator, feeTo, 0n)], [launcher, keys.mint, keys.nft], 1_000_000) },
  ];
  return { steps, oftSteps: oft.steps, store: oft.store, mint: keys.mint.publicKey };
}

/** Runs what is left of a leg until `deadline`; `done` is a Set of step ids, `onDone` records each one. */
export async function runLeg(umi, legP, done = new Set(), { deadline = Infinity, onDone = async () => {} } = {}) {
  for (const st of legP.steps) {
    if (done.has(st.id)) continue;
    if (Date.now() > deadline) return done;
    await st.run();
    done.add(st.id);
    await onDone(st.id);
  }
  return runSteps(umi, legP.oftSteps, done, { deadline, onDone });
}

/** Steps a leg has in all (to tell when it is complete). */
export const legStepIds = (legP) => [...legP.steps, ...legP.oftSteps].map((s) => s.id);
