# Wallet layer

Reown AppKit with the ethers adapter, bundled into `../wallet.js`:

```
npm install
npx esbuild wallet.js --bundle --minify --format=iife --target=es2020 --platform=browser --define:process.env.NODE_ENV='"production"' --outfile=../wallet.js
```

The project id lives in `../config.js` (`window.INKY.reownProjectId`); an empty id keeps the demo wallet.
