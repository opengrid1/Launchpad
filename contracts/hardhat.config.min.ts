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

const config: HardhatUserConfig = {
  solidity: {
    compilers: [
      {
        version: "0.8.26",
        settings: {
          optimizer: { enabled: true, runs: 400 },
          viaIR: true,
        },
      },
    ],
    // OpenZeppelin's ERC721 pulls in Strings -> Bytes, which uses MCOPY and so
    // needs the Cancun EVM (Base runs it). Hardhat compiles every file in the
    // import graph under its own settings, so the override lists the Basket
    // NFT and the three library files on that path. Every other contract's
    // bytecode is unchanged.
    overrides: Object.fromEntries(
      [
        "contracts/v4/basket/BasketNFT.sol",
        "@openzeppelin/contracts/token/ERC721/ERC721.sol",
        "@openzeppelin/contracts/utils/Strings.sol",
        "@openzeppelin/contracts/utils/Bytes.sol",
      ].map((file) => [
        file,
        {
          version: "0.8.26",
          settings: { optimizer: { enabled: true, runs: 400 }, viaIR: true, evmVersion: "cancun" },
        },
      ]),
    ),
  },
  networks: {
    hardhat: {
      allowUnlimitedContractSize: false,
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
  },
  mocha: { timeout: 180_000 },
};

export default config;
