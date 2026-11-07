// Builds a branded copy of the site for its own Vercel project: node build/brand-site.cjs <brand> [outDir]
// brands/<brand>/config.js replaces site/config.js, brands/<brand>/img/* is laid over site/img, the brand's theme
// is appended to ui.css, and brand.json's replace rules (in order) rewrite the page text: all rules on the
// top-level .html and .js files, the brand-name rules (those without HYPE or a chain name) on api/*.js.
// The output (default dist/<brand>) is deployed with `vercel deploy --cwd dist/<brand>`.
const fs = require("fs"), path = require("path");
const brand = process.argv[2]; if (!brand) throw new Error("usage: node build/brand-site.cjs <brand> [outDir]");
const ROOT = path.join(__dirname, ".."), SITE = path.join(ROOT, "site"), B = path.join(ROOT, "brands", brand);
const OUT = path.resolve(process.argv[3] || path.join(ROOT, "dist", brand));
const spec = JSON.parse(fs.readFileSync(path.join(B, "brand.json"), "utf8"));
const SKIP = new Set(["node_modules", ".vercel", ".env.local", ".env", "uploads"]);

const LINK = path.join(OUT, ".vercel"), keep = fs.existsSync(LINK) ? fs.mkdtempSync(path.join(require("os").tmpdir(), "vl-")) : null; // the Vercel project link survives rebuilds
if (keep) fs.cpSync(LINK, keep, { recursive: true });
fs.rmSync(OUT, { recursive: true, force: true });
(function copy(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    if (SKIP.has(e.name) || e.name.startsWith(".env")) continue;
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (e.isDirectory()) copy(s, d); else fs.copyFileSync(s, d);
  }
})(SITE, OUT);
for (const f of [".vercelignore"]) if (fs.existsSync(path.join(SITE, f))) fs.copyFileSync(path.join(SITE, f), path.join(OUT, f));

if (keep) fs.cpSync(keep, LINK, { recursive: true });
fs.copyFileSync(path.join(B, "config.js"), path.join(OUT, "config.js"));
const IMG = path.join(B, "img"); if (fs.existsSync(IMG)) for (const f of fs.readdirSync(IMG)) fs.copyFileSync(path.join(IMG, f), path.join(OUT, "img", f));
const BAPI = path.join(B, "api"); if (fs.existsSync(BAPI)) for (const f of fs.readdirSync(BAPI)) fs.copyFileSync(path.join(BAPI, f), path.join(OUT, "api", f)); // brand data the API reads (e.g. _pairs.json)
if (spec.crons) { const vj = JSON.parse(fs.readFileSync(path.join(OUT, "vercel.json"), "utf8")); vj.crons = [...(vj.crons || []), ...spec.crons]; fs.writeFileSync(path.join(OUT, "vercel.json"), JSON.stringify(vj, null, 2) + "\n"); } // brand-only jobs
for (const f of spec.drop || []) fs.rmSync(path.join(OUT, f), { force: true }); // features this brand leaves out
if (spec.theme) fs.appendFileSync(path.join(OUT, "ui.css"), "\n/* brand: " + spec.name + " */\n" + spec.theme + "\n");

const chainWords = /HYPE|Hyper|Elysium|ETH|Ethereum/;
const brandRules = spec.replace.filter(([a, b]) => !chainWords.test(a) && !chainWords.test(b));
const skip = new Set(spec.skipFiles || []), counts = new Map();
function rewrite(file, rules) {
  let s = fs.readFileSync(file, "utf8"); const before = s;
  for (const [a, b] of rules) { const n = s.split(a).length - 1; if (n) { s = s.split(a).join(b); counts.set(a, (counts.get(a) || 0) + n); } }
  if (s !== before) fs.writeFileSync(file, s);
}
for (const f of fs.readdirSync(OUT)) if (/\.(html|js)$/.test(f) && !skip.has(f)) rewrite(path.join(OUT, f), spec.replace);
for (const f of fs.readdirSync(path.join(OUT, "api"))) if (f.endsWith(".js")) rewrite(path.join(OUT, "api", f), brandRules);

const unused = spec.replace.filter(([a]) => !counts.get(a)).map(([a]) => a.slice(0, 60));
if (unused.length) console.warn("rules that matched nothing (the site text changed?):\n  " + unused.join("\n  "));
const left = fs.readdirSync(OUT).filter((f) => /\.html$/.test(f)).flatMap((f) => (fs.readFileSync(path.join(OUT, f), "utf8").match(/[^\n]{0,40}(LiquidFi|HyperEVM|Elysium|HYPE)[^\n]{0,40}/g) || []).map((m) => f + ": " + m.trim()));
if (left.length) console.warn("old brand or chain text still in the pages:\n  " + left.join("\n  "));
console.log(`${spec.name} site built in ${path.relative(ROOT, OUT)}`);
