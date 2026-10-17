/* OneHook wallet layer: Reown AppKit (ethers adapter) on the static site, Ethereum mainnet.
   Exposes window.inkyWallet (name kept so the shared JS needs no rename) and fires 'inky:wallet'. */
import { createAppKit } from '@reown/appkit';
import { EthersAdapter } from '@reown/appkit-adapter-ethers';
import { mainnet } from '@reown/appkit/networks';
import { BrowserProvider } from 'ethers';

const CFG = window.INKY || {};
const api = {
  ready: false, connected: false, address: null, chainId: null, provider: null,
  open() {}, logout() {}, async getSigner() { return null; }, async switchToInk() {}, async switchChain() {},
  short() { return this.address ? this.address.slice(0, 6) + '…' + this.address.slice(-4) : ''; },
};
window.inkyWallet = api;
const emit = () => window.dispatchEvent(new CustomEvent('inky:wallet', { detail: { connected: api.connected, address: api.address, chainId: api.chainId } }));

if (CFG.reownProjectId) {
  const modal = createAppKit({
    adapters: [new EthersAdapter()],
    networks: [mainnet],
    defaultNetwork: mainnet,
    projectId: CFG.reownProjectId,
    metadata: { name: 'OneHook', description: 'Launch coins on Ethereum that evolve, under one immutable Uniswap v4 hook', url: location.origin, icons: [location.origin + '/img/pfp-512.png'] },
    themeMode: 'dark',
    themeVariables: { '--w3m-accent': '#3fbcff', '--w3m-font-family': "'Geist', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", '--w3m-border-radius-master': '2px', '--w3m-color-mix': '#0e1117', '--w3m-color-mix-strength': 20, '--w3m-z-index': 2000 },
    features: { analytics: false, email: false, socials: false, swaps: false, onramp: false, send: false, history: false },
    allWallets: 'SHOW',
    enableWalletGuide: false,
  });
  api.ready = true;
  api.open = () => modal.open();
  api.logout = () => modal.disconnect();
  api.switchToInk = () => modal.switchNetwork(mainnet);
  api.switchChain = () => modal.switchNetwork(mainnet);
  api.getSigner = async () => { const p = modal.getWalletProvider(); if (!p) return null; api.provider = new BrowserProvider(p); return api.provider.getSigner(); };
  modal.subscribeAccount(a => { api.connected = !!a.isConnected; api.address = a.address || null; emit(); });
  modal.subscribeNetwork(n => { api.chainId = n.chainId ? Number(n.chainId) : null; emit(); });
  emit();
}
