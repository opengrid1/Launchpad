// Pushes the SOL/USD price the program uses to turn the dollar cap presets
// into SOL. Run by the price updater key (or the admin) at least once per
// `max_price_age`; the launch service will do this on a timer.
//
//   RPC=... UPDATER=~/.config/solana/equo-price.json node scripts/set-price.mjs
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction, sendAndConfirmTransaction } from '@solana/web3.js';

const RPC = process.env.RPC || 'http://127.0.0.1:8899';
const PROGRAM = new PublicKey(process.env.EQUO_SOL || '6mdh7toDGpPEk8CYokVLi2aQMLDnB9jVkzhP5n9Dt4wR');
const keyPath = (process.env.UPDATER || `${homedir()}/.config/solana/id.json`).replace(/^~/, homedir());
const signer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(keyPath, 'utf8'))));
const CONFIG = PublicKey.findProgramAddressSync([Buffer.from('config')], PROGRAM)[0];

const r = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd');
const usd = (await r.json())?.solana?.usd;
if (!(usd > 0)) throw new Error('no SOL price');
const v = Buffer.alloc(8);
v.writeBigUInt64LE(BigInt(Math.round(usd * 1e8)));
const ix = new TransactionInstruction({
  programId: PROGRAM,
  keys: [
    { pubkey: signer.publicKey, isSigner: true, isWritable: false },
    { pubkey: CONFIG, isSigner: false, isWritable: true },
  ],
  data: Buffer.concat([createHash('sha256').update('global:set_sol_price').digest().subarray(0, 8), v]),
});
const sig = await sendAndConfirmTransaction(new Connection(RPC, 'confirmed'), new Transaction().add(ix), [signer], { commitment: 'confirmed' });
console.log(`SOL $${usd}: ${sig}`);
