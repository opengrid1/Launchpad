// A scripted EIP-1193 wallet for Playwright: signs through the Hardhat fork node's
// unlocked or impersonated accounts.
export const injected = (account, rpc) => `
(() => {
  const listeners = {};
  let id = 1;
  const call = async (method, params) => {
    const r = await fetch(${JSON.stringify(rpc)}, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: id++, method, params: params ?? [] }) });
    const j = await r.json();
    if (j.error) { const e = new Error(j.error.message); e.code = j.error.code; e.data = j.error.data; throw e; }
    return j.result;
  };
  const provider = {
    isMetaMask: true, isEstonksTest: true, selectedAddress: ${JSON.stringify(account)}, chainId: '0x1', networkVersion: '1',
    request: async ({ method, params }) => {
      switch (method) {
        case 'eth_requestAccounts': case 'eth_accounts': return [${JSON.stringify(account)}];
        case 'eth_chainId': return '0x1';
        case 'net_version': return '1';
        case 'wallet_switchEthereumChain': case 'wallet_addEthereumChain': return null;
        case 'wallet_getPermissions': case 'wallet_requestPermissions': return [{ parentCapability: 'eth_accounts' }];
        case 'wallet_getCapabilities': return {};
        case 'eth_sendTransaction': { const tx = { ...params[0], from: ${JSON.stringify(account)} }; delete tx.gas; delete tx.type; delete tx.maxFeePerGas; delete tx.maxPriorityFeePerGas; return call('eth_sendTransaction', [tx]); }
        case 'personal_sign': case 'eth_signTypedData_v4': throw Object.assign(new Error('unsupported in test'), { code: 4200 });
        default: return call(method, params);
      }
    },
    on: (ev, fn) => { (listeners[ev] ||= []).push(fn); return provider; },
    removeListener: (ev, fn) => { listeners[ev] = (listeners[ev] || []).filter((f) => f !== fn); return provider; },
    emit: (ev, ...a) => (listeners[ev] || []).forEach((f) => f(...a)),
  };
  Object.defineProperty(window, 'ethereum', { value: provider, configurable: false, writable: false });
  window.dispatchEvent(new Event('ethereum#initialized'));
  // EIP-6963 so wagmi's injected discovery finds it too.
  const info = { uuid: '5f3d1a2e-0000-4000-8000-estonkstest01', name: 'Estonks Test Wallet', icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>', rdns: 'fun.estonks.test' };
  const announce = () => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: Object.freeze({ info, provider }) }));
  window.addEventListener('eip6963:requestProvider', announce); announce();
})();`;
