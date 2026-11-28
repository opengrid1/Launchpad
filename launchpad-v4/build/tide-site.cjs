// Builds the Tidepool site into dist/tidepool: the shared site's data layer and API (built by brand-site.cjs with
// the tidepool brand) with the shared pages removed, and the Tidepool front-end (tide/) laid over it. The shared
// admin page stays at /admin. node build/tide-site.cjs [outDir] [brand]
// Another brand on the same front-end (KinetiqPump) names itself as the second argument: its brand.json's `tide` rules
// then rewrite the front-end's own text (the brand name, the ticker, what differs in its terms), each rule either
// [text, replacement] or [{ re, flags }, replacement], and its `tideCss` is appended to tide.css.
const fs = require("fs"), path = require("path"), { execSync } = require("child_process");
const BRAND = process.argv[3] || "tidepool";
const ROOT = path.join(__dirname, ".."), OUT = path.resolve(process.argv[2] || path.join(ROOT, "dist", BRAND));
const spec = JSON.parse(fs.readFileSync(path.join(ROOT, "brands", BRAND, "brand.json"), "utf8"));
execSync(`node ${path.join(__dirname, "brand-site.cjs")} ${BRAND} ${OUT}`, { stdio: "inherit" });
// the shared pages the new front-end replaces (admin.html and its scripts stay)
for (const f of ["index.html", "launch.html", "token.html", "creator.html", "docs.html", "swap.html", "stake.html", "trends.html", "pg-home.js", "pg-launch.js", "pg-token.js", "pg-creator.js", "pg-swap.js", "pg-stake.js", "pg-trends.js", "chart.js", "README.md", "amm.js"]) { const p = path.join(OUT, f); if (fs.existsSync(p)) fs.rmSync(p); }
fs.cpSync(path.join(ROOT, "tide"), OUT, { recursive: true }); // the front-end, including the wallet modal chunks in wc/
if (spec.tide || spec.tideCss) {
  const missed = [];
  for (const f of fs.readdirSync(path.join(ROOT, "tide"))) {
    if (!/\.(html|js|css)$/.test(f)) continue;
    let t = fs.readFileSync(path.join(OUT, f), "utf8");
    for (const [a, b] of spec.tide || []) t = typeof a === "string" ? t.split(a).join(b) : t.replace(new RegExp(a.re, a.flags || "g"), b);
    if (f === "tide.css" && spec.tideCss) t += "\n/* brand: " + spec.name + " */\n" + spec.tideCss + "\n";
    fs.writeFileSync(path.join(OUT, f), t);
  }
  const all = fs.readdirSync(path.join(ROOT, "tide")).filter((f) => /\.(html|js|css)$/.test(f)).map((f) => fs.readFileSync(path.join(ROOT, "tide", f), "utf8")).join("\n");
  for (const [a] of spec.tide || []) if (typeof a === "string" ? !all.includes(a) : !new RegExp(a.re, a.flags || "g").test(all)) missed.push(typeof a === "string" ? a.slice(0, 60) : a.re);
  if (missed.length) console.warn("tide rules that matched nothing (the front-end text changed?):\n  " + missed.join("\n  "));
}
// the admin page's contract interfaces come from the compiled pad contracts (one position per launch, the pair in the
// launch config), laid over the shared abi.js, so the owner tools match the deployed code; a brand names its hook's
// artifact in brand.json (`hookArtifact`) when it is not Kinex's (KinetiqPump's has its fee fixed at deployment)
{
  const { ethers } = require(path.join(ROOT, "node_modules/ethers"));
  const src = fs.readFileSync(path.join(OUT, "abi.js"), "utf8"), w = {}; new Function("window", src)(w);
  const art = (n) => new ethers.Interface(JSON.parse(fs.readFileSync(path.join(ROOT, "artifacts", n + ".json"), "utf8")).abi).format();
  Object.assign(w.ABI, { factory: art("PadFactory"), hook: art(spec.hookArtifact || "PadHook"), locker: art("PadLocker"), vault: art("PadBuybackVault"), escrow: art("PadFeeEscrow") });
  fs.writeFileSync(path.join(OUT, "abi.js"), "window.ABI = " + JSON.stringify(w.ABI) + ";\n");
}
// the admin page is unlisted: no links to it, and search engines are told to skip it
const ap = path.join(OUT, "admin.html"); if (fs.existsSync(ap)) fs.writeFileSync(ap, fs.readFileSync(ap, "utf8").replace("<head>", '<head><meta name="robots" content="noindex,nofollow">'));
// routing: clean URLs, every app path to the single page (hash routes inside), the admin page as is
const v = JSON.parse(fs.readFileSync(path.join(OUT, "vercel.json"), "utf8"));
v.rewrites = ["/token/:addr", "/launch", "/create", "/bridge", "/bridge/:sub", "/airdrop", "/flywheel", "/fees", "/profile", "/profile/:addr", "/docs"].map((source) => ({ source, destination: "/" }));
v.rewrites.unshift({ source: "/favicon.ico", destination: "/img/favicon.ico" });
// the web app manifest: name, icons and colours for home-screen installs
fs.writeFileSync(path.join(OUT, "site.webmanifest"), JSON.stringify({ name: spec.name, short_name: spec.name, icons: [{ src: "/img/icon-192.png", sizes: "192x192", type: "image/png" }, { src: "/img/icon-512.png", sizes: "512x512", type: "image/png" }], theme_color: "#f3f5f2", background_color: "#f3f5f2", display: "standalone", start_url: "/" }, null, 2) + "\n");
fs.writeFileSync(path.join(OUT, "vercel.json"), JSON.stringify(v, null, 2) + "\n");
console.log(spec.name + " front-end built in", path.relative(ROOT, OUT), "files:", fs.readdirSync(OUT).filter((f) => !f.startsWith(".")).join(", "));
