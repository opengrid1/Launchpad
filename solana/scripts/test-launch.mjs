// Mainnet smoke test: launch one coin, buy and sell straight on its DAMM v2 pool, then claim the fees
// and print the 70/30 split. Signs with PAYER (default ~/.config/solana/id.json).
//   RPC=https://api.mainnet-beta.solana.com PAYER=.keys/deployer.json EQUO_CONFIRM_TEST=1 node scripts/test-launch.mjs
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import {
  Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction, ComputeBudgetProgram,
  LAMPORTS_PER_SOL, sendAndConfirmTransaction,
} from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, NATIVE_MINT,
  getAssociatedTokenAddressSync, createAssociatedTokenAccountIdempotentInstruction, createSyncNativeInstruction, getAccount,
} from '@solana/spl-token';

if (process.env.EQUO_CONFIRM_TEST !== '1') throw new Error('set EQUO_CONFIRM_TEST=1 to launch a real coin');
const cx = new Connection(process.env.RPC || 'http://127.0.0.1:8899', 'confirmed');
const PROGRAM = new PublicKey(process.env.EQUO_SOL || '6mdh7toDGpPEk8CYokVLi2aQMLDnB9jVkzhP5n9Dt4wR');
const DAMM = new PublicKey('cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG');
const keyPath = (process.env.PAYER || `${homedir()}/.config/solana/id.json`).replace(/^~/, homedir());
const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(keyPath, 'utf8'))));
const FIRST_BUY = BigInt(Math.round(Number(process.env.TEST_FIRST_BUY_SOL || '0.02') * LAMPORTS_PER_SOL));
const TRADE = BigInt(Math.round(Number(process.env.TEST_TRADE_SOL || '0.005') * LAMPORTS_PER_SOL));

const disc = (n) => createHash('sha256').update(`global:${n}`).digest().subarray(0, 8);
const u8 = (v) => Buffer.from([v]);
const u16 = (v) => { const b = Buffer.alloc(2); b.writeUInt16LE(v); return b; };
const u32 = (v) => { const b = Buffer.alloc(4); b.writeUInt32LE(v); return b; };
const u64 = (v) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(v)); return b; };
const str = (s) => { const d = Buffer.from(s, 'utf8'); return Buffer.concat([u32(d.length), d]); };
const w = (pubkey, isSigner = false) => ({ pubkey, isSigner, isWritable: true });
const r = (pubkey, isSigner = false) => ({ pubkey, isSigner, isWritable: false });
const pda = (seeds, prog = PROGRAM) => PublicKey.findProgramAddressSync(seeds, prog)[0];
const ata = (owner, mint, prog) => getAssociatedTokenAddressSync(mint, owner, true, prog);
const CONFIG = pda([Buffer.from('config')]);
const POOL_AUTH = pda([Buffer.from('pool_authority')], DAMM);
const DAMM_EVENTS = pda([Buffer.from('__event_authority')], DAMM);
const poolOf = (a, b) => {
  const [hi, lo] = Buffer.compare(a.toBuffer(), b.toBuffer()) > 0 ? [a, b] : [b, a];
  return pda([Buffer.from('cpool'), hi.toBuffer(), lo.toBuffer()], DAMM);
};
const vaultOf = (mint, pool) => pda([Buffer.from('token_vault'), mint.toBuffer(), pool.toBuffer()], DAMM);
const bal = async (a, prog) => { try { return (await getAccount(cx, a, 'confirmed', prog)).amount; } catch { return 0n; } };
async function send(ixs, signers) {
  const tx = new Transaction().add(ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 20_000 }), ...ixs);
  return sendAndConfirmTransaction(cx, tx, signers, { commitment: 'confirmed' });
}
const wrapIxs = (owner, lamports) => {
  const a = ata(owner, NATIVE_MINT, TOKEN_PROGRAM_ID);
  return [
    createAssociatedTokenAccountIdempotentInstruction(owner, a, owner, NATIVE_MINT, TOKEN_PROGRAM_ID),
    SystemProgram.transfer({ fromPubkey: owner, toPubkey: a, lamports }),
    createSyncNativeInstruction(a, TOKEN_PROGRAM_ID),
  ];
};

const cfg = (await cx.getAccountInfo(CONFIG)).data;
const feeRecipient = new PublicKey(cfg.subarray(40, 72));
console.log(`payer ${payer.publicKey.toBase58()} (${(await cx.getBalance(payer.publicKey)) / 1e9} SOL), fees to ${feeRecipient.toBase58()}`);

// launch
const mint = Keypair.generate();
const nft = Keypair.generate();
const pool = poolOf(mint.publicKey, NATIVE_MINT);
const coin = pda([Buffer.from('coin'), mint.publicKey.toBuffer()]);
const uri = 'data:application/json,' + JSON.stringify({ name: 'Equo Test', symbol: 'EQTEST', image: 'https://equo-fun.vercel.app/img/apple-touch-icon.png' });
const launch = new TransactionInstruction({
  programId: PROGRAM,
  keys: [
    w(payer.publicKey, true), w(CONFIG), w(feeRecipient), w(mint.publicKey, true), w(coin),
    w(ata(payer.publicKey, mint.publicKey, TOKEN_2022_PROGRAM_ID)), w(ata(payer.publicKey, NATIVE_MINT, TOKEN_PROGRAM_ID)), r(NATIVE_MINT),
    w(nft.publicKey, true), w(pda([Buffer.from('position_nft_account'), nft.publicKey.toBuffer()], DAMM)),
    w(pool), w(pda([Buffer.from('position'), nft.publicKey.toBuffer()], DAMM)),
    w(vaultOf(mint.publicKey, pool)), w(vaultOf(NATIVE_MINT, pool)), r(POOL_AUTH), r(DAMM_EVENTS), r(DAMM),
    r(TOKEN_2022_PROGRAM_ID), r(TOKEN_PROGRAM_ID), r(ASSOCIATED_TOKEN_PROGRAM_ID), r(SystemProgram.programId),
  ],
  data: Buffer.concat([disc('launch'), str('Equo Test'), str('EQTEST'), str(uri), u16(100), u16(0), u32(0), u8(1), u8(0), u64(FIRST_BUY)]),
});
const sig = await send([...wrapIxs(payer.publicKey, FIRST_BUY), launch], [payer, mint, nft]);
const myCoin = ata(payer.publicKey, mint.publicKey, TOKEN_2022_PROGRAM_ID);
console.log(`launched ${mint.publicKey.toBase58()} (pool ${pool.toBase58()}) in ${sig}`);
console.log(`  first buy ${Number(FIRST_BUY) / 1e9} SOL -> ${Number(await bal(myCoin, TOKEN_2022_PROGRAM_ID)) / 1e6} EQTEST`);

// buy and sell straight on the pool (DAMM v2 swap2, exact in)
const swap = (buy, amountIn) => new TransactionInstruction({
  programId: DAMM,
  keys: [
    r(POOL_AUTH), w(pool), w(buy ? ata(payer.publicKey, NATIVE_MINT, TOKEN_PROGRAM_ID) : myCoin), w(buy ? myCoin : ata(payer.publicKey, NATIVE_MINT, TOKEN_PROGRAM_ID)),
    w(vaultOf(mint.publicKey, pool)), w(vaultOf(NATIVE_MINT, pool)), r(mint.publicKey), r(NATIVE_MINT),
    r(payer.publicKey, true), r(TOKEN_2022_PROGRAM_ID), r(TOKEN_PROGRAM_ID), r(DAMM), r(DAMM_EVENTS), r(DAMM),
  ],
  data: Buffer.concat([disc('swap2'), u64(amountIn), u64(0), u8(0)]),
});
await new Promise((res) => setTimeout(res, 2000));
console.log(`buy  ${await send([...wrapIxs(payer.publicKey, TRADE), swap(true, TRADE)], [payer])}`);
const held = await bal(myCoin, TOKEN_2022_PROGRAM_ID);
console.log(`sell ${await send([swap(false, held / 10n)], [payer])}`);

// claim and split
const cs = (await cx.getAccountInfo(coin)).data;
const creator = new PublicKey(cs.subarray(40, 72));
const position = new PublicKey(cs.subarray(104, 136));
const nftAcct = new PublicKey(cs.subarray(136, 168));
const cW = ata(creator, NATIVE_MINT, TOKEN_PROGRAM_ID), pW = ata(feeRecipient, NATIVE_MINT, TOKEN_PROGRAM_ID);
const c0 = await bal(cW, TOKEN_PROGRAM_ID), p0 = await bal(pW, TOKEN_PROGRAM_ID);
const claim = new TransactionInstruction({
  programId: PROGRAM,
  keys: [
    w(payer.publicKey, true), r(CONFIG), w(coin), r(mint.publicKey), r(NATIVE_MINT),
    w(ata(coin, mint.publicKey, TOKEN_2022_PROGRAM_ID)), w(ata(coin, NATIVE_MINT, TOKEN_PROGRAM_ID)),
    r(creator), w(cW), r(feeRecipient), w(pW), r(pool), w(position), r(nftAcct),
    w(vaultOf(mint.publicKey, pool)), w(vaultOf(NATIVE_MINT, pool)), r(POOL_AUTH), r(DAMM_EVENTS), r(DAMM),
    r(TOKEN_2022_PROGRAM_ID), r(TOKEN_PROGRAM_ID), r(ASSOCIATED_TOKEN_PROGRAM_ID), r(SystemProgram.programId),
  ],
  data: disc('claim_fees'),
});
console.log(`claim ${await send([claim], [payer])}`);
const dc = (await bal(cW, TOKEN_PROGRAM_ID)) - c0, dp = (await bal(pW, TOKEN_PROGRAM_ID)) - p0;
console.log(`  creator +${Number(dc) / 1e9} SOL, platform +${Number(dp) / 1e9} SOL (${dc + dp ? Number((dc * 10000n) / (dc + dp)) / 100 : 0}% to the creator)`);
console.log(`done. ${(await cx.getBalance(payer.publicKey)) / 1e9} SOL left`);
