// Writes the accounts the local test validator loads with --account-dir (into .test-accounts/):
//   - Pyth SOL/USD and SPYx/USD price updates copied from mainnet (their publish time is stamped at validator
//     start by test-validator.sh), and a stale copy for the StalePrice test;
//   - an SPYx token account owned by the test wallet, holding 100 SPYx (copied from a Raydium pool vault).
// Run once; test-validator.sh refreshes the publish times on every start.
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';

const OUT = new URL('../.test-accounts/', import.meta.url).pathname;
const cx = new Connection(process.env.MAINNET_RPC || 'https://api.mainnet-beta.solana.com');
const wallet = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(`${homedir()}/.config/solana/id.json`, 'utf8'))));
mkdirSync(OUT, { recursive: true });

const save = (name, pubkey, info, data) => writeFileSync(`${OUT}${name}.json`, JSON.stringify({
  pubkey: pubkey.toBase58(),
  account: { lamports: info.lamports, data: [Buffer.from(data).toString('base64'), 'base64'], owner: info.owner.toBase58(), executable: false, rentEpoch: 0, space: data.length },
}));

const sol = await cx.getAccountInfo(new PublicKey('7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE'));
const spyx = await cx.getAccountInfo(new PublicKey('jf8MarLKgBte4f3NWufbNpGRCuBfJLhuZPuFigvSQR2'));
save('pyth-sol', new PublicKey('7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE'), sol, sol.data);
save('pyth-spyx', new PublicKey('jf8MarLKgBte4f3NWufbNpGRCuBfJLhuZPuFigvSQR2'), spyx, spyx.data);
const stale = Keypair.generate().publicKey;
save('pyth-sol-stale', stale, sol, sol.data);

// SPYx/USDC pool 6truu3…: its token_vault_0 holds SPYx
const pool = await cx.getAccountInfo(new PublicKey('6truu3rZuiB9rKQg4VYC3Dt3QwV7DgwGqXrYUcrvnDDE'));
const vault = await cx.getAccountInfo(new PublicKey(pool.data.subarray(137, 169)));
const d = Buffer.from(vault.data);
wallet.publicKey.toBuffer().copy(d, 32);
d.writeBigUInt64LE(100n * 10n ** 8n, 64);
const holder = Keypair.generate().publicKey;
save('spyx-holder', holder, vault, d);

writeFileSync(`${OUT}meta.json`, JSON.stringify({ stalePrice: stale.toBase58(), spyxHolder: holder.toBase58() }));
console.log(`wrote ${OUT}`);
