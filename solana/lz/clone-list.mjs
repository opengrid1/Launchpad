// Writes clone-accounts.txt: the mainnet LayerZero accounts a local validator needs for the OFT setup test.
import { PublicKey } from '@solana/web3.js';
import { EndpointPDADeriver, UlnPDADeriver } from '@layerzerolabs/lz-solana-sdk-v2';
import { DEFAULTS } from './oft-setup.mjs';
import { writeFileSync } from 'node:fs';
const ep = new EndpointPDADeriver(new PublicKey('76y77prsiCMvXMjuoZ5VRrhG5qYBrUMYTE5WgHqgjEn6'));
const uln = new UlnPDADeriver(new PublicKey('7a4WjyR8VZ7yZz5XJAKm39BUGn5iT9CKcv2pmG9tdXVH'));
const keys = new Set(['F8E8QGhKmHEx2esh5LpVizzcP4cHYhzXdXTwg9w3YYY2', '526PeNZfw8kSnDU4nmzJFVJzJWNhwmZykEyJr5XWz5Fv', '2XgGZG4oP29U3w5h4nTk1V2LFHL23zKDPJjs3psGzLKQ']);
const add = (r) => keys.add((Array.isArray(r) ? r[0] : r).toBase58());
add(ep.setting()); add(uln.setting());
for (const d of Object.values(DEFAULTS)) {
  add(ep.defaultSendLibraryConfig(d.eid)); add(ep.defaultReceiveLibraryConfig(d.eid));
  add(uln.defaultSendConfig(d.eid)); add(uln.defaultReceiveConfig(d.eid));
}
writeFileSync(new URL('./clone-accounts.txt', import.meta.url), [...keys].join('\n') + '\n');
console.log(keys.size, 'accounts');
