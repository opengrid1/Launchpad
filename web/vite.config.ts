import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

/**
 * Build-time flavor meta. index.html ships the default (wingman) title,
 * description and icons; when VITE_BRAND selects another flavor this plugin
 * rewrites them in the emitted HTML so crawlers and the first paint carry the
 * right brand, not just the runtime override in main.tsx.
 */
const FLAVOR_META: Record<string, { title: string; description: string; icon?: string }> = {
  steadypads: {
    title: "steadypads | the stable launchpad",
    description:
      "steadypads. launch tokens into real markets on Stable. Creators earn 80% of every trade's pool fee.",
    icon: "/steadypads-mark.png",
  },
  arc: {
    title: "arcx | the stable launchpad on Arc",
    description:
      "arcx. launch tokens into real Uniswap markets on Arc. Every trade pays its creator in dollars, forever.",
    icon: "/steadypads-arc-mark.png",
  },
};

function brandHtml(): Plugin {
  const meta = FLAVOR_META[String(process.env.VITE_BRAND ?? "")];
  return {
    name: "brand-html",
    transformIndexHtml(html) {
      if (!meta) return html;
      let out = html
        .replace(/<html lang="en">/, `<html lang="en" data-brand="${process.env.VITE_BRAND}">`)
        .replace(/<title>[^<]*<\/title>/, `<title>${meta.title}</title>`)
        .replace(/(<meta name="theme-color" content=")[^"]*(")/, `$1#060a09$2`)
        .replace(/(<meta\s+name="description"\s+content=")[^"]*(")/, `$1${meta.description}$2`);
      if (meta.icon) {
        const type = meta.icon.endsWith(".svg") ? "image/svg+xml" : "image/png";
        out = out
          .replace(/<link rel="icon"[^>]*>/g, "")
          .replace(/<link rel="apple-touch-icon"[^>]*>/g, "")
          .replace(
            "</head>",
            `  <link rel="icon" type="${type}" href="${meta.icon}" />\n` +
              `  <link rel="apple-touch-icon" href="${meta.icon}" />\n  </head>`,
          );
      }
      return out;
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), brandHtml()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          wallet: ["wagmi", "viem"],
        },
      },
    },
  },
});
