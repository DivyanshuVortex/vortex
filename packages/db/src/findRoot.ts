import * as fs from "fs";
import * as path from "path";

export function findProjectRoot(startDir: string): string {
  let currentDir = startDir;
  while (currentDir !== path.parse(currentDir).root) {
    if (fs.existsSync(path.join(currentDir, ".vortex.db"))) {
      return currentDir;
    }
    // Fallback to git root if no db exists yet
    if (fs.existsSync(path.join(currentDir, ".git"))) {
      return currentDir;
    }
    currentDir = path.dirname(currentDir);
  }
  return startDir;
}
