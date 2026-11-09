// Bundles WalletConnect (Reown) for the Kinex site into tide/wc.js, a single file the site loads only when someone
// picks WalletConnect. Run after `npm install` here: node build/wc/build.cjs
const path = require('path');
require('esbuild').buildSync({ entryPoints: [path.join(__dirname, 'entry.js')], bundle: true, minify: true, format: 'iife', target: 'es2020', platform: 'browser', outfile: path.join(__dirname, '../../tide/wc.js'), define: { 'process.env.NODE_ENV': '"production"', global: 'globalThis' }, legalComments: 'none', logLevel: 'warning' });
console.log('built tide/wc.js');
