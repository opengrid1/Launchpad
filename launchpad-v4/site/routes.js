/* UniversalRouter calldata for BuzzPad v2 trades, every route starting or ending in native ETH, so a buyer never needs
   the pair token:
   - ETH pair: one V4 swap (SWAP_EXACT_IN_SINGLE, SETTLE_ALL, TAKE_ALL).
   - AZTEC pair (route v4): a two-hop V4 swap through the AZTEC/ETH v4 pool (SWAP_EXACT_IN, SETTLE_ALL, TAKE_ALL).
   - v4 multi-hop (route v4 with `hops`, e.g. a Robinhood stock in a v4 USDG pool): ETH -> each hop -> pair -> coin
     in one SWAP_EXACT_IN; `hops` lists, from ETH outward, the currency each hop reaches and its pool's fee, tick
     spacing and hooks.
   - XMR pair (route v2, WXMR): buy = WRAP_ETH, V2_SWAP_EXACT_IN WETH->WXMR held by the router, then a V4 swap that
     settles the router's WXMR (SETTLE payer=router, SWAP_EXACT_IN_SINGLE on the open credit, TAKE_ALL); sell = a V4
     swap whose WXMR stays in the router (TAKE to the router), V2_SWAP_EXACT_IN WXMR->WETH, UNWRAP_WETH to the seller.
   - Robinhood stock in a v3 pool (route v3, `path` = [WETH, fee, USDG, fee, stock]): as the v2 route, with one
     V3_SWAP_EXACT_IN per pool along the path (reversed for a sell), each on the router's whole balance. (Robinhood
     Chain's UniversalRouter rejects a multi-pool v3 path with SliceOutOfBounds; single pools chain fine.)
   Only the final amount carries the caller's minimum; the hops in between take whatever the pools give.
   ROUTES.encode({ coin, pair, hook, pairInfo, buy, amountIn, minOut, deadline, hopLayout }) -> calldata for execute().
   hopLayout: true for a UniversalRouter on the newer v4-periphery whose swap params carry per-hop price limits
   (ExactInputSingleParams.minHopPriceX36, ExactInputParams.minHopPriceX36[]), as on Robinhood Chain; they are
   sent as 0 (no per-hop limit). Ethereum's router takes the older layout. */
(function (root) {
  const X = root.ethers || require('ethers').ethers;
  const AC = X.AbiCoder.defaultAbiCoder(), Z = X.ZeroAddress;
  const MSG_SENDER = '0x0000000000000000000000000000000000000001', ROUTER = '0x0000000000000000000000000000000000000002', CONTRACT_BALANCE = 1n << 255n;
  const A = { SWAP_EXACT_IN_SINGLE: 0x06, SWAP_EXACT_IN: 0x07, SETTLE: 0x0b, SETTLE_ALL: 0x0c, TAKE: 0x0e, TAKE_ALL: 0x0f };
  const CMD = { V3_SWAP_EXACT_IN: 0x00, V2_SWAP_EXACT_IN: 0x08, WRAP_ETH: 0x0b, UNWRAP_WETH: 0x0c, V4_SWAP: 0x10 };
  const KEY = '(address,address,uint24,int24,address)';
  const UR = new X.Interface(['function execute(bytes commands, bytes[] inputs, uint256 deadline) payable']);
  let HOP = false; // set per encode() call
  const single = (key, zeroForOne, amountIn, minOut) => (HOP ? AC.encode([`(${KEY},bool,uint128,uint128,uint256,bytes)`], [[key, zeroForOne, amountIn, minOut, 0n, '0x']]) : AC.encode([`(${KEY},bool,uint128,uint128,bytes)`], [[key, zeroForOne, amountIn, minOut, '0x']]));
  const multi = (currencyIn, path, amountIn, minOut) => (HOP ? AC.encode(['(address,(address,uint24,int24,address,bytes)[],uint256[],uint128,uint128)'], [[currencyIn, path, path.map(() => 0n), amountIn, minOut]]) : AC.encode(['(address,(address,uint24,int24,address,bytes)[],uint128,uint128)'], [[currencyIn, path, amountIn, minOut]]));
  const amt = (c, a) => AC.encode(['address', 'uint256'], [c, a]);
  const v4 = (actions, params) => AC.encode(['bytes', 'bytes[]'], [X.solidityPacked(actions.map(() => 'uint8'), actions), params]);
  const v2swap = (recipient, amountIn, minOut, path) => AC.encode(['address', 'uint256', 'uint256', 'address[]', 'bool'], [recipient, amountIn, minOut, path, false]);
  const v3swap = (recipient, amountIn, minOut, path) => AC.encode(['address', 'uint256', 'uint256', 'bytes', 'bool'], [recipient, amountIn, minOut, path, false]);
  const v3path = (p) => X.solidityPacked(p.map((_, i) => (i % 2 ? 'uint24' : 'address')), p);
  const cmds = (list) => X.solidityPacked(list.map(() => 'uint8'), list);

  function encode({ coin, pair, hook, pairInfo, buy, amountIn, minOut, deadline, hopLayout }) {
    HOP = !!hopLayout;
    coin = X.getAddress(coin); pair = pair && pair !== Z ? X.getAddress(pair) : Z; hook = X.getAddress(hook);
    const key = [pair, coin, 0, 200, hook];
    let commands, inputs;
    if (pair === Z) {
      commands = cmds([CMD.V4_SWAP]);
      inputs = [v4([A.SWAP_EXACT_IN_SINGLE, A.SETTLE_ALL, A.TAKE_ALL], [single(key, buy, amountIn, minOut), amt(buy ? Z : coin, amountIn), amt(buy ? coin : Z, minOut)])];
    } else if (pairInfo.route === 'v4') {
      // hops from ETH outward: the currency each reaches and its pool; a single `key` is the one-hop form
      const pk = pairInfo.key, hops = (pairInfo.hops || [{ c: pair, fee: pk[2], ts: pk[3], hooks: pk[4] }]).map((h) => ({ c: X.getAddress(h.c), fee: Number(h.fee), ts: Number(h.ts), hooks: X.getAddress(h.hooks || Z) }));
      const path = buy ? [...hops.map((h) => [h.c, h.fee, h.ts, h.hooks, '0x']), [coin, 0, 200, hook, '0x']]
        : [[pair, 0, 200, hook, '0x'], ...hops.map((h, i) => [i ? hops[i - 1].c : Z, h.fee, h.ts, h.hooks, '0x']).reverse()];
      commands = cmds([CMD.V4_SWAP]);
      inputs = [v4([A.SWAP_EXACT_IN, A.SETTLE_ALL, A.TAKE_ALL], [multi(buy ? Z : coin, path, amountIn, minOut), amt(buy ? Z : coin, amountIn), amt(buy ? coin : Z, minOut)])];
    } else {
      const v3 = pairInfo.route === 'v3', weth = X.getAddress(v3 ? pairInfo.path[0] : pairInfo.weth);
      // the ETH-side legs: v3 one pool at a time, or the single v2 swap
      const legs = (dir) => {
        if (!v3) return [[CMD.V2_SWAP_EXACT_IN, v2swap(ROUTER, CONTRACT_BALANCE, 1n, dir ? [weth, pair] : [pair, weth])]];
        const p = dir ? pairInfo.path : [...pairInfo.path].reverse(), out = [];
        for (let i = 0; i + 2 < p.length; i += 2) out.push([CMD.V3_SWAP_EXACT_IN, v3swap(ROUTER, CONTRACT_BALANCE, 1n, v3path([p[i], p[i + 1], p[i + 2]]))]);
        return out;
      };
      if (buy) {
        const l = legs(true);
        commands = cmds([CMD.WRAP_ETH, ...l.map((x) => x[0]), CMD.V4_SWAP]);
        inputs = [amt(ROUTER, amountIn), ...l.map((x) => x[1]),
          v4([A.SETTLE, A.SWAP_EXACT_IN_SINGLE, A.TAKE_ALL], [AC.encode(['address', 'uint256', 'bool'], [pair, CONTRACT_BALANCE, false]), single(key, true, 0n, minOut), amt(coin, minOut)])];
      } else {
        const l = legs(false);
        commands = cmds([CMD.V4_SWAP, ...l.map((x) => x[0]), CMD.UNWRAP_WETH]);
        inputs = [v4([A.SWAP_EXACT_IN_SINGLE, A.SETTLE_ALL, A.TAKE], [single(key, false, amountIn, 1n), amt(coin, amountIn), AC.encode(['address', 'address', 'uint256'], [pair, ROUTER, 0n])]),
          ...l.map((x) => x[1]), amt(MSG_SENDER, minOut)];
      }
    }
    return UR.encodeFunctionData('execute', [commands, inputs, deadline]);
  }
  // coin -> coin on two of our pools in one swap: coinIn -> native (its pool) -> coinOut (its pool); only the final
  // amount carries the caller's minimum
  function encodeCoinToCoin({ coinIn, coinOut, hook, amountIn, minOut, deadline, hopLayout }) {
    HOP = !!hopLayout; coinIn = X.getAddress(coinIn); coinOut = X.getAddress(coinOut); hook = X.getAddress(hook);
    const path = [[Z, 0, 200, hook, '0x'], [coinOut, 0, 200, hook, '0x']];
    const inputs = [v4([A.SWAP_EXACT_IN, A.SETTLE_ALL, A.TAKE_ALL], [multi(coinIn, path, amountIn, minOut), amt(coinIn, amountIn), amt(coinOut, minOut)])];
    return UR.encodeFunctionData('execute', [cmds([CMD.V4_SWAP]), inputs, deadline]);
  }
  const api = { encode, encodeCoinToCoin };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ROUTES = api;
})(typeof window !== 'undefined' ? window : globalThis);
