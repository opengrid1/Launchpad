// LayerZero's default ULN config on Solana mainnet toward each Equo EVM chain: confirmations, DVNs, executor.
import { Connection, PublicKey } from '@solana/web3.js';
import { UlnPDADeriver, UlnProgram } from '@layerzerolabs/lz-solana-sdk-v2';
const ULN = new PublicKey('7a4WjyR8VZ7yZz5XJAKm39BUGn5iT9CKcv2pmG9tdXVH');
const cx = new Connection(process.env.SOL_RPC || 'https://api.mainnet-beta.solana.com', 'confirmed');
const EIDS = { mainnet: 30101, bsc: 30102, arbitrum: 30110, base: 30184, unichain: 30320, hyperevm: 30367, monad: 30390, megaeth: 30398, ink: 30339 };
const d = new UlnPDADeriver(ULN);
const out = {};
for (const [name, eid] of Object.entries(EIDS)) {
  const [sendPda] = d.defaultSendConfig(eid), [recvPda] = d.defaultReceiveConfig(eid);
  const [si, ri] = await Promise.all([cx.getAccountInfo(sendPda), cx.getAccountInfo(recvPda)]);
  if (!si || !ri) { console.log(name, 'no default config'); continue; }
  const s = UlnProgram.accounts.SendConfig.fromAccountInfo(si)[0], r = UlnProgram.accounts.ReceiveConfig.fromAccountInfo(ri)[0];
  const k = (l) => l.map((x) => x.toBase58());
  out[name] = {
    eid, sendConfirmations: Number(s.uln.confirmations), receiveConfirmations: Number(r.uln.confirmations),
    sendDvns: k(s.uln.requiredDvns), receiveDvns: k(r.uln.requiredDvns), executor: s.executor.executor.toBase58(), maxMessageSize: s.executor.maxMessageSize,
  };
  console.log(name, JSON.stringify(out[name]));
}
(await import('fs')).writeFileSync(new URL('./solana-defaults.json', import.meta.url), JSON.stringify(out, null, 2) + '\n');
