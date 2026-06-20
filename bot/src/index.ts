import { createBot } from "./telegram.js";
import { WALLET_ADDRESS } from "./chain.js";
import { config } from "./config.js";

async function main() {
  const bot = createBot();
  console.log(`[bot] wallet: ${WALLET_ADDRESS}`);
  console.log(`[bot] mode:   ${config.dryRun ? "DRY RUN" : "LIVE"}`);
  console.log(`[bot] allowed ids: ${config.allowedIds.join(", ") || "(none — trading locked)"}`);

  const me = await bot.api.getMe();
  console.log(`[bot] starting @${me.username} …`);

  process.once("SIGINT", () => bot.stop());
  process.once("SIGTERM", () => bot.stop());
  await bot.start({ onStart: (i) => console.log(`[bot] @${i.username} online`) });
}

main().catch((err) => {
  console.error("[bot] fatal:", err);
  process.exit(1);
});
