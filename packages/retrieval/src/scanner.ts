import fs from "fs";
import path from "path";
import { classifyFile, loadIgnoreRules, INDEXABLE_EXTENSIONS } from "./classifier";
import { FileClassification } from "./types";

/**
 * Result from the file scanner including classification.
 */
export interface ScannedFile {
  /** Absolute path to the file */
  path: string;
  /** Classification result */
  classification: FileClassification;
}

/**
 * Scans a directory tree and yields files with their classifications.
 *
 * Respects .gitignore, .vortexignore, and built-in exclusion rules.
 * Each yielded file includes its classification for the indexing pipeline.
 */
export async function* scanFiles(rootDir: string): AsyncGenerator<ScannedFile> {
  const ign = loadIgnoreRules(rootDir);

  async function* walk(dir: string): AsyncGenerator<ScannedFile> {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relativePath = path.relative(rootDir, fullPath);

      if (ign.ignores(relativePath)) {
        continue;
      }

      if (entry.isDirectory()) {
        yield* walk(fullPath);
      } else if (entry.isFile()) {
        const classification = classifyFile(fullPath);
        if (classification.shouldIndex) {
          yield { path: fullPath, classification };
        }
      }
    }
  }

  yield* walk(rootDir);
}

/**
 * Legacy-compatible scanner that yields just file paths.
 * Used for backward compatibility with code that expects string paths.
 */
export async function* scanFilePaths(rootDir: string): AsyncGenerator<string> {
  for await (const scanned of scanFiles(rootDir)) {
    yield scanned.path;
  }
}
