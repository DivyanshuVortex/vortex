import fs from 'fs';
import path from 'path';
import ignore from 'ignore';
import { SUPPORTED_EXTENSIONS } from '@vortex/shared';

function loadGitignore(dir : string){
    const ign = ignore();
    const gitignorePath = path.join(dir, '.gitignore');
    try {
        const content = fs.readFileSync(gitignorePath, 'utf-8');
        ign.add(content);
    }catch (e) {
    }

      ign.add(["node_modules", ".git", "dist", "build", "out", ".next",
            "coverage", "logs", "*.log", ".*"]);
    return ign;
}

export async function* scanFiles(rootDir : string) : AsyncGenerator<string> {
    const ign = loadGitignore(rootDir);
    let totalFiles = 0;
    let ignoredFilesCount = 0;

    async function* walk(dir : string) : AsyncGenerator<string> {
        const entries = await fs.promises.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            const relativePath = path.relative(rootDir, fullPath);

            if (ign.ignores(relativePath)) {
                ignoredFilesCount++;
                continue;
            }
            if (entry.isDirectory()) {
                yield* walk(fullPath);
            } else if (entry.isFile()) {
                totalFiles++;
                if (SUPPORTED_EXTENSIONS.has(path.extname(fullPath))) {
                    yield fullPath;
                }
            }
        }
    }

    yield* walk(rootDir);
}
