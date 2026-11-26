// The wallet layer: RainbowKit + wagmi mounted as a hidden React island. The page (app.js) stays plain JavaScript and
// talks to it through window.RK: open() shows the connect modal, account() the account modal, disconnect(), and
// listeners get {address, provider, chainId, name} whenever the connection changes. Built by `npm run rk` into rk.js.
import React, { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { WagmiProvider, createConfig, http, useAccount, useDisconnect, useSwitchChain } from 'wagmi';
import { mainnet } from 'wagmi/chains';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RainbowKitProvider, connectorsForWallets, darkTheme, useConnectModal, useAccountModal } from '@rainbow-me/rainbowkit';
import { metaMaskWallet, coinbaseWallet, rainbowWallet, trustWallet, rabbyWallet, phantomWallet, walletConnectWallet } from '@rainbow-me/rainbowkit/wallets';
import '@rainbow-me/rainbowkit/styles.css';

const RK = (window.RK = window.RK || { listeners: [] });
// WalletConnect (phone wallets through a QR code) needs a Reown Cloud project id; set window.WC_PROJECT_ID in app.html
const projectId = window.WC_PROJECT_ID || '00000000000000000000000000000000';

const connectors = connectorsForWallets(
  [{ groupName: 'Popular', wallets: [metaMaskWallet, coinbaseWallet, rainbowWallet, trustWallet, rabbyWallet, phantomWallet, walletConnectWallet] }],
  { appName: 'Zappy', appUrl: 'https://zappy.fun', appIcon: 'https://zappy.fun/logo.png', projectId },
);
const config = createConfig({ connectors, chains: [mainnet], transports: { [mainnet.id]: http('https://ethereum-rpc.publicnode.com') }, ssr: false });
const queryClient = new QueryClient();

const theme = darkTheme({ accentColor: '#4ade80', accentColorForeground: '#04150a', borderRadius: 'medium', fontStack: 'system', overlayBlur: 'small' });
Object.assign(theme.colors, { modalBackground: '#111619', modalBorder: '#1c2428', profileForeground: '#111619', generalBorder: '#1c2428', menuItemBackground: '#171d21', modalText: '#e7ecea', modalTextSecondary: '#8a9396', closeButtonBackground: '#171d21', closeButton: '#b3bcbb', actionButtonBorder: '#1c2428', actionButtonSecondaryBackground: '#171d21', connectButtonBackground: '#171d21', selectedOptionBorder: '#263034' });
theme.fonts.body = 'Geist, system-ui, -apple-system, "Segoe UI", sans-serif';

function Bridge() {
  const { address, connector, isConnected, chainId } = useAccount();
  const { openConnectModal } = useConnectModal(); const { openAccountModal } = useAccountModal();
  const { disconnectAsync } = useDisconnect(); const { switchChainAsync } = useSwitchChain();
  useEffect(() => { Object.assign(RK, { open: openConnectModal, account: openAccountModal, disconnect: () => disconnectAsync().catch(() => {}), switchChain: () => switchChainAsync({ chainId: mainnet.id }), ready: true }); RK.onReady && RK.onReady(); }, [openConnectModal, openAccountModal, disconnectAsync, switchChainAsync]);
  useEffect(() => {
    let live = true;
    (async () => {
      const provider = isConnected && connector ? await connector.getProvider().catch(() => null) : null;
      if (!live) return;
      RK.state = { address: isConnected && address ? address : '', provider, chainId: chainId || 0, name: connector ? connector.name : '' };
      for (const f of RK.listeners) { try { f(RK.state); } catch (e) { console.error(e); } }
    })();
    return () => { live = false; };
  }, [address, connector, isConnected, chainId]);
  return null;
}

const host = document.createElement('div'); host.id = 'rk'; document.body.appendChild(host);
createRoot(host).render(
  <WagmiProvider config={config}><QueryClientProvider client={queryClient}>
    <RainbowKitProvider theme={theme} appInfo={{ appName: 'Zappy' }} modalSize="compact" initialChain={mainnet}><Bridge /></RainbowKitProvider>
  </QueryClientProvider></WagmiProvider>,
);
