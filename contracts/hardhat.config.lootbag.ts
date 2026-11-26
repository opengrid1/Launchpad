import { HardhatUserConfig } from "hardhat/config";
// Lootbag (Base): build, fork tests and deploy.
//   FORK=1 BASE_RPC_URL=https://mainnet.base.org npx hardhat --config hardhat.config.lootbag.ts test test/v4/lootbag.fork.test.ts
import "@nomicfoundation/hardhat-ethers";
import "@nomicfoundation/hardhat-network-helpers";
import "@nomicfoundation/hardhat-chai-matchers";
import "@nomicfoundation/hardhat-verify";
import * as dotenv from "dotenv";

dotenv.config({ path: process.env.DEPLOYER_ENV ?? ".env.lootbag-deployer" });

const RPC = process.env.BASE_RPC_URL ?? "https://mainnet.base.org";
const PK = process.env.PRIVATE_KEY;

const config: HardhatUserConfig = {
  solidity: {
    compilers: [{ version: "0.8.26", settings: { optimizer: { enabled: true, runs: 40 }, viaIR: true, evmVersion: "cancun" } }],
  },
  paths: { sources: "./contracts/v4/lootbag", artifacts: "./artifacts-lootbag", cache: "./cache-lootbag" },
  networks: {
    hardhat: {
      blockGasLimit: 16_777_216, // per-transaction cap (EIP-7825)
      ...(process.env.FORK === "1"
        ? { hardfork: "cancun", chains: { 8453: { hardforkHistory: { cancun: 0 } } }, forking: { url: RPC, ...(process.env.FORK_BLOCK ? { blockNumber: Number(process.env.FORK_BLOCK) } : {}) }, chainId: 8453 }
        : {}),
    },
    base: { url: RPC, chainId: 8453, accounts: PK ? [PK] : [], ...(process.env.GAS_PRICE_GWEI ? { gasPrice: Math.round(Number(process.env.GAS_PRICE_GWEI) * 1e9) } : {}) },
  },
  // Base verification via the Etherscan V2 unified endpoint (chainid 8453)
  etherscan: {
    apiKey: process.env.EXPLORER_API_KEY ?? "",
    customChains: [{ network: "base", chainId: 8453, urls: { apiURL: "https://api.etherscan.io/v2/api?chainid=8453", browserURL: "https://basescan.org" } }],
  },
  mocha: { timeout: 1_200_000 },
};

export default config;
