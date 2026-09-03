/* eslint-disable no-console */
// ONAIR keeper: settles every auction whose end block has passed. Finalize
// creates a HyperSwap V3 pool, so the keeper wallet needs big blocks enabled
// on HyperCore (evmUserModify usingBigBlocks). Idempotent; run it on a schedule.
//
//   KEEPER_KEY=0x... npx ts-node --transpile-only scripts/onair-keeper.ts
//   (or: node scripts/onair-keeper.js after tsc)
import { ethers } from "ethers";

const RPC = process.env.RPC_URL ?? "https://rpc.hyperliquid.xyz/evm";
const FACTORY = process.env.ONAIR_FACTORY ?? "0x469D1F86485720c60e17538cEf44071E4f299ACe";
const HOUSE = process.env.ONAIR_HOUSE ?? "0xad1e5800cde9D3A7aabbfD4D1aD7Ef4ce0941c3e";

const FACTORY_ABI = [
  "function tokenCount() view returns (uint256)",
  "function allTokens(uint256) view returns (address)",
  "function auctions(address) view returns (uint8 mode, bool finalized, bool graduated, uint256 overflowPositionId)",
  "function finalize(address token) returns (address pool)",
];
const HOUSE_ABI = ["function auction(address) view returns (tuple(address token,uint64 startBlock,uint64 endBlock,uint64 lastBlock,uint256 supply,uint256 perBlock,uint256 floorPriceQ96,uint256 tickSpacingQ96,uint256 minRaiseWei,uint256 minBidWei,uint256 clearingQ96,uint256 activeRate,uint256 head,uint256 cumInv192,uint256 raised,uint256 sold,bool finalized,bool graduated,bool cancelled,uint256 collected,uint256 escrow,bool swept))"];

async function main() {
  const key = process.env.KEEPER_KEY;
  if (!key) throw new Error("KEEPER_KEY missing");
  const provider = new ethers.JsonRpcProvider(RPC, 999);
  const wallet = new ethers.Wallet(key, provider);
  const factory = new ethers.Contract(FACTORY, FACTORY_ABI, wallet);
  const house = new ethers.Contract(HOUSE, HOUSE_ABI, provider);
  const head = await provider.getBlockNumber();
  const n = Number(await factory.tokenCount());
  console.log(`keeper ${wallet.address} head ${head} tokens ${n} bal ${ethers.formatEther(await provider.getBalance(wallet.address))}`);
  let settled = 0;
  for (let i = 0; i < n; i++) {
    const token: string = await factory.allTokens(i);
    const [mode, finalized] = await factory.auctions(token);
    if (Number(mode) !== 1 || finalized) continue;
    const a = await house.auction(token);
    const due = a.cancelled || head >= Number(a.endBlock);
    if (!due) { console.log(`${token} running, ${Number(a.endBlock) - head} blocks left`); continue; }
    try {
      const tx = await factory.finalize(token, { gasLimit: 9_000_000 });
      console.log(`${token} finalize ${tx.hash}`);
      const rc = await tx.wait();
      console.log(`${token} settled in block ${rc?.blockNumber}, gas ${rc?.gasUsed}`);
      settled += 1;
    } catch (e: any) {
      console.error(`${token} finalize failed: ${(e.shortMessage ?? e.message ?? String(e)).slice(0, 300)}`);
      process.exitCode = 1;
    }
  }
  console.log(`done, settled ${settled}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
