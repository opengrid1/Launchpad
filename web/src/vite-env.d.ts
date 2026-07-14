/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CHAIN_ID: string;
  readonly VITE_CHAIN_NAME?: string;
  readonly VITE_RPC_URL: string;
  readonly VITE_EXPLORER_URL?: string;
  readonly VITE_NATIVE_SYMBOL?: string;
  readonly VITE_LAUNCHPAD_ADDRESS: string;
  readonly VITE_FEE_DISTRIBUTOR_ADDRESS: string;
  readonly VITE_TREASURY_ADDRESS: string;
  readonly VITE_TOKEN_FACTORY_ADDRESS: string;
  readonly VITE_WETH_ADDRESS: string;
  readonly VITE_API_URL?: string;
  readonly VITE_WS_URL?: string;
  readonly VITE_WALLETCONNECT_PROJECT_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
