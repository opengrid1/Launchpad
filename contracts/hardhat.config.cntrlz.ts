import { HardhatUserConfig } from "hardhat/config";
// cntrl-z (Ethereum mainnet): build, fork tests and deploy.
//   FORK=1 ETH_RPC_URL=https://ethereum-rpc.publicnode.com npx hardhat --config hardhat.config.backstop.ts test test/v4/backstop.fork.test.ts
import "@nomicfoundation/hardhat-ethers";
import "@nomicfoundation/hardhat-network-helpers";
import "@nomicfoundation/hardhat-chai-matchers";
import "@nomicfoundation/hardhat-verify";
import * as dotenv from "dotenv";

dotenv.config({ path: process.env.DEPLOYER_ENV ?? ".env.cntrlz-deployer" });

const RPC = process.env.ETH_RPC_URL ?? "https://ethereum-rpc.publicnode.com";
const PK = process.env.PRIVATE_KEY;

const config: HardhatUserConfig = {
  solidity: {
    compilers: [{ version: "0.8.26", settings: { optimizer: { enabled: true, runs: 40 }, viaIR: true, evmVersion: "cancun" } }],
  },
  paths: { sources: "./contracts/v4/cntrlz", artifacts: "./artifacts-cntrlz", cache: "./cache-cntrlz" },
  networks: {
    hardhat: {
      blockGasLimit: 16_777_216, // the per-transaction cap (EIP-7825); calls default to the block limit
      ...(process.env.FORK === "1"
        ? { hardfork: "cancun", chains: { 1: { hardforkHistory: { cancun: 0 } } }, forking: { url: RPC, ...(process.env.FORK_BLOCK ? { blockNumber: Number(process.env.FORK_BLOCK) } : {}) }, chainId: 1 }
        : {}),
    },
    // GAS_PRICE_GWEI pins a fixed price; otherwise the default tip (1 gwei) can cost several times the base fee
    mainnet: { url: RPC, chainId: 1, accounts: PK ? [PK] : [], ...(process.env.GAS_PRICE_GWEI ? { gasPrice: Math.round(Number(process.env.GAS_PRICE_GWEI) * 1e9) } : {}) },
  },
  etherscan: { apiKey: process.env.EXPLORER_API_KEY ?? "" },
  mocha: { timeout: 1_200_000 },
};

export default config;
