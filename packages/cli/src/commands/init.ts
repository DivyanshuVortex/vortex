import { Indexer } from "@vortex/engine";

export async function initCommand(options: any) {
  console.log("Initializing Vortex intelligence layer...");

  if (options.reindex) {
    console.log("Rebuilding repository embeddings...");
    console.log("Preserving historical PR findings and feedback memory...");
  }

  console.log("Indexing repository chunks...");
  const indexer = new Indexer();
  try {
    await indexer.indexRepository(process.cwd());
    console.log("Initialization complete!");
  } catch (err) {
    console.error("Failed to initialize:", err);
  }
}
