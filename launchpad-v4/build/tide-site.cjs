// Builds the Tidepool site into dist/tidepool: the shared site's data layer and API (built by brand-site.cjs with
// the tidepool brand) with the shared pages removed, and the Tidepool front-end (tide/) laid over it. The shared
// admin page stays at /admin. node build/tide-site.cjs [outDir]
const fs = require("fs"), path = require("path"), { execSync } = require("child_process");
const ROOT = path.join(__dirname, ".."), OUT = path.resolve(process.argv[2] || path.join(ROOT, "dist", "tidepool"));
execSync(`node ${path.join(__dirname, "brand-site.cjs")} tidepool ${OUT}`, { stdio: "inherit" });
// the shared pages the new front-end replaces (admin.html and its scripts stay)
for (const f of ["index.html", "launch.html", "token.html", "creator.html", "docs.html", "swap.html", "stake.html", "trends.html", "pg-home.js", "pg-launch.js", "pg-token.js", "pg-creator.js", "pg-swap.js", "pg-stake.js", "pg-trends.js", "chart.js", "README.md"]) { const p = path.join(OUT, f); if (fs.existsSync(p)) fs.rmSync(p); }
for (const f of fs.readdirSync(path.join(ROOT, "tide"))) fs.copyFileSync(path.join(ROOT, "tide", f), path.join(OUT, f));
// routing: clean URLs, every app path to the single page (hash routes inside), the admin page as is
const v = JSON.parse(fs.readFileSync(path.join(OUT, "vercel.json"), "utf8"));
v.rewrites = [{ source: "/token/:addr", destination: "/" }, { source: "/swap", destination: "/" }, { source: "/pools", destination: "/" }, { source: "/stake", destination: "/" }, { source: "/create", destination: "/" }, { source: "/profile", destination: "/" }, { source: "/docs", destination: "/" }];
fs.writeFileSync(path.join(OUT, "vercel.json"), JSON.stringify(v, null, 2) + "\n");
console.log("Tidepool front-end built in", path.relative(ROOT, OUT), "files:", fs.readdirSync(OUT).filter((f) => !f.startsWith(".")).join(", "));
