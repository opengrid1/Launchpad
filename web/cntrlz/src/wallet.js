/* cntrl-z.fun wallet layer: Reown AppKit (ethers adapter) when a project id is set, otherwise the
   browser's injected wallet (EIP-1193). Exposes window.bsWallet and fires 'bs:wallet' on changes. */
import { createAppKit } from '@reown/appkit';
import { EthersAdapter } from '@reown/appkit-adapter-ethers';
import { mainnet } from '@reown/appkit/networks';
import { BrowserProvider, Contract, Interface, JsonRpcProvider, getAddress } from 'ethers';

const CFG = window.UNDO || {};
const CHAIN_ID = CFG.chainId || 1;
const api = {
  ready: false, connected: false, address: null, chainId: null, kind: null,
  open() {}, logout() {}, async getSigner() { return null; }, async switchChain() {},
  short() { return this.address ? this.address.slice(0, 6) + '…' + this.address.slice(-4) : ''; },
};
window.bsWallet = api;
window.udEthers = { BrowserProvider, Contract, Interface, JsonRpcProvider, getAddress };
const emit = () => window.dispatchEvent(new CustomEvent('bs:wallet', { detail: { connected: api.connected, address: api.address, chainId: api.chainId } }));
const dark = () => false;

function injected() {
  const eth = window.ethereum; if (!eth) { api.open = () => window.dispatchEvent(new CustomEvent('bs:nowallet')); api.ready = true; return; }
  api.kind = 'injected'; api.ready = true;
  const sync = async () => { try { const acc = await eth.request({ method: 'eth_accounts' }); const cid = await eth.request({ method: 'eth_chainId' }); api.address = acc[0] ? acc[0].toLowerCase() : null; api.connected = !!api.address && !localStorage.getItem('ud:loggedout'); api.chainId = Number(cid); } catch {} emit(); };
  api.open = async () => { try { localStorage.removeItem('ud:loggedout'); } catch {} await eth.request({ method: 'eth_requestAccounts' }); await sync(); };
  api.logout = () => { try { localStorage.setItem('ud:loggedout', '1'); } catch {} api.connected = false; emit(); };
  api.switchChain = async () => { await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x' + CHAIN_ID.toString(16) }] }); await sync(); };
  api.getSigner = async () => new BrowserProvider(eth).getSigner();
  eth.on && eth.on('accountsChanged', sync); eth.on && eth.on('chainChanged', sync);
  sync();
}

if (CFG.reownProjectId && !CFG.injectedOnly) {
  const modal = createAppKit({
    adapters: [new EthersAdapter()], networks: [mainnet], defaultNetwork: mainnet, projectId: CFG.reownProjectId,
    metadata: { name: 'cntrl-z.fun', description: 'Coins where every buy can be cancelled inside a window', url: location.origin, icons: [location.origin + '/img/mark-512.png'] },
    themeMode: dark() ? 'dark' : 'light',
    themeVariables: { '--w3m-accent': '#8a6d00', '--w3m-font-family': "'Instrument Sans', system-ui, sans-serif", '--w3m-border-radius-master': '3px', '--w3m-z-index': 2000 },
    features: { analytics: false, email: false, socials: false, swaps: false, onramp: false, send: false, history: false }, allWallets: 'SHOW', enableWalletGuide: false,
  });
  api.kind = 'reown'; api.ready = true;
  api.open = () => modal.open(); api.logout = () => modal.disconnect(); api.switchChain = () => modal.switchNetwork(mainnet);
  api.getSigner = async () => { const p = modal.getWalletProvider(); return p ? new BrowserProvider(p).getSigner() : null; };
  api.setTheme = m => { try { modal.setThemeMode(m); } catch {} };
  modal.subscribeAccount(a => { api.connected = !!a.isConnected; api.address = a.address ? a.address.toLowerCase() : null; emit(); });
  modal.subscribeNetwork(n => { api.chainId = n.chainId ? Number(n.chainId) : null; emit(); });
  emit();
} else injected();
