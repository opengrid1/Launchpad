/* Anypair wallet layer: Reown AppKit (ethers adapter) when a project id is set, otherwise the
   browser's injected wallet (EIP-1193). Exposes window.apWallet and fires 'ap:wallet' on changes. */
import { createAppKit } from '@reown/appkit';
import { EthersAdapter } from '@reown/appkit-adapter-ethers';
import { base } from '@reown/appkit/networks';
import { BrowserProvider } from 'ethers';

const CFG = window.ANYPAIR || {};
const CHAIN_ID = CFG.chainId || 8453;
const api = {
  ready: false, connected: false, address: null, chainId: null, kind: null,
  open() {}, logout() {}, async getSigner() { return null; }, async switchChain() {},
  short() { return this.address ? this.address.slice(0, 6) + '…' + this.address.slice(-4) : ''; },
};
window.apWallet = api;
const emit = () => window.dispatchEvent(new CustomEvent('ap:wallet', { detail: { connected: api.connected, address: api.address, chainId: api.chainId } }));

function injected() {
  const eth = window.ethereum; if (!eth) { api.open = () => window.dispatchEvent(new CustomEvent('ap:nowallet')); api.ready = true; return; }
  api.kind = 'injected'; api.ready = true;
  const sync = async () => { try { const acc = await eth.request({ method: 'eth_accounts' }); const cid = await eth.request({ method: 'eth_chainId' }); api.address = acc[0] ? acc[0].toLowerCase() : null; api.connected = !!api.address && !localStorage.getItem('ap:loggedout'); api.chainId = Number(cid); } catch {} emit(); };
  api.open = async () => { try { localStorage.removeItem('ap:loggedout'); } catch {} await eth.request({ method: 'eth_requestAccounts' }); await sync(); };
  api.logout = () => { try { localStorage.setItem('ap:loggedout', '1'); } catch {} api.connected = false; emit(); };
  api.switchChain = async () => { try { await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x' + CHAIN_ID.toString(16) }] }); } catch (e) {
    if (e && e.code === 4902) await eth.request({ method: 'wallet_addEthereumChain', params: [{ chainId: '0x2105', chainName: 'Base', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: ['https://mainnet.base.org'], blockExplorerUrls: ['https://basescan.org'] }] }); else throw e; } await sync(); };
  api.getSigner = async () => new BrowserProvider(eth).getSigner();
  eth.on && eth.on('accountsChanged', sync); eth.on && eth.on('chainChanged', sync);
  sync();
}

if (CFG.reownProjectId && !CFG.injectedOnly) {
  const modal = createAppKit({
    adapters: [new EthersAdapter()], networks: [base], defaultNetwork: base, projectId: CFG.reownProjectId,
    metadata: { name: 'Anypair', description: 'Launch a coin against any token on Base', url: location.origin, icons: [location.origin + '/img/icon-512.png'] },
    themeMode: document.documentElement.dataset.theme === 'light' ? 'light' : 'dark',
    themeVariables: { '--w3m-accent': '#3a6bff', '--w3m-font-family': "'IBM Plex Sans', system-ui, sans-serif", '--w3m-border-radius-master': '3px', '--w3m-z-index': 2000 },
    features: { analytics: false, email: false, socials: false, swaps: false, onramp: false, send: false, history: false }, allWallets: 'SHOW', enableWalletGuide: false,
  });
  api.kind = 'reown'; api.ready = true;
  api.open = () => modal.open(); api.logout = () => modal.disconnect(); api.switchChain = () => modal.switchNetwork(base);
  api.getSigner = async () => { const p = modal.getWalletProvider(); return p ? new BrowserProvider(p).getSigner() : null; };
  api.setTheme = m => { try { modal.setThemeMode(m); } catch {} };
  modal.subscribeAccount(a => { api.connected = !!a.isConnected; api.address = a.address ? a.address.toLowerCase() : null; emit(); });
  modal.subscribeNetwork(n => { api.chainId = n.chainId ? Number(n.chainId) : null; emit(); });
  emit();
} else injected();
