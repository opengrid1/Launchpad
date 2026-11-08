// `npm run build` (Vercel runs it on deploy): bundles the wallet island into public/rk and copies the static site into
// public/, the deploy's output directory. The API functions in api/ are deployed from the source tree as they are.
const fs = require('fs'), path = require('path'), { execSync } = require('child_process');
const out = path.join(__dirname, 'public');
fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(path.join(out, 'rk'), { recursive: true });
execSync(`npx esbuild rk/index.jsx --bundle --minify --format=esm --splitting --platform=browser --target=es2020 --jsx=automatic --define:process.env.NODE_ENV='"production"' --define:global=window --outdir=public/rk --entry-names=rk --chunk-names=c/[hash] --log-level=error`, { cwd: __dirname, stdio: 'inherit' });
for (const f of ['index.html', 'app.html', 'app.js', 'admin.html', 'logo.png', 'eth.svg', 'brands']) {
  const src = path.join(__dirname, f); if (!fs.existsSync(src)) continue;
  fs.cpSync(src, path.join(out, f), { recursive: true });
}
console.log('built public/ with', fs.readdirSync(path.join(out, 'rk', 'c')).length, 'lazy chunks');
