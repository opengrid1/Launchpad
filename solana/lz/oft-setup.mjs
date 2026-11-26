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

/** One transaction of up to three instructions. */
async function send(umi, items) {
  let tb = transactionBuilder();
  for (const w of items) tb = tb.add(w);
  await tb.sendAndConfirm(umi, { send: { skipPreflight: false }, confirm: { commitment: 'confirmed' } });
}

const peerBytesOf = (peer) => Uint8Array.from(Buffer.from(peer.replace(/^0x/, '').padStart(64, '0'), 'hex'));

/**
 * The whole LayerZero setup of one coin as named steps, one transaction each, in order: `init`, then four steps per
 * EVM chain (`<eid>:libs`, `<eid>:lib-set`, `<eid>:cfg`, `<eid>:peer`), then `seal:delegate` and `seal:admin`.
 * `peers` maps each EVM eid to the EVM coin address (hex, 20 or 32 bytes). Past `init` only the store is needed: pass
 * `store` instead of `escrowKeypair`.
 */
export function plan(umi, signer, { mint, escrowKeypair, peers, store: given }) {
  const store = given ?? storeOf(escrowKeypair.publicKey);
  const oftStore = umiKey(store.toBase58()), admin = signer, msgLib = umiKey(ULN.toBase58()), oftProgram = umiKey(OFT_PROGRAM.toBase58());
  const uln = (confirmations) => ({
    confirmations: BigInt(confirmations), requiredDvnCount: DVNS.length, optionalDvnCount: 0, optionalDvnThreshold: 0,
    requiredDvns: DVNS.map((k) => umiKey(k.toBase58())), optionalDvns: [],
  });
  const opts = Options.newOptions().addExecutorLzReceiveOption(EVM_RECEIVE_GAS, 0).toBytes();
  const steps = [{
    id: 'init',
    build: async () => [oft.initOft({ payer: signer, admin: signer.publicKey, mint: umiKey(mint.toBase58()), escrow: createSignerFromKeypair(umi, fromWeb3JsKeypair(escrowKeypair)) },
      'Native', SHARED_DECIMALS, { oft: oftProgram, token: umiKey(TOKEN_2022.toBase58()) })],
  }];
  for (const [eidS, peer] of Object.entries(peers)) {
    const eid = Number(eidS), d = byEid[eid];
    if (!d) throw new Error(`no LayerZero defaults for eid ${eid}`);
    const pb = peerBytesOf(peer);
    steps.push(
      { id: `${eid}:libs`, build: async () => [oft.initSendLibrary({ admin, oftStore }, eid), oft.initReceiveLibrary({ admin, oftStore }, eid), oft.initOAppNonce({ admin, oftStore }, eid, pb)] },
      { id: `${eid}:lib-set`, build: async () => [oft.initConfig({ admin, oftStore, payer: signer }, eid, { msgLib }),
        oft.setSendLibrary({ admin, oftStore }, { sendLibraryProgram: msgLib, remoteEid: eid }), oft.setReceiveLibrary({ admin, oftStore }, { receiveLibraryProgram: msgLib, remoteEid: eid })] },
      { id: `${eid}:cfg`, build: async () => Promise.all([
        oft.setConfig(umi.rpc, { signer, oftStore }, { remoteEid: eid, configType: SetConfigType.SEND_ULN, config: uln(d.sendConfirmations) }, { msgLib }),
        oft.setConfig(umi.rpc, { signer, oftStore }, { remoteEid: eid, configType: SetConfigType.RECEIVE_ULN, config: uln(d.receiveConfirmations) }, { msgLib }),
        oft.setConfig(umi.rpc, { signer, oftStore }, { remoteEid: eid, configType: SetConfigType.EXECUTOR, config: { maxMessageSize: d.maxMessageSize, executor: umiKey(d.executor) } }, { msgLib }),
      ]) },
      { id: `${eid}:peer`, build: async () => [oft.setPeerConfig({ admin, oftStore }, { __kind: 'PeerAddress', peer: pb, remote: eid }, oftProgram),
        oft.setPeerConfig({ admin, oftStore }, { __kind: 'EnforcedOptions', send: opts, sendAndCall: opts, remote: eid }, oftProgram)] },
    );
  }
  steps.push(
    { id: 'seal:delegate', build: async () => [oft.setOFTConfig({ oftStore, admin: signer }, { __kind: 'Delegate', delegate: umiKey(NOBODY.toBase58()) }, { oft: oftProgram })] },
    { id: 'seal:admin', build: async () => [oft.setOFTConfig({ oftStore, admin: signer }, { __kind: 'Admin', admin: umiKey(NOBODY.toBase58()) }, { oft: oftProgram })] },
  );
  return { store, steps };
}

/**
 * Runs the steps not in `done` (a Set of ids), in order, until `deadline` (ms since epoch); returns the ids done.
 * `onDone(id)` is called after each confirmed step, so a caller can record progress and resume later.
 */
export async function runSteps(umi, steps, done = new Set(), { deadline = Infinity, onDone = async () => {} } = {}) {
  for (const st of steps) {
    if (done.has(st.id)) continue;
    if (Date.now() > deadline) break;
    await send(umi, await st.build());
    done.add(st.id);
    await onDone(st.id);
  }
  return done;
}

/** The steps of `plan` whose ids match `re`. */
const only = (steps, re) => steps.filter((s) => re.test(s.id));

/** Step 1. `escrowKeypair` is the web3 Keypair whose store the snapshot named. */
export async function init(umi, signer, mint, escrowKeypair) {
  const { store, steps } = plan(umi, signer, { mint, escrowKeypair, peers: {} });
  await runSteps(umi, only(steps, /^init$/));
  return store;
}

/** Step 2, for one EVM chain: `peer` is the EVM coin address as 32 bytes. */
export async function wire(umi, signer, store, eid, peer) {
  const { steps } = plan(umi, signer, { store, peers: { [eid]: peer } });
  const st = only(steps, new RegExp(`^${eid}:`));
  for (const s of st) await send(umi, await s.build());
}

/** Step 3. */
export async function seal(umi, signer, store) {
  const { steps } = plan(umi, signer, { store, peers: {} });
  for (const s of only(steps, /^seal:/)) await send(umi, await s.build());
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
