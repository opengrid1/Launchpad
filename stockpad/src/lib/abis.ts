// Generated from the compiled StockPad contracts (artifacts-size). Do not edit by hand.

export const factoryAbi = [
 {
  "inputs": [
   {
    "internalType": "address",
    "name": "owner_",
    "type": "address"
   },
   {
    "internalType": "address",
    "name": "admin_",
    "type": "address"
   },
   {
    "internalType": "contract IPoolManager",
    "name": "poolManager_",
    "type": "address"
   },
   {
    "internalType": "contract StockPadHook",
    "name": "hook_",
    "type": "address"
   },
   {
    "internalType": "address",
    "name": "weth_",
    "type": "address"
   },
   {
    "internalType": "uint64",
    "name": "ethUsd8_",
    "type": "uint64"
   },
   {
    "internalType": "uint16",
    "name": "taxBps_",
    "type": "uint16"
   },
   {
    "internalType": "uint16",
    "name": "creatorBps_",
    "type": "uint16"
   },
   {
    "internalType": "uint16",
    "name": "holderBps_",
    "type": "uint16"
   }
  ],
  "stateMutability": "nonpayable",
  "type": "constructor"
 },
 {
  "inputs": [],
  "name": "InvalidParams",
  "type": "error"
 },
 {
  "inputs": [],
  "name": "LaunchesPaused",
  "type": "error"
 },
 {
  "inputs": [],
  "name": "NoPrice",
  "type": "error"
 },
 {
  "inputs": [],
  "name": "NotAdmin",
  "type": "error"
 },
 {
  "inputs": [
   {
    "internalType": "address",
    "name": "owner",
    "type": "address"
   }
  ],
  "name": "OwnableInvalidOwner",
  "type": "error"
 },
 {
  "inputs": [
   {
    "internalType": "address",
    "name": "account",
    "type": "address"
   }
  ],
  "name": "OwnableUnauthorizedAccount",
  "type": "error"
 },
 {
  "inputs": [],
  "name": "QuoteNotApproved",
  "type": "error"
 },
 {
  "inputs": [],
  "name": "ReentrancyGuardReentrantCall",
  "type": "error"
 },
 {
  "inputs": [
   {
    "internalType": "address",
    "name": "token",
    "type": "address"
   }
  ],
  "name": "SafeERC20FailedOperation",
  "type": "error"
 },
 {
  "inputs": [],
  "name": "ZeroAddress",
  "type": "error"
 },
 {
  "anonymous": false,
  "inputs": [
   {
    "indexed": true,
    "internalType": "address",
    "name": "converter",
    "type": "address"
   }
  ],
  "name": "ConverterSet",
  "type": "event"
 },
 {
  "anonymous": false,
  "inputs": [
   {
    "indexed": true,
    "internalType": "address",
    "name": "token",
    "type": "address"
   },
   {
    "indexed": true,
    "internalType": "address",
    "name": "creator",
    "type": "address"
   },
   {
    "indexed": false,
    "internalType": "uint256",
    "name": "ethIn",
    "type": "uint256"
   },
   {
    "indexed": false,
    "internalType": "uint256",
    "name": "pairIn",
    "type": "uint256"
   },
   {
    "indexed": false,
    "internalType": "uint256",
    "name": "coinOut",
    "type": "uint256"
   }
  ],
  "name": "DevBought",
  "type": "event"
 },
 {
  "anonymous": false,
  "inputs": [
   {
    "indexed": true,
    "internalType": "address",
    "name": "recipient",
    "type": "address"
   }
  ],
  "name": "FeeRecipientSet",
  "type": "event"
 },
 {
  "anonymous": false,
  "inputs": [
   {
    "indexed": true,
    "internalType": "address",
    "name": "token",
    "type": "address"
   },
   {
    "indexed": true,
    "internalType": "address",
    "name": "creator",
    "type": "address"
   },
   {
    "indexed": true,
    "internalType": "address",
    "name": "pair",
    "type": "address"
   },
   {
    "indexed": false,
    "internalType": "uint16",
    "name": "taxBps",
    "type": "uint16"
   },
   {
    "indexed": false,
    "internalType": "bytes32",
    "name": "poolId",
    "type": "bytes32"
   },
   {
    "indexed": false,
    "internalType": "uint256",
    "name": "pairUsdPrice8",
    "type": "uint256"
   }
  ],
  "name": "Launched",
  "type": "event"
 },
 {
  "anonymous": false,
  "inputs": [
   {
    "indexed": false,
    "internalType": "bool",
    "name": "paused",
    "type": "bool"
   }
  ],
  "name": "LaunchesPausedSet",
  "type": "event"
 },
 {
  "anonymous": false,
  "inputs": [
   {
    "indexed": true,
    "internalType": "address",
    "name": "previousOwner",
    "type": "address"
   },
   {
    "indexed": true,
    "internalType": "address",
    "name": "newOwner",
    "type": "address"
   }
  ],
  "name": "OwnershipTransferred",
  "type": "event"
 },
 {
  "anonymous": false,
  "inputs": [
   {
    "indexed": true,
    "internalType": "address",
    "name": "pair",
    "type": "address"
   },
   {
    "indexed": false,
    "internalType": "bool",
    "name": "approved",
    "type": "bool"
   },
   {
    "indexed": false,
    "internalType": "uint64",
    "name": "usdPrice8",
    "type": "uint64"
   },
   {
    "indexed": false,
    "internalType": "address",
    "name": "feed",
    "type": "address"
   }
  ],
  "name": "QuoteAssetSet",
  "type": "event"
 },
 {
  "anonymous": false,
  "inputs": [
   {
    "indexed": true,
    "internalType": "address",
    "name": "asset",
    "type": "address"
   },
   {
    "indexed": false,
    "internalType": "uint256",
    "name": "amount",
    "type": "uint256"
   },
   {
    "indexed": true,
    "internalType": "address",
    "name": "to",
    "type": "address"
   }
  ],
  "name": "Recovered",
  "type": "event"
 },
 {
  "inputs": [],
  "name": "CREATOR_BPS",
  "outputs": [
   {
    "internalType": "uint16",
    "name": "",
    "type": "uint16"
   }
  ],
  "stateMutability": "view",
  "type": "function"
 },
 {
  "inputs": [],
  "name": "FEED_MAX_AGE",
  "outputs": [
   {
    "internalType": "uint256",
    "name": "",
    "type": "uint256"
   }
  ],
  "stateMutability": "view",
  "type": "function"
 },
 {
  "inputs": [],
  "name": "HOLDER_BPS",
  "outputs": [
   {
    "internalType": "uint16",
    "name": "",
    "type": "uint16"
   }
  ],
  "stateMutability": "view",
  "type": "function"
 },
 {
  "inputs": [],
  "name": "INITIAL_MARKET_CAP_USD_8",
  "outputs": [
   {
    "internalType": "uint256",
    "name": "",
    "type": "uint256"
   }
  ],
  "stateMutability": "view",
  "type": "function"
 },
 {
  "inputs": [],
  "name": "LP_FEE",
  "outputs": [
   {
    "internalType": "uint24",
    "name": "",
    "type": "uint24"
   }
  ],
  "stateMutability": "view",
  "type": "function"
 },
 {
  "inputs": [],
  "name": "TAX_BPS",
  "outputs": [
   {
    "internalType": "uint16",
    "name": "",
    "type": "uint16"
   }
  ],
  "stateMutability": "view",
  "type": "function"
 },
 {
  "inputs": [],
  "name": "TICK_SPACING",
  "outputs": [
   {
    "internalType": "int24",
    "name": "",
    "type": "int24"
   }
  ],
  "stateMutability": "view",
  "type": "function"
 },
 {
  "inputs": [],
  "name": "TOTAL_SUPPLY",
  "outputs": [
   {
    "internalType": "uint256",
    "name": "",
    "type": "uint256"
   }
  ],
  "stateMutability": "view",
  "type": "function"
 },
 {
  "inputs": [],
  "name": "TOTAL_SUPPLY_WHOLE",
  "outputs": [
   {
    "internalType": "uint256",
    "name": "",
    "type": "uint256"
   }
  ],
  "stateMutability": "view",
  "type": "function"
 },
 {
  "inputs": [],
  "name": "admin",
  "outputs": [
   {
    "internalType": "address",
    "name": "",
    "type": "address"
   }
  ],
  "stateMutability": "view",
  "type": "function"
 },
 {
  "inputs": [
   {
    "internalType": "uint256",
    "name": "",
    "type": "uint256"
   }
  ],
  "name": "allTokens",
  "outputs": [
   {
    "internalType": "address",
    "name": "",
    "type": "address"
   }
  ],
  "stateMutability": "view",
  "type": "function"
 },
 {
  "inputs": [],
  "name": "converter",
  "outputs": [
   {
    "internalType": "address",
    "name": "",
    "type": "address"
   }
  ],
  "stateMutability": "view",
  "type": "function"
 },
 {
  "inputs": [],
  "name": "feeRecipient",
  "outputs": [
   {
    "internalType": "address",
    "name": "",
    "type": "address"
   }
  ],
  "stateMutability": "view",
  "type": "function"
 },
 {
  "inputs": [],
  "name": "hook",
  "outputs": [
   {
    "internalType": "contract StockPadHook",
    "name": "",
    "type": "address"
   }
  ],
  "stateMutability": "view",
  "type": "function"
 },
 {
  "inputs": [
   {
    "components": [
     {
      "internalType": "string",
      "name": "name",
      "type": "string"
     },
     {
      "internalType": "string",
      "name": "symbol",
      "type": "string"
     },
     {
      "internalType": "string",
      "name": "metadataURI",
      "type": "string"
     },
     {
      "internalType": "address",
      "name": "pair",
      "type": "address"
     }
    ],
    "internalType": "struct StockPadFactory.LaunchParams",
    "name": "p",
    "type": "tuple"
   },
   {
    "internalType": "bytes32",
    "name": "salt",
    "type": "bytes32"
   },
   {
    "internalType": "bytes",
    "name": "route",
    "type": "bytes"
   }
  ],
  "name": "launch",
  "outputs": [
   {
    "internalType": "address",
    "name": "token",
    "type": "address"
   },
   {
    "internalType": "bytes32",
    "name": "poolId",
    "type": "bytes32"
   }
  ],
  "stateMutability": "payable",
  "type": "function"
 },
 {
  "inputs": [],
  "name": "launchesPaused",
  "outputs": [
   {
    "internalType": "bool",
    "name": "",
    "type": "bool"
   }
  ],
  "stateMutability": "view",
  "type": "function"
 },
 {
  "inputs": [
   {
    "internalType": "address",
    "name": "token",
    "type": "address"
   }
  ],
  "name": "listings",
  "outputs": [
   {
    "internalType": "address",
    "name": "creator",
    "type": "address"
   },
   {
    "internalType": "address",
    "name": "pair",
    "type": "address"
   },
   {
    "internalType": "uint16",
    "name": "taxBps",
    "type": "uint16"
   },
   {
    "internalType": "uint64",
    "name": "createdAt",
    "type": "uint64"
   },
   {
    "internalType": "bytes32",
    "name": "poolId",
    "type": "bytes32"
   }
  ],
  "stateMutability": "view",
  "type": "function"
 },
 {
  "inputs": [],
  "name": "owner",
  "outputs": [
   {
    "internalType": "address",
    "name": "",
    "type": "address"
   }
  ],
  "stateMutability": "view",
  "type": "function"
 },
 {
  "inputs": [
   {
    "internalType": "address",
    "name": "pair",
    "type": "address"
   }
  ],
  "name": "pairUsdPrice",
  "outputs": [
   {
    "internalType": "uint256",
    "name": "",
    "type": "uint256"
   }
  ],
  "stateMutability": "view",
  "type": "function"
 },
 {
  "inputs": [],
  "name": "pause",
  "outputs": [],
  "stateMutability": "nonpayable",
  "type": "function"
 },
 {
  "inputs": [
   {
    "internalType": "address",
    "name": "token",
    "type": "address"
   }
  ],
  "name": "poolKeyOf",
  "outputs": [
   {
    "components": [
     {
      "internalType": "Currency",
      "name": "currency0",
      "type": "address"
     },
     {
      "internalType": "Currency",
      "name": "currency1",
      "type": "address"
     },
     {
      "internalType": "uint24",
      "name": "fee",
      "type": "uint24"
     },
     {
      "internalType": "int24",
      "name": "tickSpacing",
      "type": "int24"
     },
     {
      "internalType": "contract IHooks",
      "name": "hooks",
      "type": "address"
     }
    ],
    "internalType": "struct PoolKey",
    "name": "key",
    "type": "tuple"
   }
  ],
  "stateMutability": "view",
  "type": "function"
 },
 {
  "inputs": [],
  "name": "poolManager",
  "outputs": [
   {
    "internalType": "contract IPoolManager",
    "name": "",
    "type": "address"
   }
  ],
  "stateMutability": "view",
  "type": "function"
 },
 {
  "inputs": [
   {
    "internalType": "address",
    "name": "token",
    "type": "address"
   }
  ],
  "name": "positions",
  "outputs": [
   {
    "internalType": "int24",
    "name": "tickLower",
    "type": "int24"
   },
   {
    "internalType": "int24",
    "name": "tickUpper",
    "type": "int24"
   },
   {
    "internalType": "uint128",
    "name": "liquidity",
    "type": "uint128"
   }
  ],
  "stateMutability": "view",
  "type": "function"
 },
 {
  "inputs": [
   {
    "internalType": "address[]",
    "name": "tokens",
    "type": "address[]"
   }
  ],
  "name": "pushPlatformFees",
  "outputs": [],
  "stateMutability": "nonpayable",
  "type": "function"
 },
 {
  "inputs": [
   {
    "internalType": "address",
    "name": "",
    "type": "address"
   }
  ],
  "name": "quoteAssets",
  "outputs": [
   {
    "internalType": "bool",
    "name": "approved",
    "type": "bool"
   },
   {
    "internalType": "uint64",
    "name": "usdPrice8",
    "type": "uint64"
   },
   {
    "internalType": "address",
    "name": "feed",
    "type": "address"
   }
  ],
  "stateMutability": "view",
  "type": "function"
 },
 {
  "inputs": [],
  "name": "quoteCount",
  "outputs": [
   {
    "internalType": "uint256",
    "name": "",
    "type": "uint256"
   }
  ],
  "stateMutability": "view",
  "type": "function"
 },
 {
  "inputs": [
   {
    "internalType": "uint256",
    "name": "",
    "type": "uint256"
   }
  ],
  "name": "quoteList",
  "outputs": [
   {
    "internalType": "address",
    "name": "",
    "type": "address"
   }
  ],
  "stateMutability": "view",
  "type": "function"
 },
 {
  "inputs": [
   {
    "internalType": "address",
    "name": "asset",
    "type": "address"
   },
   {
    "internalType": "uint256",
    "name": "amount",
    "type": "uint256"
   }
  ],
  "name": "recoverERC20",
  "outputs": [],
  "stateMutability": "nonpayable",
  "type": "function"
 },
 {
  "inputs": [],
  "name": "renounceOwnership",
  "outputs": [],
  "stateMutability": "nonpayable",
  "type": "function"
 },
 {
  "inputs": [],
  "name": "resume",
  "outputs": [],
  "stateMutability": "nonpayable",
  "type": "function"
 },
 {
  "inputs": [
   {
    "internalType": "address",
    "name": "converter_",
    "type": "address"
   }
  ],
  "name": "setConverter",
  "outputs": [],
  "stateMutability": "nonpayable",
  "type": "function"
 },
 {
  "inputs": [
   {
    "internalType": "address",
    "name": "recipient",
    "type": "address"
   }
  ],
  "name": "setFeeRecipient",
  "outputs": [],
  "stateMutability": "nonpayable",
  "type": "function"
 },
 {
  "inputs": [
   {
    "internalType": "address",
    "name": "pair",
    "type": "address"
   },
   {
    "internalType": "bool",
    "name": "approved",
    "type": "bool"
   },
   {
    "internalType": "uint64",
    "name": "usdPrice8",
    "type": "uint64"
   },
   {
    "internalType": "address",
    "name": "feed",
    "type": "address"
   }
  ],
  "name": "setQuoteAsset",
  "outputs": [],
  "stateMutability": "nonpayable",
  "type": "function"
 },
 {
  "inputs": [
   {
    "internalType": "address",
    "name": "creator",
    "type": "address"
   }
  ],
  "name": "tokensByCreator",
  "outputs": [
   {
    "internalType": "address[]",
    "name": "",
    "type": "address[]"
   }
  ],
  "stateMutability": "view",
  "type": "function"
 },
 {
  "inputs": [],
  "name": "totalTokens",
  "outputs": [
   {
    "internalType": "uint256",
    "name": "",
    "type": "uint256"
   }
  ],
  "stateMutability": "view",
  "type": "function"
 },
 {
  "inputs": [
   {
    "internalType": "address",
    "name": "newOwner",
    "type": "address"
   }
  ],
  "name": "transferOwnership",
  "outputs": [],
  "stateMutability": "nonpayable",
  "type": "function"
 },
 {
  "inputs": [
   {
    "internalType": "bytes",
    "name": "data",
    "type": "bytes"
   }
  ],
  "name": "unlockCallback",
  "outputs": [
   {
    "internalType": "bytes",
    "name": "",
    "type": "bytes"
   }
  ],
  "stateMutability": "nonpayable",
  "type": "function"
 },
 {
  "inputs": [],
  "name": "weth",
  "outputs": [
   {
    "internalType": "address",
    "name": "",
    "type": "address"
   }
  ],
  "stateMutability": "view",
  "type": "function"
 },
 {
  "stateMutability": "payable",
  "type": "receive"
 }
] as const;

export const tokenAbi = [
 {
  "inputs": [
   {
    "internalType": "string",
    "name": "name_",
    "type": "string"
   },
   {
    "internalType": "string",
    "name": "symbol_",
    "type": "string"
   },
   {
    "internalType": "string",
    "name": "metadataURI_",
    "type": "string"
   },
   {
    "internalType": "uint256",
    "name": "supply_",
    "type": "uint256"
   },
   {
    "internalType": "address",
    "name": "creator_",
    "type": "address"
   },
   {
    "internalType": "address",
    "name": "factory_",
    "type": "address"
   },
   {
    "internalType": "address",
    "name": "pairAsset_",
    "type": "address"
   },
   {
    "internalType": "address",
    "name": "poolManager_",
    "type": "address"
   },
   {
    "internalType": "uint16",
    "name": "creatorBps_",
    "type": "uint16"
   },
   {
    "internalType": "uint16",
    "name": "holderBps_",
    "type": "uint16"
   }
  ],
  "stateMutability": "nonpayable",
  "type": "constructor"
 },
 {
  "inputs": [],
  "name": "AlreadyInit",
  "type": "error"
 },
 {
  "inputs": [],
  "name": "BuyCap",
  "type": "error"
 },
 {
  "inputs": [
   {
    "internalType": "address",
    "name": "spender",
    "type": "address"
   },
   {
    "internalType": "uint256",
    "name": "allowance",
    "type": "uint256"
   },
   {
    "internalType": "uint256",
    "name": "needed",
    "type": "uint256"
   }
  ],
  "name": "ERC20InsufficientAllowance",
  "type": "error"
 },
 {
  "inputs": [
   {
    "internalType": "address",
    "name": "sender",
    "type": "address"
   },
   {
    "internalType": "uint256",
    "name": "balance",
    "type": "uint256"
   },
   {
    "internalType": "uint256",
    "name": "needed",
    "type": "uint256"
   }
  ],
  "name": "ERC20InsufficientBalance",
  "type": "error"
 },
 {
  "inputs": [
   {
    "internalType": "address",
    "name": "approver",
    "type": "address"
   }
  ],
  "name": "ERC20InvalidApprover",
  "type": "error"
 },
 {
  "inputs": [
   {
    "internalType": "address",
    "name": "receiver",
    "type": "address"
   }
  ],
  "name": "ERC20InvalidReceiver",
  "type": "error"
 },
 {
  "inputs": [
   {
    "internalType": "address",
    "name": "sender",
    "type": "address"
   }
  ],
  "name": "ERC20InvalidSender",
  "type": "error"
 },
 {
  "inputs": [
   {
    "internalType": "address",
    "name": "spender",
    "type": "address"
   }
  ],
  "name": "ERC20InvalidSpender",
  "type": "error"
 },
 {
  "inputs": [],
  "name": "HoldCap",
  "type": "error"
 },
 {
  "inputs": [],
  "name": "LaunchGuard",
  "type": "error"
 },
 {
  "inputs": [],
  "name": "NoConverter",
  "type": "error"
 },
 {
  "inputs": [],
  "name": "OnlyCreator",
  "type": "error"
 },
 {
  "inputs": [],
  "name": "OnlyFactory",
  "type": "error"
 },
 {
  "inputs": [],
  "name": "OnlyHook",
  "type": "error"
 },
 {
  "inputs": [],
  "name": "ReentrancyGuardReentrantCall",
  "type": "error"
 },
 {
  "inputs": [
   {
    "internalType": "address",
    "name": "token",
    "type": "address"
   }
  ],
  "name": "SafeERC20FailedOperation",
  "type": "error"
 },
 {
  "anonymous": false,
  "inputs": [
   {
    "indexed": true,
    "internalType": "address",
    "name": "owner",
    "type": "address"
   },
   {
    "indexed": true,
    "internalType": "address",
    "name": "spender",
    "type": "address"
   },
   {
    "indexed": false,
    "internalType": "uint256",
    "name": "value",
    "type": "uint256"
   }
  ],
  "name": "Approval",
  "type": "event"
 },
 {
  "anonymous": false,
  "inputs": [
   {
    "indexed": true,
    "internalType": "address",
    "name": "creator",
    "type": "address"
   },
   {
    "indexed": false,
    "internalType": "uint256",
    "name": "amount",
    "type": "uint256"
   },
   {
    "indexed": false,
    "internalType": "bool",
    "name": "asEth",
    "type": "bool"
   }
  ],
  "name": "CreatorFeesClaimed",
  "type": "event"
 },
 {
  "anonymous": false,
  "inputs": [
   {
    "indexed": true,
    "internalType": "address",
    "name": "account",
    "type": "address"
   },
   {
    "indexed": false,
    "internalType": "bool",
    "name": "excluded",
    "type": "bool"
   }
  ],
  "name": "ExcludedSet",
  "type": "event"
 },
 {
  "anonymous": false,
  "inputs": [
   {
    "indexed": false,
    "internalType": "uint256",
    "name": "holderAmount",
    "type": "uint256"
   },
   {
    "indexed": false,
    "internalType": "uint256",
    "name": "creatorAmount",
    "type": "uint256"
   },
   {
    "indexed": false,
    "internalType": "uint256",
    "name": "platformAmount",
    "type": "uint256"
   }
  ],
  "name": "FeesAccrued",
  "type": "event"
 },
 {
  "anonymous": false,
  "inputs": [
   {
    "indexed": true,
    "internalType": "address",
    "name": "hook",
    "type": "address"
   },
   {
    "indexed": true,
    "internalType": "address",
    "name": "converter",
    "type": "address"
   }
  ],
  "name": "HookSet",
  "type": "event"
 },
 {
  "anonymous": false,
  "inputs": [
   {
    "indexed": true,
    "internalType": "address",
    "name": "recipient",
    "type": "address"
   },
   {
    "indexed": false,
    "internalType": "uint256",
    "name": "amount",
    "type": "uint256"
   }
  ],
  "name": "PlatformFeesClaimed",
  "type": "event"
 },
 {
  "anonymous": false,
  "inputs": [
   {
    "indexed": true,
    "internalType": "address",
    "name": "holder",
    "type": "address"
   },
   {
    "indexed": false,
    "internalType": "uint256",
    "name": "amount",
    "type": "uint256"
   },
   {
    "indexed": false,
    "internalType": "bool",
    "name": "asEth",
    "type": "bool"
   }
  ],
  "name": "RewardsClaimed",
  "type": "event"
 },
 {
  "anonymous": false,
  "inputs": [
   {
    "indexed": true,
    "internalType": "address",
    "name": "from",
    "type": "address"
   },
   {
    "indexed": true,
    "internalType": "address",
    "name": "to",
    "type": "address"
   },
   {
    "indexed": false,
    "internalType": "uint256",
    "name": "value",
    "type": "uint256"
   }
  ],
  "name": "Transfer",
  "type": "event"
 },
 {
  "inputs": [],
  "name": "MAX_BUY_BPS",
  "outputs": [
   {
    "internalType": "uint16",
    "name": "",
    "type": "uint16"
   }
  ],
  "stateMutability": "view",
  "type": "function"
 },
 {
  "inputs": [],
  "name": "MAX_HOLD_BPS",
  "outputs": [
   {
    "internalType": "uint16",
    "name": "",
    "type": "uint16"
   }
  ],
  "stateMutability": "view",
  "type": "function"
 },
 {
  "inputs": [],
  "name": "PROTECT_BLOCKS",
  "outputs": [
   {
    "internalType": "uint256",
    "name": "",
    "type": "uint256"
   }
  ],
  "stateMutability": "view",
  "type": "function"
 },
 {
  "inputs": [
   {
    "internalType": "uint256",
    "name": "fee",
    "type": "uint256"
   },
   {
    "internalType": "uint256",
    "name": "extra",
    "type": "uint256"
   }
  ],
  "name": "accrue",
  "outputs": [],
  "stateMutability": "nonpayable",
  "type": "function"
 },
 {
  "inputs": [
   {
    "internalType": "address",
    "name": "owner",
    "type": "address"
   },
   {
    "internalType": "address",
    "name": "spender",
    "type": "address"
   }
  ],
  "name": "allowance",
  "outputs": [
   {
    "internalType": "uint256",
    "name": "",
    "type": "uint256"
   }
  ],
  "stateMutability": "view",
  "type": "function"
 },
 {
  "inputs": [
   {
    "internalType": "address",
    "name": "spender",
    "type": "address"
   },
   {
    "internalType": "uint256",
    "name": "value",
    "type": "uint256"
   }
  ],
  "name": "approve",
  "outputs": [
   {
    "internalType": "bool",
    "name": "",
    "type": "bool"
   }
  ],
  "stateMutability": "nonpayable",
  "type": "function"
 },
 {
  "inputs": [
   {
    "internalType": "address",
    "name": "account",
    "type": "address"
   }
  ],
  "name": "balanceOf",
  "outputs": [
   {
    "internalType": "uint256",
    "name": "",
    "type": "uint256"
   }
  ],
  "stateMutability": "view",
  "type": "function"
 },
 {
  "inputs": [
   {
    "internalType": "uint256",
    "name": "amount",
    "type": "uint256"
   }
  ],
  "name": "burn",
  "outputs": [],
  "stateMutability": "nonpayable",
  "type": "function"
 },
 {
  "inputs": [
   {
    "internalType": "bool",
    "name": "asEth",
    "type": "bool"
   },
   {
    "internalType": "uint256",
    "name": "minEthOut",
    "type": "uint256"
   },
   {
    "internalType": "bytes",
    "name": "route",
    "type": "bytes"
   }
  ],
  "name": "claimCreatorFees",
  "outputs": [
   {
    "internalType": "uint256",
    "name": "amount",
    "type": "uint256"
   }
  ],
  "stateMutability": "nonpayable",
  "type": "function"
 },
 {
  "inputs": [
   {
    "internalType": "address",
    "name": "holder",
    "type": "address"
   }
  ],
  "name": "claimFor",
  "outputs": [
   {
    "internalType": "uint256",
    "name": "amount",
    "type": "uint256"
   }
  ],
  "stateMutability": "nonpayable",
  "type": "function"
 },
 {
  "inputs": [],
  "name": "claimPlatformFees",
  "outputs": [
   {
    "internalType": "uint256",
    "name": "amount",
    "type": "uint256"
   }
  ],
  "stateMutability": "nonpayable",
  "type": "function"
 },
 {
  "inputs": [],
  "name": "claimRewards",
  "outputs": [
   {
    "internalType": "uint256",
    "name": "amount",
    "type": "uint256"
   }
  ],
  "stateMutability": "nonpayable",
  "type": "function"
 },
 {
  "inputs": [
   {
    "internalType": "uint256",
    "name": "minEthOut",
    "type": "uint256"
   },
   {
    "internalType": "bytes",
    "name": "route",
    "type": "bytes"
   }
  ],
  "name": "claimRewardsAsEth",
  "outputs": [
   {
    "internalType": "uint256",
    "name": "amount",
    "type": "uint256"
   }
  ],
  "stateMutability": "nonpayable",
  "type": "function"
 },
 {
  "inputs": [
   {
    "internalType": "address",
    "name": "",
    "type": "address"
   }
  ],
  "name": "claimable",
  "outputs": [
   {
    "internalType": "uint256",
    "name": "",
    "type": "uint256"
   }
  ],
  "stateMutability": "view",
  "type": "function"
 },
 {
  "inputs": [],
  "name": "converter",
  "outputs": [
   {
    "internalType": "address",
    "name": "",
    "type": "address"
   }
  ],
  "stateMutability": "view",
  "type": "function"
 },
 {
  "inputs": [],
  "name": "creator",
  "outputs": [
   {
    "internalType": "address",
    "name": "",
    "type": "address"
   }
  ],
  "stateMutability": "view",
  "type": "function"
 },
 {
  "inputs": [],
  "name": "creatorBps",
  "outputs": [
   {
    "internalType": "uint16",
    "name": "",
    "type": "uint16"
   }
  ],
  "stateMutability": "view",
  "type": "function"
 },
 {
  "inputs": [],
  "name": "creatorFees",
  "outputs": [
   {
    "internalType": "uint256",
    "name": "",
    "type": "uint256"
   }
  ],
  "stateMutability": "view",
  "type": "function"
 },
 {
  "inputs": [],
  "name": "decimals",
  "outputs": [
   {
    "internalType": "uint8",
    "name": "",
    "type": "uint8"
   }
  ],
  "stateMutability": "view",
  "type": "function"
 },
 {
  "inputs": [],
  "name": "eligibleSupply",
  "outputs": [
   {
    "internalType": "uint256",
    "name": "",
    "type": "uint256"
   }
  ],
  "stateMutability": "view",
  "type": "function"
 },
 {
  "inputs": [
   {
    "internalType": "address",
    "name": "",
    "type": "address"
   }
  ],
  "name": "excluded",
  "outputs": [
   {
    "internalType": "bool",
    "name": "",
    "type": "bool"
   }
  ],
  "stateMutability": "view",
  "type": "function"
 },
 {
  "inputs": [],
  "name": "holderBps",
  "outputs": [
   {
    "internalType": "uint16",
    "name": "",
    "type": "uint16"
   }
  ],
  "stateMutability": "view",
  "type": "function"
 },
 {
  "inputs": [],
  "name": "hook",
  "outputs": [
   {
    "internalType": "address",
    "name": "",
    "type": "address"
   }
  ],
  "stateMutability": "view",
  "type": "function"
 },
 {
  "inputs": [
   {
    "internalType": "address",
    "name": "hook_",
    "type": "address"
   },
   {
    "internalType": "address",
    "name": "converter_",
    "type": "address"
   },
   {
    "internalType": "address[]",
    "name": "excludedAddrs",
    "type": "address[]"
   }
  ],
  "name": "initHook",
  "outputs": [],
  "stateMutability": "nonpayable",
  "type": "function"
 },
 {
  "inputs": [],
  "name": "launchBlock",
  "outputs": [
   {
    "internalType": "uint256",
    "name": "",
    "type": "uint256"
   }
  ],
  "stateMutability": "view",
  "type": "function"
 },
 {
  "inputs": [],
  "name": "launchTime",
  "outputs": [
   {
    "internalType": "uint256",
    "name": "",
    "type": "uint256"
   }
  ],
  "stateMutability": "view",
  "type": "function"
 },
 {
  "inputs": [],
  "name": "metadataURI",
  "outputs": [
   {
    "internalType": "string",
    "name": "",
    "type": "string"
   }
  ],
  "stateMutability": "view",
  "type": "function"
 },
 {
  "inputs": [],
  "name": "name",
  "outputs": [
   {
    "internalType": "string",
    "name": "",
    "type": "string"
   }
  ],
  "stateMutability": "view",
  "type": "function"
 },
 {
  "inputs": [],
  "name": "owner",
  "outputs": [
   {
    "internalType": "address",
    "name": "",
    "type": "address"
   }
  ],
  "stateMutability": "pure",
  "type": "function"
 },
 {
  "inputs": [],
  "name": "pairAsset",
  "outputs": [
   {
    "internalType": "address",
    "name": "",
    "type": "address"
   }
  ],
  "stateMutability": "view",
  "type": "function"
 },
 {
  "inputs": [
   {
    "internalType": "address",
    "name": "holder",
    "type": "address"
   }
  ],
  "name": "pendingRewards",
  "outputs": [
   {
    "internalType": "uint256",
    "name": "",
    "type": "uint256"
   }
  ],
  "stateMutability": "view",
  "type": "function"
 },
 {
  "inputs": [],
  "name": "platformFees",
  "outputs": [
   {
    "internalType": "uint256",
    "name": "",
    "type": "uint256"
   }
  ],
  "stateMutability": "view",
  "type": "function"
 },
 {
  "inputs": [],
  "name": "poolManager",
  "outputs": [
   {
    "internalType": "address",
    "name": "",
    "type": "address"
   }
  ],
  "stateMutability": "view",
  "type": "function"
 },
 {
  "inputs": [],
  "name": "rewardToken",
  "outputs": [
   {
    "internalType": "address",
    "name": "",
    "type": "address"
   }
  ],
  "stateMutability": "view",
  "type": "function"
 },
 {
  "inputs": [],
  "name": "symbol",
  "outputs": [
   {
    "internalType": "string",
    "name": "",
    "type": "string"
   }
  ],
  "stateMutability": "view",
  "type": "function"
 },
 {
  "inputs": [],
  "name": "totalCreatorFees",
  "outputs": [
   {
    "internalType": "uint256",
    "name": "",
    "type": "uint256"
   }
  ],
  "stateMutability": "view",
  "type": "function"
 },
 {
  "inputs": [],
  "name": "totalHolderRewards",
  "outputs": [
   {
    "internalType": "uint256",
    "name": "",
    "type": "uint256"
   }
  ],
  "stateMutability": "view",
  "type": "function"
 },
 {
  "inputs": [],
  "name": "totalPlatformFees",
  "outputs": [
   {
    "internalType": "uint256",
    "name": "",
    "type": "uint256"
   }
  ],
  "stateMutability": "view",
  "type": "function"
 },
 {
  "inputs": [],
  "name": "totalSupply",
  "outputs": [
   {
    "internalType": "uint256",
    "name": "",
    "type": "uint256"
   }
  ],
  "stateMutability": "view",
  "type": "function"
 },
 {
  "inputs": [
   {
    "internalType": "address",
    "name": "to",
    "type": "address"
   },
   {
    "internalType": "uint256",
    "name": "value",
    "type": "uint256"
   }
  ],
  "name": "transfer",
  "outputs": [
   {
    "internalType": "bool",
    "name": "",
    "type": "bool"
   }
  ],
  "stateMutability": "nonpayable",
  "type": "function"
 },
 {
  "inputs": [
   {
    "internalType": "address",
    "name": "from",
    "type": "address"
   },
   {
    "internalType": "address",
    "name": "to",
    "type": "address"
   },
   {
    "internalType": "uint256",
    "name": "value",
    "type": "uint256"
   }
  ],
  "name": "transferFrom",
  "outputs": [
   {
    "internalType": "bool",
    "name": "",
    "type": "bool"
   }
  ],
  "stateMutability": "nonpayable",
  "type": "function"
 }
] as const;

export const routerAbi = [
 {
  "inputs": [
   {
    "internalType": "contract IPoolManager",
    "name": "pm",
    "type": "address"
   },
   {
    "internalType": "contract StockPadFactory",
    "name": "factory_",
    "type": "address"
   },
   {
    "internalType": "address",
    "name": "weth_",
    "type": "address"
   },
   {
    "internalType": "contract ISwapRouter02",
    "name": "v3Router_",
    "type": "address"
   }
  ],
  "stateMutability": "nonpayable",
  "type": "constructor"
 },
 {
  "inputs": [],
  "name": "BadRoute",
  "type": "error"
 },
 {
  "inputs": [],
  "name": "NotListed",
  "type": "error"
 },
 {
  "inputs": [],
  "name": "ReentrancyGuardReentrantCall",
  "type": "error"
 },
 {
  "inputs": [
   {
    "internalType": "address",
    "name": "token",
    "type": "address"
   }
  ],
  "name": "SafeERC20FailedOperation",
  "type": "error"
 },
 {
  "inputs": [],
  "name": "Slippage",
  "type": "error"
 },
 {
  "inputs": [],
  "name": "ZeroAmount",
  "type": "error"
 },
 {
  "anonymous": false,
  "inputs": [
   {
    "indexed": true,
    "internalType": "address",
    "name": "coin",
    "type": "address"
   },
   {
    "indexed": true,
    "internalType": "address",
    "name": "buyer",
    "type": "address"
   },
   {
    "indexed": false,
    "internalType": "uint256",
    "name": "ethIn",
    "type": "uint256"
   },
   {
    "indexed": false,
    "internalType": "uint256",
    "name": "pairIn",
    "type": "uint256"
   },
   {
    "indexed": false,
    "internalType": "uint256",
    "name": "coinOut",
    "type": "uint256"
   }
  ],
  "name": "Bought",
  "type": "event"
 },
 {
  "anonymous": false,
  "inputs": [
   {
    "indexed": true,
    "internalType": "address",
    "name": "coin",
    "type": "address"
   },
   {
    "indexed": true,
    "internalType": "address",
    "name": "seller",
    "type": "address"
   },
   {
    "indexed": false,
    "internalType": "uint256",
    "name": "coinIn",
    "type": "uint256"
   },
   {
    "indexed": false,
    "internalType": "uint256",
    "name": "pairOut",
    "type": "uint256"
   },
   {
    "indexed": false,
    "internalType": "uint256",
    "name": "ethOut",
    "type": "uint256"
   }
  ],
  "name": "Sold",
  "type": "event"
 },
 {
  "inputs": [
   {
    "internalType": "address",
    "name": "coin",
    "type": "address"
   },
   {
    "internalType": "bytes",
    "name": "route",
    "type": "bytes"
   },
   {
    "internalType": "uint256",
    "name": "minCoinOut",
    "type": "uint256"
   }
  ],
  "name": "buy",
  "outputs": [
   {
    "internalType": "uint256",
    "name": "coinOut",
    "type": "uint256"
   }
  ],
  "stateMutability": "payable",
  "type": "function"
 },
 {
  "inputs": [
   {
    "internalType": "address",
    "name": "coin",
    "type": "address"
   },
   {
    "internalType": "uint256",
    "name": "pairIn",
    "type": "uint256"
   },
   {
    "internalType": "uint256",
    "name": "minCoinOut",
    "type": "uint256"
   }
  ],
  "name": "buyWithPair",
  "outputs": [
   {
    "internalType": "uint256",
    "name": "coinOut",
    "type": "uint256"
   }
  ],
  "stateMutability": "nonpayable",
  "type": "function"
 },
 {
  "inputs": [
   {
    "internalType": "address",
    "name": "pair",
    "type": "address"
   },
   {
    "internalType": "bytes",
    "name": "route",
    "type": "bytes"
   },
   {
    "internalType": "address",
    "name": "to",
    "type": "address"
   },
   {
    "internalType": "uint256",
    "name": "minOut",
    "type": "uint256"
   }
  ],
  "name": "ethToPair",
  "outputs": [
   {
    "internalType": "uint256",
    "name": "pairOut",
    "type": "uint256"
   }
  ],
  "stateMutability": "payable",
  "type": "function"
 },
 {
  "inputs": [],
  "name": "factory",
  "outputs": [
   {
    "internalType": "contract StockPadFactory",
    "name": "",
    "type": "address"
   }
  ],
  "stateMutability": "view",
  "type": "function"
 },
 {
  "inputs": [
   {
    "internalType": "address",
    "name": "pair",
    "type": "address"
   },
   {
    "internalType": "uint256",
    "name": "amount",
    "type": "uint256"
   },
   {
    "internalType": "address",
    "name": "to",
    "type": "address"
   },
   {
    "internalType": "uint256",
    "name": "minOut",
    "type": "uint256"
   },
   {
    "internalType": "bytes",
    "name": "route",
    "type": "bytes"
   }
  ],
  "name": "pairToEth",
  "outputs": [
   {
    "internalType": "uint256",
    "name": "ethOut",
    "type": "uint256"
   }
  ],
  "stateMutability": "nonpayable",
  "type": "function"
 },
 {
  "inputs": [],
  "name": "poolManager",
  "outputs": [
   {
    "internalType": "contract IPoolManager",
    "name": "",
    "type": "address"
   }
  ],
  "stateMutability": "view",
  "type": "function"
 },
 {
  "inputs": [
   {
    "internalType": "address",
    "name": "coin",
    "type": "address"
   },
   {
    "internalType": "uint256",
    "name": "amountIn",
    "type": "uint256"
   },
   {
    "internalType": "bytes",
    "name": "route",
    "type": "bytes"
   },
   {
    "internalType": "uint256",
    "name": "minEthOut",
    "type": "uint256"
   }
  ],
  "name": "sell",
  "outputs": [
   {
    "internalType": "uint256",
    "name": "ethOut",
    "type": "uint256"
   }
  ],
  "stateMutability": "nonpayable",
  "type": "function"
 },
 {
  "inputs": [
   {
    "internalType": "address",
    "name": "coin",
    "type": "address"
   },
   {
    "internalType": "uint256",
    "name": "amountIn",
    "type": "uint256"
   },
   {
    "internalType": "uint256",
    "name": "minPairOut",
    "type": "uint256"
   }
  ],
  "name": "sellForPair",
  "outputs": [
   {
    "internalType": "uint256",
    "name": "pairOut",
    "type": "uint256"
   }
  ],
  "stateMutability": "nonpayable",
  "type": "function"
 },
 {
  "inputs": [
   {
    "internalType": "bytes",
    "name": "data",
    "type": "bytes"
   }
  ],
  "name": "unlockCallback",
  "outputs": [
   {
    "internalType": "bytes",
    "name": "",
    "type": "bytes"
   }
  ],
  "stateMutability": "nonpayable",
  "type": "function"
 },
 {
  "inputs": [],
  "name": "v3Router",
  "outputs": [
   {
    "internalType": "contract ISwapRouter02",
    "name": "",
    "type": "address"
   }
  ],
  "stateMutability": "view",
  "type": "function"
 },
 {
  "inputs": [],
  "name": "weth",
  "outputs": [
   {
    "internalType": "address",
    "name": "",
    "type": "address"
   }
  ],
  "stateMutability": "view",
  "type": "function"
 },
 {
  "stateMutability": "payable",
  "type": "receive"
 }
] as const;

export const hookAbi = [
 {
  "inputs": [
   {
    "internalType": "contract IPoolManager",
    "name": "pm",
    "type": "address"
   },
   {
    "internalType": "address",
    "name": "admin_",
    "type": "address"
   }
  ],
  "stateMutability": "nonpayable",
  "type": "constructor"
 },
 {
  "inputs": [],
  "name": "AlreadySet",
  "type": "error"
 },
 {
  "inputs": [],
  "name": "HookNotImplemented",
  "type": "error"
 },
 {
  "inputs": [],
  "name": "NotAdmin",
  "type": "error"
 },
 {
  "inputs": [],
  "name": "NotFactory",
  "type": "error"
 },
 {
  "inputs": [],
  "name": "NotPoolManager",
  "type": "error"
 },
 {
  "inputs": [],
  "name": "ZeroAddress",
  "type": "error"
 },
 {
  "anonymous": false,
  "inputs": [
   {
    "indexed": true,
    "internalType": "address",
    "name": "factory",
    "type": "address"
   }
  ],
  "name": "FactorySet",
  "type": "event"
 },
 {
  "anonymous": false,
  "inputs": [
   {
    "indexed": true,
    "internalType": "address",
    "name": "token",
    "type": "address"
   },
   {
    "indexed": false,
    "internalType": "uint256",
    "name": "amount",
    "type": "uint256"
   }
  ],
  "name": "FeeDelivered",
  "type": "event"
 },
 {
  "anonymous": false,
  "inputs": [
   {
    "indexed": true,
    "internalType": "address",
    "name": "token",
    "type": "address"
   },
   {
    "indexed": false,
    "internalType": "uint256",
    "name": "amount",
    "type": "uint256"
   }
  ],
  "name": "FeeHeld",
  "type": "event"
 },
 {
  "anonymous": false,
  "inputs": [
   {
    "indexed": true,
    "internalType": "address",
    "name": "token",
    "type": "address"
   },
   {
    "indexed": false,
    "internalType": "uint256",
    "name": "fee",
    "type": "uint256"
   },
   {
    "indexed": false,
    "internalType": "uint256",
    "name": "extra",
    "type": "uint256"
   }
  ],
  "name": "FeeTaken",
  "type": "event"
 },
 {
  "anonymous": false,
  "inputs": [
   {
    "indexed": true,
    "internalType": "address",
    "name": "token",
    "type": "address"
   },
   {
    "indexed": true,
    "internalType": "address",
    "name": "pair",
    "type": "address"
   },
   {
    "indexed": true,
    "internalType": "PoolId",
    "name": "id",
    "type": "bytes32"
   },
   {
    "indexed": false,
    "internalType": "uint16",
    "name": "taxBps",
    "type": "uint16"
   }
  ],
  "name": "PoolRegistered",
  "type": "event"
 },
 {
  "inputs": [],
  "name": "SNIPE_SECONDS",
  "outputs": [
   {
    "internalType": "uint256",
    "name": "",
    "type": "uint256"
   }
  ],
  "stateMutability": "view",
  "type": "function"
 },
 {
  "inputs": [],
  "name": "SNIPE_START_BPS",
  "outputs": [
   {
    "internalType": "uint16",
    "name": "",
    "type": "uint16"
   }
  ],
  "stateMutability": "view",
  "type": "function"
 },
 {
  "inputs": [],
  "name": "admin",
  "outputs": [
   {
    "internalType": "address",
    "name": "",
    "type": "address"
   }
  ],
  "stateMutability": "view",
  "type": "function"
 },
 {
  "inputs": [
   {
    "internalType": "address",
    "name": "sender",
    "type": "address"
   },
   {
    "components": [
     {
      "internalType": "Currency",
      "name": "currency0",
      "type": "address"
     },
     {
      "internalType": "Currency",
      "name": "currency1",
      "type": "address"
     },
     {
      "internalType": "uint24",
      "name": "fee",
      "type": "uint24"
     },
     {
      "internalType": "int24",
      "name": "tickSpacing",
      "type": "int24"
     },
     {
      "internalType": "contract IHooks",
      "name": "hooks",
      "type": "address"
     }
    ],
    "internalType": "struct PoolKey",
    "name": "key",
    "type": "tuple"
   },
   {
    "components": [
     {
      "internalType": "int24",
      "name": "tickLower",
      "type": "int24"
     },
     {
      "internalType": "int24",
      "name": "tickUpper",
      "type": "int24"
     },
     {
      "internalType": "int256",
      "name": "liquidityDelta",
      "type": "int256"
     },
     {
      "internalType": "bytes32",
      "name": "salt",
      "type": "bytes32"
     }
    ],
    "internalType": "struct ModifyLiquidityParams",
    "name": "params",
    "type": "tuple"
   },
   {
    "internalType": "BalanceDelta",
    "name": "delta",
    "type": "int256"
   },
   {
    "internalType": "BalanceDelta",
    "name": "feesAccrued",
    "type": "int256"
   },
   {
    "internalType": "bytes",
    "name": "hookData",
    "type": "bytes"
   }
  ],
  "name": "afterAddLiquidity",
  "outputs": [
   {
    "internalType": "bytes4",
    "name": "",
    "type": "bytes4"
   },
   {
    "internalType": "BalanceDelta",
    "name": "",
    "type": "int256"
   }
  ],
  "stateMutability": "nonpayable",
  "type": "function"
 },
 {
  "inputs": [
   {
    "internalType": "address",
    "name": "sender",
    "type": "address"
   },
   {
    "components": [
     {
      "internalType": "Currency",
      "name": "currency0",
      "type": "address"
     },
     {
      "internalType": "Currency",
      "name": "currency1",
      "type": "address"
     },
     {
      "internalType": "uint24",
      "name": "fee",
      "type": "uint24"
     },
     {
      "internalType": "int24",
      "name": "tickSpacing",
      "type": "int24"
     },
     {
      "internalType": "contract IHooks",
      "name": "hooks",
      "type": "address"
     }
    ],
    "internalType": "struct PoolKey",
    "name": "key",
    "type": "tuple"
   },
   {
    "internalType": "uint256",
    "name": "amount0",
    "type": "uint256"
   },
   {
    "internalType": "uint256",
    "name": "amount1",
    "type": "uint256"
   },
   {
    "internalType": "bytes",
    "name": "hookData",
    "type": "bytes"
   }
  ],
  "name": "afterDonate",
  "outputs": [
   {
    "internalType": "bytes4",
    "name": "",
    "type": "bytes4"
   }
  ],
  "stateMutability": "nonpayable",
  "type": "function"
 },
 {
  "inputs": [
   {
    "internalType": "address",
    "name": "sender",
    "type": "address"
   },
   {
    "components": [
     {
      "internalType": "Currency",
      "name": "currency0",
      "type": "address"
     },
     {
      "internalType": "Currency",
      "name": "currency1",
      "type": "address"
     },
     {
      "internalType": "uint24",
      "name": "fee",
      "type": "uint24"
     },
     {
      "internalType": "int24",
      "name": "tickSpacing",
      "type": "int24"
     },
     {
      "internalType": "contract IHooks",
      "name": "hooks",
      "type": "address"
     }
    ],
    "internalType": "struct PoolKey",
    "name": "key",
    "type": "tuple"
   },
   {
    "internalType": "uint160",
    "name": "sqrtPriceX96",
    "type": "uint160"
   },
   {
    "internalType": "int24",
    "name": "tick",
    "type": "int24"
   }
  ],
  "name": "afterInitialize",
  "outputs": [
   {
    "internalType": "bytes4",
    "name": "",
    "type": "bytes4"
   }
  ],
  "stateMutability": "nonpayable",
  "type": "function"
 },
 {
  "inputs": [
   {
    "internalType": "address",
    "name": "sender",
    "type": "address"
   },
   {
    "components": [
     {
      "internalType": "Currency",
      "name": "currency0",
      "type": "address"
     },
     {
      "internalType": "Currency",
      "name": "currency1",
      "type": "address"
     },
     {
      "internalType": "uint24",
      "name": "fee",
      "type": "uint24"
     },
     {
      "internalType": "int24",
      "name": "tickSpacing",
      "type": "int24"
     },
     {
      "internalType": "contract IHooks",
      "name": "hooks",
      "type": "address"
     }
    ],
    "internalType": "struct PoolKey",
    "name": "key",
    "type": "tuple"
   },
   {
    "components": [
     {
      "internalType": "int24",
      "name": "tickLower",
      "type": "int24"
     },
     {
      "internalType": "int24",
      "name": "tickUpper",
      "type": "int24"
     },
     {
      "internalType": "int256",
      "name": "liquidityDelta",
      "type": "int256"
     },
     {
      "internalType": "bytes32",
      "name": "salt",
      "type": "bytes32"
     }
    ],
    "internalType": "struct ModifyLiquidityParams",
    "name": "params",
    "type": "tuple"
   },
   {
    "internalType": "BalanceDelta",
    "name": "delta",
    "type": "int256"
   },
   {
    "internalType": "BalanceDelta",
    "name": "feesAccrued",
    "type": "int256"
   },
   {
    "internalType": "bytes",
    "name": "hookData",
    "type": "bytes"
   }
  ],
  "name": "afterRemoveLiquidity",
  "outputs": [
   {
    "internalType": "bytes4",
    "name": "",
    "type": "bytes4"
   },
   {
    "internalType": "BalanceDelta",
    "name": "",
    "type": "int256"
   }
  ],
  "stateMutability": "nonpayable",
  "type": "function"
 },
 {
  "inputs": [
   {
    "internalType": "address",
    "name": "sender",
    "type": "address"
   },
   {
    "components": [
     {
      "internalType": "Currency",
      "name": "currency0",
      "type": "address"
     },
     {
      "internalType": "Currency",
      "name": "currency1",
      "type": "address"
     },
     {
      "internalType": "uint24",
      "name": "fee",
      "type": "uint24"
     },
     {
      "internalType": "int24",
      "name": "tickSpacing",
      "type": "int24"
     },
     {
      "internalType": "contract IHooks",
      "name": "hooks",
      "type": "address"
     }
    ],
    "internalType": "struct PoolKey",
    "name": "key",
    "type": "tuple"
   },
   {
    "components": [
     {
      "internalType": "bool",
      "name": "zeroForOne",
      "type": "bool"
     },
     {
      "internalType": "int256",
      "name": "amountSpecified",
      "type": "int256"
     },
     {
      "internalType": "uint160",
      "name": "sqrtPriceLimitX96",
      "type": "uint160"
     }
    ],
    "internalType": "struct SwapParams",
    "name": "params",
    "type": "tuple"
   },
   {
    "internalType": "BalanceDelta",
    "name": "delta",
    "type": "int256"
   },
   {
    "internalType": "bytes",
    "name": "hookData",
    "type": "bytes"
   }
  ],
  "name": "afterSwap",
  "outputs": [
   {
    "internalType": "bytes4",
    "name": "",
    "type": "bytes4"
   },
   {
    "internalType": "int128",
    "name": "",
    "type": "int128"
   }
  ],
  "stateMutability": "nonpayable",
  "type": "function"
 },
 {
  "inputs": [
   {
    "internalType": "address",
    "name": "sender",
    "type": "address"
   },
   {
    "components": [
     {
      "internalType": "Currency",
      "name": "currency0",
      "type": "address"
     },
     {
      "internalType": "Currency",
      "name": "currency1",
      "type": "address"
     },
     {
      "internalType": "uint24",
      "name": "fee",
      "type": "uint24"
     },
     {
      "internalType": "int24",
      "name": "tickSpacing",
      "type": "int24"
     },
     {
      "internalType": "contract IHooks",
      "name": "hooks",
      "type": "address"
     }
    ],
    "internalType": "struct PoolKey",
    "name": "key",
    "type": "tuple"
   },
   {
    "components": [
     {
      "internalType": "int24",
      "name": "tickLower",
      "type": "int24"
     },
     {
      "internalType": "int24",
      "name": "tickUpper",
      "type": "int24"
     },
     {
      "internalType": "int256",
      "name": "liquidityDelta",
      "type": "int256"
     },
     {
      "internalType": "bytes32",
      "name": "salt",
      "type": "bytes32"
     }
    ],
    "internalType": "struct ModifyLiquidityParams",
    "name": "params",
    "type": "tuple"
   },
   {
    "internalType": "bytes",
    "name": "hookData",
    "type": "bytes"
   }
  ],
  "name": "beforeAddLiquidity",
  "outputs": [
   {
    "internalType": "bytes4",
    "name": "",
    "type": "bytes4"
   }
  ],
  "stateMutability": "nonpayable",
  "type": "function"
 },
 {
  "inputs": [
   {
    "internalType": "address",
    "name": "sender",
    "type": "address"
   },
   {
    "components": [
     {
      "internalType": "Currency",
      "name": "currency0",
      "type": "address"
     },
     {
      "internalType": "Currency",
      "name": "currency1",
      "type": "address"
     },
     {
      "internalType": "uint24",
      "name": "fee",
      "type": "uint24"
     },
     {
      "internalType": "int24",
      "name": "tickSpacing",
      "type": "int24"
     },
     {
      "internalType": "contract IHooks",
      "name": "hooks",
      "type": "address"
     }
    ],
    "internalType": "struct PoolKey",
    "name": "key",
    "type": "tuple"
   },
   {
    "internalType": "uint256",
    "name": "amount0",
    "type": "uint256"
   },
   {
    "internalType": "uint256",
    "name": "amount1",
    "type": "uint256"
   },
   {
    "internalType": "bytes",
    "name": "hookData",
    "type": "bytes"
   }
  ],
  "name": "beforeDonate",
  "outputs": [
   {
    "internalType": "bytes4",
    "name": "",
    "type": "bytes4"
   }
  ],
  "stateMutability": "nonpayable",
  "type": "function"
 },
 {
  "inputs": [
   {
    "internalType": "address",
    "name": "sender",
    "type": "address"
   },
   {
    "components": [
     {
      "internalType": "Currency",
      "name": "currency0",
      "type": "address"
     },
     {
      "internalType": "Currency",
      "name": "currency1",
      "type": "address"
     },
     {
      "internalType": "uint24",
      "name": "fee",
      "type": "uint24"
     },
     {
      "internalType": "int24",
      "name": "tickSpacing",
      "type": "int24"
     },
     {
      "internalType": "contract IHooks",
      "name": "hooks",
      "type": "address"
     }
    ],
    "internalType": "struct PoolKey",
    "name": "key",
    "type": "tuple"
   },
   {
    "internalType": "uint160",
    "name": "sqrtPriceX96",
    "type": "uint160"
   }
  ],
  "name": "beforeInitialize",
  "outputs": [
   {
    "internalType": "bytes4",
    "name": "",
    "type": "bytes4"
   }
  ],
  "stateMutability": "nonpayable",
  "type": "function"
 },
 {
  "inputs": [
   {
    "internalType": "address",
    "name": "sender",
    "type": "address"
   },
   {
    "components": [
     {
      "internalType": "Currency",
      "name": "currency0",
      "type": "address"
     },
     {
      "internalType": "Currency",
      "name": "currency1",
      "type": "address"
     },
     {
      "internalType": "uint24",
      "name": "fee",
      "type": "uint24"
     },
     {
      "internalType": "int24",
      "name": "tickSpacing",
      "type": "int24"
     },
     {
      "internalType": "contract IHooks",
      "name": "hooks",
      "type": "address"
     }
    ],
    "internalType": "struct PoolKey",
    "name": "key",
    "type": "tuple"
   },
   {
    "components": [
     {
      "internalType": "int24",
      "name": "tickLower",
      "type": "int24"
     },
     {
      "internalType": "int24",
      "name": "tickUpper",
      "type": "int24"
     },
     {
      "internalType": "int256",
      "name": "liquidityDelta",
      "type": "int256"
     },
     {
      "internalType": "bytes32",
      "name": "salt",
      "type": "bytes32"
     }
    ],
    "internalType": "struct ModifyLiquidityParams",
    "name": "params",
    "type": "tuple"
   },
   {
    "internalType": "bytes",
    "name": "hookData",
    "type": "bytes"
   }
  ],
  "name": "beforeRemoveLiquidity",
  "outputs": [
   {
    "internalType": "bytes4",
    "name": "",
    "type": "bytes4"
   }
  ],
  "stateMutability": "nonpayable",
  "type": "function"
 },
 {
  "inputs": [
   {
    "internalType": "address",
    "name": "sender",
    "type": "address"
   },
   {
    "components": [
     {
      "internalType": "Currency",
      "name": "currency0",
      "type": "address"
     },
     {
      "internalType": "Currency",
      "name": "currency1",
      "type": "address"
     },
     {
      "internalType": "uint24",
      "name": "fee",
      "type": "uint24"
     },
     {
      "internalType": "int24",
      "name": "tickSpacing",
      "type": "int24"
     },
     {
      "internalType": "contract IHooks",
      "name": "hooks",
      "type": "address"
     }
    ],
    "internalType": "struct PoolKey",
    "name": "key",
    "type": "tuple"
   },
   {
    "components": [
     {
      "internalType": "bool",
      "name": "zeroForOne",
      "type": "bool"
     },
     {
      "internalType": "int256",
      "name": "amountSpecified",
      "type": "int256"
     },
     {
      "internalType": "uint160",
      "name": "sqrtPriceLimitX96",
      "type": "uint160"
     }
    ],
    "internalType": "struct SwapParams",
    "name": "params",
    "type": "tuple"
   },
   {
    "internalType": "bytes",
    "name": "hookData",
    "type": "bytes"
   }
  ],
  "name": "beforeSwap",
  "outputs": [
   {
    "internalType": "bytes4",
    "name": "",
    "type": "bytes4"
   },
   {
    "internalType": "BeforeSwapDelta",
    "name": "",
    "type": "int256"
   },
   {
    "internalType": "uint24",
    "name": "",
    "type": "uint24"
   }
  ],
  "stateMutability": "nonpayable",
  "type": "function"
 },
 {
  "inputs": [
   {
    "internalType": "PoolId",
    "name": "id",
    "type": "bytes32"
   }
  ],
  "name": "config",
  "outputs": [
   {
    "components": [
     {
      "internalType": "address",
      "name": "token",
      "type": "address"
     },
     {
      "internalType": "address",
      "name": "pair",
      "type": "address"
     },
     {
      "internalType": "uint16",
      "name": "taxBps",
      "type": "uint16"
     },
     {
      "internalType": "bool",
      "name": "pairIsCurrency0",
      "type": "bool"
     },
     {
      "internalType": "uint64",
      "name": "launchTime",
      "type": "uint64"
     },
     {
      "internalType": "bool",
      "name": "registered",
      "type": "bool"
     }
    ],
    "internalType": "struct StockPadHook.PoolConfig",
    "name": "",
    "type": "tuple"
   }
  ],
  "stateMutability": "view",
  "type": "function"
 },
 {
  "inputs": [],
  "name": "deployer",
  "outputs": [
   {
    "internalType": "address",
    "name": "",
    "type": "address"
   }
  ],
  "stateMutability": "view",
  "type": "function"
 },
 {
  "inputs": [],
  "name": "factory",
  "outputs": [
   {
    "internalType": "address",
    "name": "",
    "type": "address"
   }
  ],
  "stateMutability": "view",
  "type": "function"
 },
 {
  "inputs": [
   {
    "internalType": "PoolId",
    "name": "id",
    "type": "bytes32"
   },
   {
    "internalType": "address",
    "name": "sender",
    "type": "address"
   }
  ],
  "name": "feeBpsNow",
  "outputs": [
   {
    "internalType": "uint16",
    "name": "total",
    "type": "uint16"
   },
   {
    "internalType": "uint16",
    "name": "base",
    "type": "uint16"
   }
  ],
  "stateMutability": "view",
  "type": "function"
 },
 {
  "inputs": [
   {
    "internalType": "address",
    "name": "token",
    "type": "address"
   }
  ],
  "name": "flush",
  "outputs": [
   {
    "internalType": "uint256",
    "name": "amount",
    "type": "uint256"
   }
  ],
  "stateMutability": "nonpayable",
  "type": "function"
 },
 {
  "inputs": [],
  "name": "getHookPermissions",
  "outputs": [
   {
    "components": [
     {
      "internalType": "bool",
      "name": "beforeInitialize",
      "type": "bool"
     },
     {
      "internalType": "bool",
      "name": "afterInitialize",
      "type": "bool"
     },
     {
      "internalType": "bool",
      "name": "beforeAddLiquidity",
      "type": "bool"
     },
     {
      "internalType": "bool",
      "name": "afterAddLiquidity",
      "type": "bool"
     },
     {
      "internalType": "bool",
      "name": "beforeRemoveLiquidity",
      "type": "bool"
     },
     {
      "internalType": "bool",
      "name": "afterRemoveLiquidity",
      "type": "bool"
     },
     {
      "internalType": "bool",
      "name": "beforeSwap",
      "type": "bool"
     },
     {
      "internalType": "bool",
      "name": "afterSwap",
      "type": "bool"
     },
     {
      "internalType": "bool",
      "name": "beforeDonate",
      "type": "bool"
     },
     {
      "internalType": "bool",
      "name": "afterDonate",
      "type": "bool"
     },
     {
      "internalType": "bool",
      "name": "beforeSwapReturnDelta",
      "type": "bool"
     },
     {
      "internalType": "bool",
      "name": "afterSwapReturnDelta",
      "type": "bool"
     },
     {
      "internalType": "bool",
      "name": "afterAddLiquidityReturnDelta",
      "type": "bool"
     },
     {
      "internalType": "bool",
      "name": "afterRemoveLiquidityReturnDelta",
      "type": "bool"
     }
    ],
    "internalType": "struct Hooks.Permissions",
    "name": "p",
    "type": "tuple"
   }
  ],
  "stateMutability": "pure",
  "type": "function"
 },
 {
  "inputs": [
   {
    "internalType": "address",
    "name": "",
    "type": "address"
   }
  ],
  "name": "owed",
  "outputs": [
   {
    "internalType": "uint256",
    "name": "",
    "type": "uint256"
   }
  ],
  "stateMutability": "view",
  "type": "function"
 },
 {
  "inputs": [
   {
    "internalType": "address",
    "name": "",
    "type": "address"
   }
  ],
  "name": "pairOf",
  "outputs": [
   {
    "internalType": "address",
    "name": "",
    "type": "address"
   }
  ],
  "stateMutability": "view",
  "type": "function"
 },
 {
  "inputs": [],
  "name": "poolManager",
  "outputs": [
   {
    "internalType": "contract IPoolManager",
    "name": "",
    "type": "address"
   }
  ],
  "stateMutability": "view",
  "type": "function"
 },
 {
  "inputs": [
   {
    "components": [
     {
      "internalType": "Currency",
      "name": "currency0",
      "type": "address"
     },
     {
      "internalType": "Currency",
      "name": "currency1",
      "type": "address"
     },
     {
      "internalType": "uint24",
      "name": "fee",
      "type": "uint24"
     },
     {
      "internalType": "int24",
      "name": "tickSpacing",
      "type": "int24"
     },
     {
      "internalType": "contract IHooks",
      "name": "hooks",
      "type": "address"
     }
    ],
    "internalType": "struct PoolKey",
    "name": "key",
    "type": "tuple"
   },
   {
    "internalType": "address",
    "name": "token",
    "type": "address"
   },
   {
    "internalType": "address",
    "name": "pair",
    "type": "address"
   },
   {
    "internalType": "uint16",
    "name": "taxBps",
    "type": "uint16"
   }
  ],
  "name": "registerPool",
  "outputs": [],
  "stateMutability": "nonpayable",
  "type": "function"
 },
 {
  "inputs": [
   {
    "internalType": "address",
    "name": "factory_",
    "type": "address"
   }
  ],
  "name": "setFactory",
  "outputs": [],
  "stateMutability": "nonpayable",
  "type": "function"
 },
 {
  "inputs": [
   {
    "internalType": "bytes",
    "name": "data",
    "type": "bytes"
   }
  ],
  "name": "unlockCallback",
  "outputs": [
   {
    "internalType": "bytes",
    "name": "",
    "type": "bytes"
   }
  ],
  "stateMutability": "nonpayable",
  "type": "function"
 }
] as const;
