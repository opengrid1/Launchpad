import { HardhatUserConfig } from "hardhat/config";
// Base mainnet launchpad: build, fork tests and deploy.
//   FORK=1 BASE_RPC_URL=https://base-rpc.publicnode.com npx hardhat --config hardhat.config.basepad.ts test test/v4/basepad.fork.test.ts
import "@nomicfoundation/hardhat-ethers";
import "@nomicfoundation/hardhat-network-helpers";
import "@nomicfoundation/hardhat-chai-matchers";
import "@nomicfoundation/hardhat-verify";
import * as dotenv from "dotenv";

dotenv.config({ path: process.env.DEPLOYER_ENV ?? ".env.basepad-deployer" });

const RPC = process.env.BASE_RPC_URL ?? "https://base-rpc.publicnode.com";
const PK = process.env.PRIVATE_KEY;

const config: HardhatUserConfig = {
  solidity: {
    compilers: [{ version: "0.8.26", settings: { optimizer: { enabled: true, runs: 40 }, viaIR: true, evmVersion: "cancun" } }],
  },
  paths: { sources: "./contracts/v4/basepad", artifacts: "./artifacts-basepad", cache: "./cache-basepad" },
  networks: {
    hardhat: {
      blockGasLimit: 120_000_000,
      ...(process.env.FORK === "1"
        ? { hardfork: "cancun", chains: { 8453: { hardforkHistory: { cancun: 0 } } }, forking: { url: RPC, ...(process.env.FORK_BLOCK ? { blockNumber: Number(process.env.FORK_BLOCK) } : {}) }, chainId: 8453 }
        : {}),
    },
    base: { url: RPC, chainId: 8453, accounts: PK ? [PK] : [], ...(process.env.GAS_PRICE_GWEI ? { gasPrice: Math.round(Number(process.env.GAS_PRICE_GWEI) * 1e9) } : {}) },
  },
  etherscan: { apiKey: process.env.EXPLORER_API_KEY ?? "" },
  mocha: { timeout: 1_200_000 },
};

export default config;
