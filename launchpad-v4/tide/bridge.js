/* The canonical bridge between HyperEVM and Elysium (window.BRIDGE). Elysium is a rollup on HyperEVM:
   deposit: Inbox.depositEth() on HyperEVM, the same address receives HYPE on Elysium when the sequencer includes it.
   withdraw: ArbSys.withdrawEth(destination) on Elysium; once the rollup confirms the assertion that contains it
   (about 6 to 7 days), Outbox.executeTransaction(proof, …) on HyperEVM pays it out. Status comes from the latest
   confirmed assertion: its Elysium block header carries sendCount (nonce) and sendRoot (extraData). */
(function () {
  const C = window.CFG, X = window.ethers, B = () => C.bridge, P = () => B().parent, W = () => APP.W;
  const I = {
    inbox: new X.Interface(['function depositEth() payable returns (uint256)']),
    arbsys: new X.Interface(['function withdrawEth(address destination) payable returns (uint256)', 'event L2ToL1Tx(address caller, address indexed destination, uint256 indexed hash, uint256 indexed position, uint256 arbBlockNum, uint256 ethBlockNum, uint256 timestamp, uint256 callvalue, bytes data)']),
    outbox: new X.Interface(['function executeTransaction(bytes32[] proof, uint256 index, address l2Sender, address to, uint256 l2Block, uint256 l1Block, uint256 l2Timestamp, uint256 value, bytes data)', 'function isSpent(uint256 index) view returns (bool)']),
    node: new X.Interface(['function constructOutboxProof(uint64 size, uint64 leaf) view returns (bytes32 send, bytes32 root, bytes32[] proof)']),
    rollup: new X.Interface(['function latestConfirmed() view returns (bytes32)', 'function getAssertion(bytes32) view returns (tuple(uint64 firstChildBlock,uint64 secondChildBlock,uint64 createdAtBlock,bool isFirstChild,uint8 status,bytes32 configHash))',
      'event AssertionCreated(bytes32 indexed assertionHash, bytes32 indexed parentAssertionHash, tuple(tuple(bytes32 prevPrevAssertionHash, bytes32 sequencerBatchAcc, tuple(bytes32 wasmModuleRoot, uint256 requiredStake, address challengeManager, uint64 confirmPeriodBlocks, uint64 nextInboxPosition) configData) beforeStateData, tuple(tuple(bytes32[2] bytes32Vals, uint64[2] u64Vals) globalState, uint8 machineStatus, bytes32 endHistoryRoot) beforeState, tuple(tuple(bytes32[2] bytes32Vals, uint64[2] u64Vals) globalState, uint8 machineStatus, bytes32 endHistoryRoot) afterState) assertion, bytes32 afterInboxBatchAcc, uint256 inboxMaxCount, bytes32 wasmModuleRoot, uint256 requiredStake, address challengeManager, uint64 confirmPeriodBlocks)']),
  };
  const hex = (n) => '0x' + BigInt(n).toString(16);
  async function rpc(url, method, params) {
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }).then((r) => r.json());
    if (r.error) throw Object.assign(new Error(r.error.message || 'RPC error'), { code: r.error.code, data: r.error.data }); return r.result;
  }
  const hrpc = (m, p) => rpc(P().rpc, m, p);
  async function erpc(m, p) { const urls = C.chain.rpcs || [C.chain.rpc]; let err; for (const u of urls) { try { return await rpc(u, m, p); } catch (e) { err = e; } } throw err; }
  const unit = (v) => Number(X.formatEther(BigInt(v || 0)));
  // balances on both sides
  async function balances(addr) { const [h, e] = await Promise.all([hrpc('eth_getBalance', [addr, 'latest']).catch(() => '0x0'), erpc('eth_getBalance', [addr, 'latest']).catch(() => '0x0')]); return { parent: unit(h), child: unit(e) }; }
  // the wallet on a given chain
  async function onChain(ch) {
    const p = W().provider; if (!p) throw new Error('Connect a wallet first');
    const cur = parseInt(await p.request({ method: 'eth_chainId' }), 16); if (cur === ch.id) return;
    try { await p.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: ch.hex }] }); }
    catch (e) { if (e && (e.code === 4902 || /unrecognized|not added|4902/i.test(e.message || ''))) await p.request({ method: 'wallet_addEthereumChain', params: [{ chainId: ch.hex, chainName: ch.name, nativeCurrency: { name: ch.native, symbol: ch.native, decimals: 18 }, rpcUrls: [ch.rpc], blockExplorerUrls: [String(ch.explorer).replace(/\/#$/, '')] }] }); else throw e; }
  }
  async function wait(rpcf, hash, ms = 180000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { const r = await rpcf('eth_getTransactionReceipt', [hash]).catch(() => null); if (r) return r; await new Promise((ok) => setTimeout(ok, 2000)); } throw new Error('Still pending. Check the explorer.'); }
  async function send(ch, rpcf, tx) {
    await onChain(ch); const p = W().provider, req = { from: W().address, to: tx.to, data: tx.data, value: hex(tx.value || 0), gas: hex(tx.gas || 300000) };
    const hash = await p.request({ method: 'eth_sendTransaction', params: [req] }); const rc = await wait(rpcf, hash); if (parseInt(rc.status, 16) !== 1) throw new Error(tx.label + ' reverted. Nothing was moved.'); return hash;
  }
  // deposit HYPE from HyperEVM to the same address on Elysium
  async function deposit(amountHype) { const wei = X.parseEther(String(amountHype)); return send(P(), hrpc, { to: B().inbox, data: I.inbox.encodeFunctionData('depositEth', []), value: wei, gas: 200000, label: 'Deposit' }); }
  // start a withdrawal on Elysium
  async function withdraw(amountHype, dest) { const wei = X.parseEther(String(amountHype)); return send(C.chain, erpc, { to: B().arbSys, data: I.arbsys.encodeFunctionData('withdrawEth', [dest || W().address]), value: wei, gas: 300000, label: 'Withdrawal' }); }
  // the latest confirmed state: the Elysium block the rollup has confirmed, with its sendCount and sendRoot
  let confCache = null;
  async function confirmed() {
    if (confCache && Date.now() - confCache.at < 60000) return confCache.v;
    const h = X.AbiCoder.defaultAbiCoder().decode(['bytes32'], await hrpc('eth_call', [{ to: B().rollup, data: I.rollup.encodeFunctionData('latestConfirmed', []) }, 'latest']))[0];
    const [a] = I.rollup.decodeFunctionResult('getAssertion', await hrpc('eth_call', [{ to: B().rollup, data: I.rollup.encodeFunctionData('getAssertion', [h]) }, 'latest']));
    const blk = hex(a.createdAtBlock), logs = await hrpc('eth_getLogs', [{ address: B().rollup, fromBlock: blk, toBlock: blk, topics: [I.rollup.getEvent('AssertionCreated').topicHash, h] }]);
    if (!logs.length) throw new Error('The rollup did not return its confirmed state');
    const ev = I.rollup.parseLog(logs[0]), gs = ev.args.assertion.afterState.globalState, blockHash = gs.bytes32Vals[0], sendRoot = gs.bytes32Vals[1];
    const b = await erpc('eth_getBlockByHash', [blockHash, false]); if (!b) throw new Error('Elysium did not return the confirmed block');
    const v = { hash: h, blockHash, sendRoot, sendCount: parseInt(b.nonce, 16), block: parseInt(b.number, 16), ts: parseInt(b.timestamp, 16) }; confCache = { at: Date.now(), v }; return v;
  }
  // a wallet's withdrawals: every L2ToL1Tx to it, with its stage
  async function withdrawals(addr) {
    const topic = I.arbsys.getEvent('L2ToL1Tx').topicHash, dest = X.zeroPadValue(addr, 32);
    let logs; try { logs = await erpc('eth_getLogs', [{ address: B().arbSys, fromBlock: '0x0', toBlock: 'latest', topics: [topic, dest] }]); } catch { logs = []; }
    const items = logs.map((l) => { const e = I.arbsys.parseLog(l).args; return { tx: l.transactionHash, caller: e.caller, destination: e.destination, position: Number(e.position), arbBlockNum: e.arbBlockNum, ethBlockNum: e.ethBlockNum, timestamp: Number(e.timestamp), value: e.callvalue, hype: unit(e.callvalue), data: e.data }; });
    if (!items.length) return { items, checkpoint: null };
    let cp = null; try { cp = await confirmed(); } catch {}
    const spent = await Promise.all(items.map((w) => hrpc('eth_call', [{ to: B().outbox, data: I.outbox.encodeFunctionData('isSpent', [w.position]) }, 'latest']).then((r) => BigInt(r) === 1n).catch(() => false)));
    return { items: items.map((w, i) => ({ ...w, stage: spent[i] ? 'claimed' : cp && w.position < cp.sendCount ? 'ready' : 'waiting' })).reverse(), checkpoint: cp };
  }
  // claim a confirmed withdrawal on HyperEVM
  async function claim(w) {
    const cp = await confirmed(); if (w.position >= cp.sendCount) throw new Error('Not confirmed yet');
    const [send_, root, proof] = I.node.decodeFunctionResult('constructOutboxProof', await erpc('eth_call', [{ to: B().nodeInterface, data: I.node.encodeFunctionData('constructOutboxProof', [cp.sendCount, w.position]) }, 'latest']));
    if (root !== cp.sendRoot) throw new Error('Proof root does not match the confirmed state. Try again in a minute.'); void send_;
    return send(P(), hrpc, { to: B().outbox, data: I.outbox.encodeFunctionData('executeTransaction', [proof, w.position, w.caller, w.destination, w.arbBlockNum, w.ethBlockNum, w.timestamp, w.value, w.data]), gas: 400000, label: 'Claim' });
  }
  window.BRIDGE = { balances, deposit, withdraw, withdrawals, confirmed, claim, onChain, explorerTx: (ch, h) => `${String(ch.explorer).replace(/\/#$/, '')}/tx/${h}` };
})();
