// Builds the Hypex site into dist/hypex: the shared site's data layer (built by brand-site.cjs with the hypex brand)
// with the shared pages removed, and the Hypex front-end (hypex/) laid over it. Design preview for now: the brand
// config runs in demo mode on /demo-state.json, and the admin page is left out. node build/hypex-site.cjs [outDir]
const fs = require("fs"), path = require("path"), { execSync } = require("child_process");
const ROOT = path.join(__dirname, ".."), OUT = path.resolve(process.argv[2] || path.join(ROOT, "dist", "hypex"));
execSync(`node ${path.join(__dirname, "brand-site.cjs")} hypex ${OUT}`, { stdio: "inherit" });
for (const f of ["index.html", "launch.html", "token.html", "creator.html", "docs.html", "swap.html", "stake.html", "trends.html", "admin.html", "pg-admin.js", "pg-home.js", "pg-launch.js", "pg-token.js", "pg-creator.js", "pg-swap.js", "pg-stake.js", "pg-trends.js", "chart.js", "README.md", "amm.js"]) { const p = path.join(OUT, f); if (fs.existsSync(p)) fs.rmSync(p); }
fs.cpSync(path.join(ROOT, "hypex"), OUT, { recursive: true }); // the front-end, including the wallet modal chunks in wc/
const v = JSON.parse(fs.readFileSync(path.join(OUT, "vercel.json"), "utf8"));
v.rewrites = ["/token/:addr", "/launch", "/create", "/airdrop", "/floor", "/fees", "/profile", "/profile/:addr", "/docs"].map((source) => ({ source, destination: "/" }));
v.rewrites.unshift({ source: "/favicon.ico", destination: "/img/favicon.ico" });
delete v.crons; // no keeper jobs until the contracts exist
v.headers = [...(v.headers || []), { source: "/(.*)", headers: [{ key: "X-Robots-Tag", value: "noindex" }] }]; // preview: kept out of search
fs.writeFileSync(path.join(OUT, "site.webmanifest"), JSON.stringify({ name: "Hypex", short_name: "Hypex", icons: [{ src: "/img/icon-192.png", sizes: "192x192", type: "image/png" }, { src: "/img/icon-512.png", sizes: "512x512", type: "image/png" }], theme_color: "#07080a", background_color: "#07080a", display: "standalone", start_url: "/" }, null, 2) + "\n");
fs.writeFileSync(path.join(OUT, "vercel.json"), JSON.stringify(v, null, 2) + "\n");
console.log("Hypex front-end built in", path.relative(ROOT, OUT));
