/* UniversalRouter calldata for BuzzPad v2 trades, every route starting or ending in native ETH, so a buyer never needs
   the pair token:
   - ETH pair: one V4 swap (SWAP_EXACT_IN_SINGLE, SETTLE_ALL, TAKE_ALL).
   - AZTEC pair (route v4): a two-hop V4 swap through the AZTEC/ETH v4 pool (SWAP_EXACT_IN, SETTLE_ALL, TAKE_ALL).
   - XMR pair (route v2, WXMR): buy = WRAP_ETH, V2_SWAP_EXACT_IN WETH->WXMR held by the router, then a V4 swap that
     settles the router's WXMR (SETTLE payer=router, SWAP_EXACT_IN_SINGLE on the open credit, TAKE_ALL); sell = a V4
     swap whose WXMR stays in the router (TAKE to the router), V2_SWAP_EXACT_IN WXMR->WETH, UNWRAP_WETH to the seller.
   Only the final amount carries the caller's minimum; the hops in between take whatever the pools give.
   ROUTES.encode({ coin, pair, hook, pairInfo, buy, amountIn, minOut, deadline }) -> calldata for execute(). */
(function (root) {
  const X = root.ethers || require('ethers').ethers;
  const AC = X.AbiCoder.defaultAbiCoder(), Z = X.ZeroAddress;
  const MSG_SENDER = '0x0000000000000000000000000000000000000001', ROUTER = '0x0000000000000000000000000000000000000002', CONTRACT_BALANCE = 1n << 255n;
  const A = { SWAP_EXACT_IN_SINGLE: 0x06, SWAP_EXACT_IN: 0x07, SETTLE: 0x0b, SETTLE_ALL: 0x0c, TAKE: 0x0e, TAKE_ALL: 0x0f };
  const CMD = { V2_SWAP_EXACT_IN: 0x08, WRAP_ETH: 0x0b, UNWRAP_WETH: 0x0c, V4_SWAP: 0x10 };
  const KEY = '(address,address,uint24,int24,address)';
  const UR = new X.Interface(['function execute(bytes commands, bytes[] inputs, uint256 deadline) payable']);
  const single = (key, zeroForOne, amountIn, minOut) => AC.encode([`(${KEY},bool,uint128,uint128,bytes)`], [[key, zeroForOne, amountIn, minOut, '0x']]);
  const multi = (currencyIn, path, amountIn, minOut) => AC.encode(['(address,(address,uint24,int24,address,bytes)[],uint128,uint128)'], [[currencyIn, path, amountIn, minOut]]);
  const amt = (c, a) => AC.encode(['address', 'uint256'], [c, a]);
  const v4 = (actions, params) => AC.encode(['bytes', 'bytes[]'], [X.solidityPacked(actions.map(() => 'uint8'), actions), params]);
  const v2swap = (recipient, amountIn, minOut, path) => AC.encode(['address', 'uint256', 'uint256', 'address[]', 'bool'], [recipient, amountIn, minOut, path, false]);
  const cmds = (list) => X.solidityPacked(list.map(() => 'uint8'), list);

  function encode({ coin, pair, hook, pairInfo, buy, amountIn, minOut, deadline }) {
    coin = X.getAddress(coin); pair = pair && pair !== Z ? X.getAddress(pair) : Z; hook = X.getAddress(hook);
    const key = [pair, coin, 0, 200, hook];
    let commands, inputs;
    if (pair === Z) {
      commands = cmds([CMD.V4_SWAP]);
      inputs = [v4([A.SWAP_EXACT_IN_SINGLE, A.SETTLE_ALL, A.TAKE_ALL], [single(key, buy, amountIn, minOut), amt(buy ? Z : coin, amountIn), amt(buy ? coin : Z, minOut)])];
    } else if (pairInfo.route === 'v4') {
      const pk = pairInfo.key, hop = [pair, Number(pk[2]), Number(pk[3]), X.getAddress(pk[4]), '0x'], ours = [coin, 0, 200, hook, '0x'];
      const path = buy ? [hop, ours] : [[pair, 0, 200, hook, '0x'], [Z, Number(pk[2]), Number(pk[3]), X.getAddress(pk[4]), '0x']];
      commands = cmds([CMD.V4_SWAP]);
      inputs = [v4([A.SWAP_EXACT_IN, A.SETTLE_ALL, A.TAKE_ALL], [multi(buy ? Z : coin, path, amountIn, minOut), amt(buy ? Z : coin, amountIn), amt(buy ? coin : Z, minOut)])];
    } else {
      const weth = X.getAddress(pairInfo.weth);
      if (buy) {
        commands = cmds([CMD.WRAP_ETH, CMD.V2_SWAP_EXACT_IN, CMD.V4_SWAP]);
        inputs = [amt(ROUTER, amountIn), v2swap(ROUTER, CONTRACT_BALANCE, 1n, [weth, pair]),
          v4([A.SETTLE, A.SWAP_EXACT_IN_SINGLE, A.TAKE_ALL], [AC.encode(['address', 'uint256', 'bool'], [pair, CONTRACT_BALANCE, false]), single(key, true, 0n, minOut), amt(coin, minOut)])];
      } else {
        commands = cmds([CMD.V4_SWAP, CMD.V2_SWAP_EXACT_IN, CMD.UNWRAP_WETH]);
        inputs = [v4([A.SWAP_EXACT_IN_SINGLE, A.SETTLE_ALL, A.TAKE], [single(key, false, amountIn, 1n), amt(coin, amountIn), AC.encode(['address', 'address', 'uint256'], [pair, ROUTER, 0n])]),
          v2swap(ROUTER, CONTRACT_BALANCE, 1n, [pair, weth]), amt(MSG_SENDER, minOut)];
      }
    }
    return UR.encodeFunctionData('execute', [commands, inputs, deadline]);
  }
  const api = { encode };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ROUTES = api;
})(typeof window !== 'undefined' ? window : globalThis);
