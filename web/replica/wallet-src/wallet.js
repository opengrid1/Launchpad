/* Inkypump wallet layer: Reown AppKit (ethers adapter) on the static site.
   Exposes window.inkyWallet and fires 'inky:wallet' on every change. */
import { createAppKit } from '@reown/appkit';
import { EthersAdapter } from '@reown/appkit-adapter-ethers';
import { ink } from '@reown/appkit/networks';
import { BrowserProvider } from 'ethers';

const CFG = window.INKY || {};
const api = {
  ready: false, connected: false, address: null, chainId: null, provider: null,
  open() {}, logout() {}, async getSigner() { return null; }, async switchToInk() {},
  short() { return this.address ? this.address.slice(0, 6) + '…' + this.address.slice(-4) : ''; },
};
window.inkyWallet = api;
const emit = () => window.dispatchEvent(new CustomEvent('inky:wallet', { detail: { connected: api.connected, address: api.address, chainId: api.chainId } }));

if (CFG.reownProjectId) {
  const modal = createAppKit({
    adapters: [new EthersAdapter()],
    networks: [ink],
    defaultNetwork: ink,
    projectId: CFG.reownProjectId,
    metadata: { name: 'Inkypump', description: 'Memecoins on Ink that pay holders in stocks', url: location.origin, icons: [location.origin + '/img/logo-512.png'] },
    themeMode: 'dark',
    themeVariables: { '--w3m-accent': '#ff4fa3', '--w3m-font-family': "'Geist', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", '--w3m-border-radius-master': '2px', '--w3m-color-mix': '#0e1117', '--w3m-color-mix-strength': 20, '--w3m-z-index': 2000 },
    features: { analytics: false, email: false, socials: false, swaps: false, onramp: false, send: false, history: false },
    allWallets: 'SHOW',
    enableWalletGuide: false,
  });
  api.ready = true;
  api.open = () => modal.open();
  api.logout = () => modal.disconnect();
  api.switchToInk = () => modal.switchNetwork(ink);
  api.getSigner = async () => { const p = modal.getWalletProvider(); if (!p) return null; api.provider = new BrowserProvider(p); return api.provider.getSigner(); };
  modal.subscribeAccount(a => { api.connected = !!a.isConnected; api.address = a.address || null; emit(); });
  modal.subscribeNetwork(n => { api.chainId = n.chainId ? Number(n.chainId) : null; emit(); });
  emit();
}
