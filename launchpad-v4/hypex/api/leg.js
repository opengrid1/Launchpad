// POST /api/leg {chain, tx, salt}: after a creator's launch on `chain` (transaction `tx`), the launch service puts the
// same coin on Hypex's other chain for the same creator (HypexFactory.launchLeg from the keeper key, with a start
// signed for that chain): same name, ticker and salt, so the same address, with its own pool and floor there.
// Idempotent: a coin already on the other chain is left as it is. The salt is checked against the launch
// (predictToken), so nobody can put a different coin at that address.
const X = require('./_hx');
const { ethers, NETS, otherNet, rpc, multicall, I } = X;

module.exports = async (req, res) => {
  if (req.method !== 'POST') return X.json(res, 405, { error: 'POST' });
  try {
    const b = await X.readBody(req, 16 * 1024);
    const A = NETS[b.chain]; if (!A || !A.live) return X.json(res, 400, { error: 'chain' });
    const B = otherNet(A.key); if (!B.live) return X.json(res, 409, { error: B.name + ' is not live yet' });
    const tx = String(b.tx || ''), salt = String(b.salt || '');
    if (!/^0x[0-9a-fA-F]{64}$/.test(tx) || !/^0x[0-9a-fA-F]{64}$/.test(salt)) return X.json(res, 400, { error: 'tx or salt' });
    const rc = await rpc(A, 'eth_getTransactionReceipt', [tx]);
    if (!rc || rc.status !== '0x1') return X.json(res, 404, { error: 'launch transaction not found or failed' });
    const log = rc.logs.find((l) => l.address.toLowerCase() === A.factory.toLowerCase() && l.topics[0] === I.factory.getEvent('TokenLaunched').topicHash);
    if (!log) return X.json(res, 404, { error: 'no launch in that transaction' });
    const p = I.factory.parseLog(log), token = p.args.token, creator = p.args.creator, name = p.args.name, ticker = p.args.ticker, uri = p.args.metadataURI;
    const [predicted] = await multicall(A, [[A.factory, I.factory, 'predictToken', [creator, salt, name, ticker]]]);
    if (!predicted || predicted.toLowerCase() !== token.toLowerCase()) return X.json(res, 400, { error: 'salt does not match the launch' });
    const code = await rpc(B, 'eth_getCode', [token, 'latest']);
    if (code && code !== '0x') return X.json(res, 200, { token, chain: B.key, already: true });
    const key = process.env.HYPEX_KEEPER_KEY; if (!key) return X.json(res, 503, { error: 'launch service not configured' });
    const start = await X.signStart(B.key, { creator, salt, name, ticker });
    const [fee] = await multicall(B, [[B.factory, I.factory, 'launchFeeEth']]);
    const lp = [name, ticker, uri, salt, ethers.ZeroAddress, 0n, 0n, start.tickStart, BigInt(start.deadline), start.signature, 0];
    const provider = new ethers.JsonRpcProvider(B.rpcs[0], B.chainId, { staticNetwork: true });
    const wallet = new ethers.Wallet(key, provider);
    const sent = await wallet.sendTransaction({ to: B.factory, data: I.factory.encodeFunctionData('launchLeg', [lp, creator]), value: fee || 0n, gasLimit: 2_800_000n });
    const r = await sent.wait(1, 90000);
    X.json(res, 200, { token, chain: B.key, tx: sent.hash, status: r && r.status });
  } catch (e) { X.json(res, e.code === 409 || e.code === 503 ? e.code : 500, { error: e.shortMessage || e.message }); }
};
