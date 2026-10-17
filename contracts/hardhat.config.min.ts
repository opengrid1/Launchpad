import { HardhatUserConfig } from "hardhat/config";
// Minimal config: skip the full hardhat-toolbox (its ignition chain is broken
// in this environment) and load only what compile + fork-tests need.
import "@nomicfoundation/hardhat-ethers";
import "@nomicfoundation/hardhat-network-helpers";
import "@nomicfoundation/hardhat-chai-matchers";
import * as dotenv from "dotenv";

dotenv.config();
dotenv.config({ path: ".env.deployer" });

const ROBINHOOD_RPC_URL = process.env.ROBINHOOD_RPC_URL ?? "";
const ROBINHOOD_CHAIN_ID = Number(process.env.ROBINHOOD_CHAIN_ID ?? 0);
const PRIVATE_KEY = process.env.PRIVATE_KEY;

// OneHook (Ethereum mainnet) uses transient storage, so it targets the Cancun
// EVM; the rest of the repo stays on the default target for the chains that
// lack those opcodes. Optimizer runs mirror the verified mainnet build.
const ONEHOOK_FILES = [
  "IOneOracle.sol",
  "OneToken.sol",
  "OneDivToken.sol",
  "OneTokenDeployer.sol",
  "OneHook.sol",
  "OneFactory.sol",
  "OneRouter.sol",
  "mocks/MockOneOracle.sol",
].map((f) => `contracts/v4/onehook/${f}`);
const ONEHOOK_COMPILER = {
  version: "0.8.26",
  settings: { optimizer: { enabled: true, runs: 40 }, viaIR: true, evmVersion: "cancun" },
};
const ETH_RPC_URL = process.env.ETH_RPC_URL ?? "https://ethereum-rpc.publicnode.com";

const config: HardhatUserConfig = {
  solidity: {
    compilers: [
      {
        version: "0.8.26",
        settings: {
          optimizer: { enabled: true, runs: 400 },
          viaIR: true,
          // OpenZeppelin 5.6 (pinned by the lockfile) emits MCOPY in Math.sol,
          // which every v4 factory imports, so the whole tree must target Cancun.
          // Ethereum, Base and Arbitrum Orbit (Robinhood) all run Cancun.
          evmVersion: "cancun",
        },
      },
    ],
    overrides: Object.fromEntries(ONEHOOK_FILES.map((f) => [f, ONEHOOK_COMPILER])),
  },
  networks: {
    hardhat: {
      allowUnlimitedContractSize: false,
      // Local runs execute the Cancun opcodes OneHook needs.
      hardfork: process.env.FORK_HARDFORK ?? "cancun",
      ...(process.env.FORK === "1" && ROBINHOOD_RPC_URL
        ? {
            hardfork: process.env.FORK_HARDFORK ?? "cancun",
            // A standalone `hardhat node` executes reads at the historical fork
            // block, which needs a hardfork-activation history for the forked
            // chain. Treat all of Base's history as cancun so those reads run.
            chains: {
              [ROBINHOOD_CHAIN_ID || 8453]: {
                hardforkHistory: { [process.env.FORK_HARDFORK ?? "cancun"]: 0 },
              },
            },
            forking: {
              url: ROBINHOOD_RPC_URL,
              ...(process.env.BASE_FORK_BLOCK ? { blockNumber: Number(process.env.BASE_FORK_BLOCK) } : {}),
            },
            chainId: ROBINHOOD_CHAIN_ID || undefined,
          }
        : {}),
    },
    ...(ROBINHOOD_RPC_URL
      ? {
          robinhood: {
            url: ROBINHOOD_RPC_URL,
            chainId: ROBINHOOD_CHAIN_ID || undefined,
            accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
          },
        }
      : {}),
    // Ethereum mainnet: the OneHook deployment target.
    mainnet: {
      url: ETH_RPC_URL,
      chainId: 1,
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
    },
  },
  mocha: { timeout: 180_000 },
};

export default config;
