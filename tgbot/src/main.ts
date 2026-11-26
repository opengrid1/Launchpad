import { bot, setCommands } from "./bot.js";
import { load } from "./store.js";

load();
await setCommands();
console.log("chipfi bot up");
bot.start({ onStart: (me) => console.log(`@${me.username} polling`) });
