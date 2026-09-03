import { HardhatUserConfig } from "hardhat/config";
// Size-optimized build (optimizer runs = 1) used ONLY to deploy the HyperSwap
// launchpad factory into a HyperEVM "small block" (3M gas cap): the runs=400
// build's factory deploy is ~3.015M gas, ~15k over. Runtime semantics are
// identical to the tested build; on HyperEVM (~0.5 gwei) the marginal runtime
// gas is negligible. Kept separate so the tested artifacts stay untouched.
import "@nomicfoundation/hardhat-ethers";
import "@nomicfoundation/hardhat-network-helpers";
import "@nomicfoundation/hardhat-chai-matchers";
import "@nomicfoundation/hardhat-verify";
import * as dotenv from "dotenv";
import { readdirSync, statSync } from "fs";
import { join } from "path";
const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : p.endsWith(".sol") ? [p] : []; });

dotenv.config();
dotenv.config({ path: ".env.deployer" });

const RPC = process.env.ROBINHOOD_RPC_URL ?? "";
const CHAIN = Number(process.env.ROBINHOOD_CHAIN_ID ?? 0);
const PK = process.env.PRIVATE_KEY;

const config: HardhatUserConfig = {
  solidity: {
    compilers: [{ version: "0.8.26", settings: { optimizer: { enabled: true, runs: 1 }, viaIR: true } }],
    // cca overrides: the vendored Uniswap Continuous Clearing Auction keeps its
    // upstream build settings (foundry: runs 11111, cancun for transient storage).
    overrides: Object.fromEntries(
      walk("contracts/cca").map((f) => [
        f.replace(/\\/g, "/"),
        { version: "0.8.26", settings: { optimizer: { enabled: true, runs: 11111 }, evmVersion: "cancun", viaIR: f.endsWith("ContinuousClearingAuctionFactory.sol") } },
      ]),
    ),
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
  // Explorer verification for HyperEVM deploys made with this size-optimized
  // build: settings must match the deploy compile exactly (runs=1, viaIR).
  etherscan: {
    apiKey: { robinhood: process.env.EXPLORER_API_KEY ?? "blockscout" },
    customChains: process.env.EXPLORER_API_URL
      ? [
          {
            network: "robinhood",
            chainId: CHAIN || 999,
            urls: {
              apiURL: process.env.EXPLORER_API_URL,
              browserURL: process.env.EXPLORER_BROWSER_URL ?? process.env.EXPLORER_API_URL,
            },
          },
        ]
      : [],
  },
  sourcify: {
    enabled: true,
    apiUrl: "https://sourcify.dev/server",
    browserUrl: "https://repo.sourcify.dev",
  },
  mocha: { timeout: 180_000 },
};

export default config;
