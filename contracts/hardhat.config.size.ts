import { HardhatUserConfig } from "hardhat/config";
// Size-optimized build (optimizer runs = 1) used ONLY to deploy the HyperSwap
// launchpad factory into a HyperEVM "small block" (3M gas cap): the runs=400
// build's factory deploy is ~3.015M gas, ~15k over. Runtime semantics are
// identical to the tested build; on HyperEVM (~0.5 gwei) the marginal runtime
// gas is negligible. Kept separate so the tested artifacts stay untouched.
import "@nomicfoundation/hardhat-ethers";
import "@nomicfoundation/hardhat-network-helpers";
import "@nomicfoundation/hardhat-chai-matchers";
import * as dotenv from "dotenv";

dotenv.config();
dotenv.config({ path: ".env.deployer" });

const RPC = process.env.ROBINHOOD_RPC_URL ?? "";
const CHAIN = Number(process.env.ROBINHOOD_CHAIN_ID ?? 0);
const PK = process.env.PRIVATE_KEY;

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.26",
    settings: { optimizer: { enabled: true, runs: 1 }, viaIR: true },
  },
  paths: { artifacts: "./artifacts-size" },
  networks: {
    hardhat: {
      allowUnlimitedContractSize: false,
      blockGasLimit: Number(process.env.BLOCK_GAS_LIMIT ?? 100_000_000),
      ...(process.env.FORK === "1" && RPC
        ? {
            hardfork: process.env.FORK_HARDFORK ?? "cancun",
            chains: { [CHAIN || 999]: { hardforkHistory: { [process.env.FORK_HARDFORK ?? "cancun"]: 0 } } },
            forking: { url: RPC },
            chainId: CHAIN || undefined,
          }
        : {}),
    },
    ...(RPC ? { robinhood: { url: RPC, chainId: CHAIN || undefined, accounts: PK ? [PK] : [] } } : {}),
  },
  mocha: { timeout: 180_000 },
};

export default config;
