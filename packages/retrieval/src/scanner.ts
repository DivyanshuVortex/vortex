import fs from 'fs';
import path from 'path';
import ignore from 'ignore';

function loadGitignore(dir : string){
    const ign = ignore();
    const gitignorePath = path.join(dir, '.gitignore');
    try {
        const content = fs.readFileSync(gitignorePath, 'utf-8');
        ign.add(content);
    }catch (e) {
        // No .gitignore file, ignore silently
    }

      ign.add(["node_modules", ".git", "dist", "build", "out", ".next",
            "coverage", "logs", "*.log", ".*"]);
    return ign;
}

const SUPPORTED_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.py', '.go']);
let totalfiles = 0;
let ignoredFilesCount = 0;

export async function* scanFiles(rootDir : string) : AsyncGenerator<string> {
    const ign = loadGitignore(rootDir);

    async function* walk(dir : string) : AsyncGenerator<string> {
        const entries = await fs.promises.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            const relativePath = path.relative(rootDir, fullPath);

            if (ign.ignores(relativePath)) {
                ignoredFilesCount++;
                continue;
            }
            totalfiles++;
            if (entry.isDirectory()) {
                yield* walk(fullPath);
            } else if (entry.isFile()) {
                if (SUPPORTED_EXTS.has(path.extname(fullPath))) {
                    yield fullPath;
                }
            }
}
    }

yield* walk(rootDir);

}
