// The LayerZero side of an Equo coin's Solana leg, after the Equo program has launched it (mint authority already
// with the OFT store). Run by the launch service with its launcher wallet:
//   1. init: the OFT store over the snapshot's escrow (so the store is the leg's `coin`), Native type, 6 shared
//      decimals like the EVM coins; the launcher is admin and endpoint delegate for now.
//   2. wire: for every EVM chain of the coin, the endpoint libraries (LayerZero's ULN), the nonce with the EVM coin
//      as peer, the ULN configs (LayerZero Labs + Horizen, LayerZero's own confirmations for the pathway), the
//      executor, the peer and its enforced options (gas for the EVM coin's receive).
//   3. seal: delegate and admin handed to the system program's address, which nobody can sign for, so peers,
//      options and verifier configs are fixed for good, as on the EVM chains.
import { PublicKey } from '@solana/web3.js';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { createSignerFromKeypair, signerIdentity, transactionBuilder, publicKey as umiKey } from '@metaplex-foundation/umi';
import { fromWeb3JsKeypair, toWeb3JsPublicKey } from '@metaplex-foundation/umi-web3js-adapters';
import { oft, OftPDA } from '@layerzerolabs/oft-v2-solana-sdk';
import { SetConfigType } from '@layerzerolabs/lz-solana-sdk-v2/umi';
import { Options } from '@layerzerolabs/lz-v2-utilities';
import { readFileSync } from 'node:fs';

export const OFT_PROGRAM = new PublicKey(process.env.EQUO_OFT_PROGRAM || 'RuyLPEWoYG2b6mGb6nvKotoNhW2F9KdhrjRghaRdGkz');
export const ULN = new PublicKey('7a4WjyR8VZ7yZz5XJAKm39BUGn5iT9CKcv2pmG9tdXVH');
export const SHARED_DECIMALS = 6;
/// Equo coins on Solana are Token-2022 mints.
export const TOKEN_2022 = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
/// LayerZero Labs + Horizen on Solana (sorted, as a ULN config requires).
export const DVNS = ['4VDjp6XQaxoZf5RGwiPU9NR1EXSZn2TP4ATMmiSzLfhb', 'HR9NQKK1ynW9NzgdM37dU5CBtqRHTukmbMKS7qkwSkHX']
  .map((k) => new PublicKey(k)).sort((a, b) => Buffer.compare(a.toBuffer(), b.toBuffer()));
/// Gas the executor brings to the EVM coin's lzReceive (the same as the EVM chains use between themselves).
export const EVM_RECEIVE_GAS = 100_000;
/// Nobody holds this key: the sealed admin and delegate.
export const NOBODY = new PublicKey('11111111111111111111111111111111');

/// LayerZero's defaults on Solana for each EVM chain (read-sol-defaults.mjs): confirmations and the executor.
export const DEFAULTS = JSON.parse(readFileSync(new URL('./solana-defaults.json', import.meta.url), 'utf8'));
const byEid = Object.fromEntries(Object.values(DEFAULTS).map((d) => [d.eid, d]));

export function umiFor(rpcUrl, keypair) {
  const umi = createUmi(rpcUrl, 'confirmed');
  const signer = createSignerFromKeypair(umi, fromWeb3JsKeypair(keypair));
  umi.use(signerIdentity(signer));
  return { umi, signer };
}

/** The OFT store of an escrow: the Solana leg's `coin` in a snapshot. */
export const storeOf = (escrow) => PublicKey.findProgramAddressSync([Buffer.from('OFT'), escrow.toBuffer()], OFT_PROGRAM)[0];

async function run(umi, items, label) {
  // a few instructions per transaction keeps each under the size limit
  for (let i = 0; i < items.length; i += 3) {
    let tb = transactionBuilder();
    for (const w of items.slice(i, i + 3)) tb = tb.add(w);
    await tb.sendAndConfirm(umi, { send: { skipPreflight: false }, confirm: { commitment: 'confirmed' } });
  }
  if (label) console.log(label);
}

/** Step 1. `escrowKeypair` is the web3 Keypair whose store the snapshot named. */
export async function init(umi, signer, mint, escrowKeypair) {
  const escrow = createSignerFromKeypair(umi, fromWeb3JsKeypair(escrowKeypair));
  await run(umi, [oft.initOft({ payer: signer, admin: signer.publicKey, mint: umiKey(mint.toBase58()), escrow }, 'Native', SHARED_DECIMALS, { oft: umiKey(OFT_PROGRAM.toBase58()), token: umiKey(TOKEN_2022.toBase58()) })], 'oft store initialised');
  return storeOf(escrowKeypair.publicKey);
}

/** Step 2, for one EVM chain: `peer` is the EVM coin address as 32 bytes. */
export async function wire(umi, signer, store, eid, peer) {
  const d = byEid[eid];
  if (!d) throw new Error(`no LayerZero defaults for eid ${eid}`);
  const oftStore = umiKey(store.toBase58()), admin = signer, msgLib = umiKey(ULN.toBase58());
  const peerBytes = Uint8Array.from(Buffer.from(peer.replace(/^0x/, '').padStart(64, '0'), 'hex'));
  const uln = (confirmations) => ({
    confirmations: BigInt(confirmations), requiredDvnCount: DVNS.length, optionalDvnCount: 0, optionalDvnThreshold: 0,
    requiredDvns: DVNS.map((k) => umiKey(k.toBase58())), optionalDvns: [],
  });
  await run(umi, [
    oft.initSendLibrary({ admin, oftStore }, eid),
    oft.initReceiveLibrary({ admin, oftStore }, eid),
    oft.initOAppNonce({ admin, oftStore }, eid, peerBytes),
    oft.initConfig({ admin, oftStore, payer: signer }, eid, { msgLib }),
    oft.setSendLibrary({ admin, oftStore }, { sendLibraryProgram: msgLib, remoteEid: eid }),
    oft.setReceiveLibrary({ admin, oftStore }, { receiveLibraryProgram: msgLib, remoteEid: eid }),
  ]);
  const cfg = await Promise.all([
    oft.setConfig(umi.rpc, { signer, oftStore }, { remoteEid: eid, configType: SetConfigType.SEND_ULN, config: uln(d.sendConfirmations) }, { msgLib }),
    oft.setConfig(umi.rpc, { signer, oftStore }, { remoteEid: eid, configType: SetConfigType.RECEIVE_ULN, config: uln(d.receiveConfirmations) }, { msgLib }),
    oft.setConfig(umi.rpc, { signer, oftStore }, { remoteEid: eid, configType: SetConfigType.EXECUTOR, config: { maxMessageSize: d.maxMessageSize, executor: umiKey(d.executor) } }, { msgLib }),
  ]);
  const opts = Options.newOptions().addExecutorLzReceiveOption(EVM_RECEIVE_GAS, 0).toBytes();
  const oftProgram = umiKey(OFT_PROGRAM.toBase58());
  await run(umi, [
    ...cfg,
    oft.setPeerConfig({ admin, oftStore }, { __kind: 'PeerAddress', peer: peerBytes, remote: eid }, oftProgram),
    oft.setPeerConfig({ admin, oftStore }, { __kind: 'EnforcedOptions', send: opts, sendAndCall: opts, remote: eid }, oftProgram),
  ], `wired eid ${eid}`);
}

/** Step 3. */
export async function seal(umi, signer, store) {
  const oftStore = umiKey(store.toBase58()), programs = { oft: umiKey(OFT_PROGRAM.toBase58()) };
  await run(umi, [oft.setOFTConfig({ oftStore, admin: signer }, { __kind: 'Delegate', delegate: umiKey(NOBODY.toBase58()) }, programs)]);
  await run(umi, [oft.setOFTConfig({ oftStore, admin: signer }, { __kind: 'Admin', admin: umiKey(NOBODY.toBase58()) }, programs)], 'sealed');
}

/** Reads back what a store is wired to: per eid, the peer and the endpoint config. */
export async function inspect(umi, store, eids) {
  const out = {};
  for (const eid of eids) {
    const peer = await oft.getPeerAddress(umi.rpc, umiKey(store.toBase58()), eid, umiKey(OFT_PROGRAM.toBase58())).catch(() => null);
    const cfg = await oft.getEndpointConfig(umi.rpc, umiKey(store.toBase58()), eid).catch((e) => ({ error: e.message }));
    out[eid] = { peer, cfg };
  }
  return out;
}

export { toWeb3JsPublicKey };
