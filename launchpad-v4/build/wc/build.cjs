// Bundles Reown AppKit (the wallet modal, ethers adapter) for the Kinex site into tide/wc/, as ES module chunks the
// site imports only when someone opens the wallet modal (AppKit loads its views on demand, so most chunks stay unloaded).
// Run after `npm install` here: node build/wc/build.cjs
const path = require('path'), fs = require('fs');
const out = path.join(__dirname, '../../tide/wc');
fs.rmSync(out, { recursive: true, force: true }); fs.rmSync(path.join(__dirname, '../../tide/wc.js'), { force: true });
require('esbuild').buildSync({ entryPoints: { appkit: path.join(__dirname, 'entry.js') }, bundle: true, splitting: true, minify: true, format: 'esm', target: 'es2020', platform: 'browser', outdir: out, chunkNames: 'c/[hash]', define: { 'process.env.NODE_ENV': '"production"', global: 'globalThis' }, legalComments: 'none', logLevel: 'warning' });
const files = fs.readdirSync(out, { recursive: true }).filter((f) => f.endsWith('.js'));
console.log('built tide/wc/:', files.length, 'files, entry', fs.statSync(path.join(out, 'appkit.js')).size, 'bytes');
