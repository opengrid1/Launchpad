// One-time setup of the deployed program: writes the config (admin, fee
// recipient, price updater, launch terms, dollar cap presets) and sets the
// first SOL price. Must be signed by the program's upgrade authority.
//
//   RPC=https://api.mainnet-beta.solana.com \
//   AUTHORITY=~/.config/solana/equo-deployer.json \
//   ADMIN=<solana pubkey> FEE_RECIPIENT=<solana pubkey> PRICE_UPDATER=<solana pubkey> \
//   MIN_FIRST_BUY_SOL=0.01 LAUNCH_FEE_SOL=0 CAP_PRESETS_USD=5000,12500,25000 \
//   EQUO_CONFIRM=1 node scripts/init.mjs
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import {
  Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction,
  LAMPORTS_PER_SOL, sendAndConfirmTransaction,
} from '@solana/web3.js';

const env = (k, d) => {
  const v = process.env[k] ?? d;
  if (v === undefined) throw new Error(`set ${k}`);
  return v;
};
const RPC = env('RPC', 'http://127.0.0.1:8899');
const PROGRAM = new PublicKey(env('EQUO_SOL', '6mdh7toDGpPEk8CYokVLi2aQMLDnB9jVkzhP5n9Dt4wR'));
const BPF_UPGRADEABLE = new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111');
const keyPath = env('AUTHORITY', `${homedir()}/.config/solana/id.json`).replace(/^~/, homedir());
const authority = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(keyPath, 'utf8'))));
const admin = new PublicKey(env('ADMIN'));
const feeRecipient = new PublicKey(env('FEE_RECIPIENT'));
const priceUpdater = new PublicKey(env('PRICE_UPDATER', admin.toBase58()));
const minFirstBuy = BigInt(Math.round(Number(env('MIN_FIRST_BUY_SOL', '0.01')) * LAMPORTS_PER_SOL));
const launchFee = BigInt(Math.round(Number(env('LAUNCH_FEE_SOL', '0')) * LAMPORTS_PER_SOL));
const maxPriceAge = Number(env('MAX_PRICE_AGE_SECS', '3600'));
const presets = env('CAP_PRESETS_USD', '5000,12500,25000').split(',').map((v) => BigInt(Math.round(Number(v) * 1e8)));

const disc = (n) => createHash('sha256').update(`global:${n}`).digest().subarray(0, 8);
const u32 = (v) => { const b = Buffer.alloc(4); b.writeUInt32LE(v); return b; };
const u64 = (v) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(v)); return b; };
const CONFIG = PublicKey.findProgramAddressSync([Buffer.from('config')], PROGRAM)[0];
const programData = PublicKey.findProgramAddressSync([PROGRAM.toBuffer()], BPF_UPGRADEABLE)[0];

async function solUsd8() {
  const r = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd');
  const usd = (await r.json())?.solana?.usd;
  if (!(usd > 0)) throw new Error('no SOL price');
  return BigInt(Math.round(usd * 1e8));
}

const cx = new Connection(RPC, 'confirmed');
console.log(`program   ${PROGRAM.toBase58()}\nconfig    ${CONFIG.toBase58()}\nauthority ${authority.publicKey.toBase58()}`);
console.log(`admin     ${admin.toBase58()}\nfees to   ${feeRecipient.toBase58()}\nprices by ${priceUpdater.toBase58()}`);
console.log(`min first buy ${Number(minFirstBuy) / 1e9} SOL, launch fee ${Number(launchFee) / 1e9} SOL, presets $${presets.map((p) => Number(p) / 1e8).join(' / $')}`);
if (process.env.EQUO_CONFIRM !== '1') {
  console.log('dry run: set EQUO_CONFIRM=1 to send');
  process.exit(0);
}
if (await cx.getAccountInfo(CONFIG)) throw new Error('already initialized');

const init = new TransactionInstruction({
  programId: PROGRAM,
  keys: [
    { pubkey: authority.publicKey, isSigner: true, isWritable: true },
    { pubkey: CONFIG, isSigner: false, isWritable: true },
    { pubkey: PROGRAM, isSigner: false, isWritable: false },
    { pubkey: programData, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ],
  data: Buffer.concat([
    disc('initialize'), admin.toBuffer(), feeRecipient.toBuffer(), priceUpdater.toBuffer(),
    u64(minFirstBuy), u64(launchFee), u32(maxPriceAge), u32(presets.length), ...presets.map(u64),
  ]),
});
const ixs = [init];
// the authority can set the first price only if it is also the admin or updater
if (authority.publicKey.equals(admin) || authority.publicKey.equals(priceUpdater)) {
  const price = await solUsd8();
  console.log(`SOL price $${Number(price) / 1e8}`);
  ixs.push(new TransactionInstruction({
    programId: PROGRAM,
    keys: [
      { pubkey: authority.publicKey, isSigner: true, isWritable: false },
      { pubkey: CONFIG, isSigner: false, isWritable: true },
    ],
    data: Buffer.concat([disc('set_sol_price'), u64(price)]),
  }));
}
const sig = await sendAndConfirmTransaction(cx, new Transaction().add(...ixs), [authority], { commitment: 'confirmed' });
console.log(`initialized: ${sig}`);
