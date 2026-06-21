import { Command } from "commander";
import { LLMCacheManager } from "@vortex/engine";

export const cacheCommand = new Command("cache")
  .description("Manage the LLM response cache");

cacheCommand
  .command("stats")
  .description("View LLM cache statistics")
  .action(async () => {
    try {
      const stats = await LLMCacheManager.getStats();
      console.log("\nLLM Cache Statistics\n");
      console.log(`Entries:    ${stats.entries.toLocaleString()}`);
      console.log(`Hits:       ${stats.hits.toLocaleString()}`);
      const storageMB = (stats.storage / 1024 / 1024).toFixed(2);
      console.log(`Storage:    ${storageMB} MB\n`);
    } catch (err) {
      console.error("Failed to retrieve cache stats:", err);
    }
  });

cacheCommand
  .command("clear")
  .description("Clear all entries from the LLM cache")
  .action(async () => {
    try {
      await LLMCacheManager.clearCache();
      console.log("✅ LLM Cache cleared successfully.");
    } catch (err) {
      console.error("Failed to clear LLM cache:", err);
    }
  });
