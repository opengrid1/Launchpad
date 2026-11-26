// Reown AppKit: the wallet modal (installed browser wallets, WalletConnect QR, mobile wallets) on the ethers adapter
import { createAppKit } from '@reown/appkit';
import { EthersAdapter } from '@reown/appkit-adapter-ethers';
window.KinexAppKit = { createAppKit, EthersAdapter };
