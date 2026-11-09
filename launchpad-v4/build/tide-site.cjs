// Builds the Tidepool site into dist/tidepool: the shared site's data layer and API (built by brand-site.cjs with
// the tidepool brand) with the shared pages removed, and the Tidepool front-end (tide/) laid over it. The shared
// admin page stays at /admin. node build/tide-site.cjs [outDir]
const fs = require("fs"), path = require("path"), { execSync } = require("child_process");
const ROOT = path.join(__dirname, ".."), OUT = path.resolve(process.argv[2] || path.join(ROOT, "dist", "tidepool"));
execSync(`node ${path.join(__dirname, "brand-site.cjs")} tidepool ${OUT}`, { stdio: "inherit" });
// the shared pages the new front-end replaces (admin.html and its scripts stay)
for (const f of ["index.html", "launch.html", "token.html", "creator.html", "docs.html", "swap.html", "stake.html", "trends.html", "pg-home.js", "pg-launch.js", "pg-token.js", "pg-creator.js", "pg-swap.js", "pg-stake.js", "pg-trends.js", "chart.js", "README.md", "amm.js"]) { const p = path.join(OUT, f); if (fs.existsSync(p)) fs.rmSync(p); }
for (const f of fs.readdirSync(path.join(ROOT, "tide"))) fs.copyFileSync(path.join(ROOT, "tide", f), path.join(OUT, f));
// the admin page is unlisted: no links to it, and search engines are told to skip it
const ap = path.join(OUT, "admin.html"); if (fs.existsSync(ap)) fs.writeFileSync(ap, fs.readFileSync(ap, "utf8").replace("<head>", '<head><meta name="robots" content="noindex,nofollow">'));
// routing: clean URLs, every app path to the single page (hash routes inside), the admin page as is
const v = JSON.parse(fs.readFileSync(path.join(OUT, "vercel.json"), "utf8"));
v.rewrites = ["/token/:addr", "/launch", "/create", "/bridge", "/bridge/:sub", "/airdrop", "/flywheel", "/fees", "/profile", "/profile/:addr", "/docs"].map((source) => ({ source, destination: "/" }));
v.rewrites.unshift({ source: "/favicon.ico", destination: "/img/favicon.ico" });
// the web app manifest: name, icons and colours for home-screen installs
fs.writeFileSync(path.join(OUT, "site.webmanifest"), JSON.stringify({ name: "Kinex", short_name: "Kinex", icons: [{ src: "/img/icon-192.png", sizes: "192x192", type: "image/png" }, { src: "/img/icon-512.png", sizes: "512x512", type: "image/png" }], theme_color: "#f3f5f2", background_color: "#f3f5f2", display: "standalone", start_url: "/" }, null, 2) + "\n");
fs.writeFileSync(path.join(OUT, "vercel.json"), JSON.stringify(v, null, 2) + "\n");
console.log("Kinex front-end built in", path.relative(ROOT, OUT), "files:", fs.readdirSync(OUT).filter((f) => !f.startsWith(".")).join(", "));
