// One-time setup of Equo's Solana leg program (programs/equo-omni), signed by its upgrade authority:
//   admin + platform fee recipient  J5UToKRtUypmd58DPP3s1ENQSAwNmSd4xnNbmUiEvyui (the Solana admin)
//   launcher                        the launch service's Solana wallet (EQUO_SOL_LAUNCHER_ADDRESS)
//   signer                          the launch service's snapshot signer (EQUO_SIGNER_ADDRESS, an Ethereum address)
//   SOL price band                  $10 to $10,000 (a snapshot's SOL price must sit in it)
//
//   RPC=<url> AUTHORITY=<keypair.json> EQUO_SOL_LAUNCHER_ADDRESS=.. EQUO_SIGNER_ADDRESS=0x.. node scripts/init-omni.mjs [--send]
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction, sendAndConfirmTransaction } from '@solana/web3.js';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const PROGRAM = new PublicKey(process.env.EQUO_SOL_PROGRAM || '8tQmVEDRd4gBXP2brdgKxtmzXbTD3y8uEbY1erS1UFKq');
const BPF_UPGRADEABLE = new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111');
const ADMIN = new PublicKey(process.env.EQUO_SOL_ADMIN || 'J5UToKRtUypmd58DPP3s1ENQSAwNmSd4xnNbmUiEvyui');
const LAUNCHER = new PublicKey(process.env.EQUO_SOL_LAUNCHER_ADDRESS);
const SIGNER = String(process.env.EQUO_SIGNER_ADDRESS || '');
if (!/^0x[0-9a-fA-F]{40}$/.test(SIGNER)) throw new Error('EQUO_SIGNER_ADDRESS must be an Ethereum address');
const USD18 = 10n ** 18n, LO = 10n * USD18, HI = 10_000n * USD18;

const u128 = (v) => { const b = Buffer.alloc(16); b.writeBigUInt64LE(v & ((1n << 64n) - 1n)); b.writeBigUInt64LE(v >> 64n, 8); return b; };
const disc = (n) => createHash('sha256').update(`global:${n}`).digest().subarray(0, 8);
const cx = new Connection(process.env.RPC || 'http://127.0.0.1:8899', 'confirmed');
const authority = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(process.env.AUTHORITY, 'utf8'))));
const config = PublicKey.findProgramAddressSync([Buffer.from('config2')], PROGRAM)[0];
const programData = PublicKey.findProgramAddressSync([PROGRAM.toBuffer()], BPF_UPGRADEABLE)[0];

const ix = new TransactionInstruction({
  programId: PROGRAM,
  keys: [
    { pubkey: authority.publicKey, isSigner: true, isWritable: true }, { pubkey: config, isSigner: false, isWritable: true },
    { pubkey: PROGRAM, isSigner: false, isWritable: false }, { pubkey: programData, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ],
  data: Buffer.concat([disc('initialize'), ADMIN.toBuffer(), ADMIN.toBuffer(), LAUNCHER.toBuffer(), Buffer.from(SIGNER.slice(2), 'hex'), u128(LO), u128(HI)]),
});
console.log({ program: PROGRAM.toBase58(), config: config.toBase58(), authority: authority.publicKey.toBase58(), admin: ADMIN.toBase58(), launcher: LAUNCHER.toBase58(), signer: SIGNER });
if (await cx.getAccountInfo(config)) { console.log('already initialised'); process.exit(0); }
if (!process.argv.includes('--send')) { console.log('dry run: add --send'); process.exit(0); }
console.log('initialised', await sendAndConfirmTransaction(cx, new Transaction().add(ix), [authority], { commitment: 'confirmed' }));
