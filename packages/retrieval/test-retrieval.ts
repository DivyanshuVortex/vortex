import { scanFiles } from "./src/scanner";
import { chunkFile } from "./src/chunker";
import * as path from "path";

async function main() {
  console.log("--- Testing Scanner ---");

  const rootDir =
    "/home/divyanshu/projects/projects/well-ready/templates";

  let count = 0;

  for await (const file of scanFiles(rootDir)) {
    console.log(
      `Found file: ${path.relative(rootDir, file)}`
    );

    console.log("\n--- Testing Chunker ---");

    console.log(`Chunking file: ${file}`);

    const chunks = chunkFile(file);

    console.log(
      `Generated ${chunks.length} chunks.`
    );

    if (chunks.length > 0) {
      console.log(
        "First chunk name:",
        chunks[0].name
      );

      console.log(
        "First chunk kind:",
        chunks[0].kind
      );
    }

    count++;

    if (count >= 50) break;
  }

  console.log(
    `Total files found (capped at 5): ${count}`
  );
}

main().catch(console.error);