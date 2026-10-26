// One-time setup of the deployed program: writes the config (admin, fee recipient). Must be signed by the
// program's upgrade authority. The admin can never change; the fee recipient can.
//
//   RPC=https://api.mainnet-beta.solana.com AUTHORITY=~/.config/solana/equo-deployer.json \
//   ADMIN=<solana pubkey> FEE_RECIPIENT=<solana pubkey> EQUO_CONFIRM=1 node scripts/init.mjs
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction, sendAndConfirmTransaction } from '@solana/web3.js';

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

const disc = (n) => createHash('sha256').update(`global:${n}`).digest().subarray(0, 8);
const CONFIG = PublicKey.findProgramAddressSync([Buffer.from('config3')], PROGRAM)[0];
const programData = PublicKey.findProgramAddressSync([PROGRAM.toBuffer()], BPF_UPGRADEABLE)[0];

const cx = new Connection(RPC, 'confirmed');
console.log(`program   ${PROGRAM.toBase58()}\nconfig    ${CONFIG.toBase58()}\nauthority ${authority.publicKey.toBase58()}`);
console.log(`admin     ${admin.toBase58()}\nfees to   ${feeRecipient.toBase58()}`);
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
  data: Buffer.concat([disc('initialize'), admin.toBuffer(), feeRecipient.toBuffer()]),
});
const sig = await sendAndConfirmTransaction(cx, new Transaction().add(init), [authority], { commitment: 'confirmed' });
console.log(`initialized: ${sig}`);
