import * as path from "path";
import * as fs from "fs";
import ignore, { Ignore } from "ignore";
import { FileClassification, FileCategory, IndexStrategy } from "./types";

// ─────────────────────────────────────────────
// Extension → Category mapping
// ─────────────────────────────────────────────

const SOURCE_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".py", ".pyw",
  ".go",
  ".rs",
  ".java", ".kt", ".kts",
  ".cpp", ".cc", ".cxx", ".hpp", ".hxx", ".c", ".h",
  ".rb",
  ".php",
  ".swift",
  ".scala",
  ".cs",
  ".lua",
  ".sh", ".bash", ".zsh",
]);

const DOC_EXTENSIONS = new Set([
  ".md", ".mdx", ".txt", ".rst", ".adoc",
]);

const CONFIG_EXTENSIONS = new Set([
  ".json", ".yaml", ".yml", ".toml", ".ini", ".cfg",
  ".xml", ".env.example",
]);

const CONFIG_FILENAMES = new Set([
  "Dockerfile", "Makefile", "Rakefile", "Gemfile",
  "Procfile", "Vagrantfile", ".editorconfig",
  ".prettierrc", ".eslintrc", ".babelrc",
  "tsconfig.json", "package.json", "turbo.json",
  "docker-compose.yml", "docker-compose.yaml",
]);

const LOCKFILE_NAMES = new Set([
  "pnpm-lock.yaml", "package-lock.json", "yarn.lock",
  "Cargo.lock", "Gemfile.lock", "poetry.lock",
  "go.sum", "composer.lock", "Pipfile.lock",
  "bun.lockb", "bun.lock",
]);

const ASSET_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".svg", ".ico", ".webp", ".avif",
  ".mp4", ".webm", ".mov", ".avi",
  ".mp3", ".wav", ".ogg", ".flac",
  ".woff", ".woff2", ".ttf", ".eot", ".otf",
  ".zip", ".tar", ".gz", ".bz2", ".7z",
  ".pdf", ".doc", ".docx", ".xls", ".xlsx",
  ".bin", ".exe", ".dll", ".so", ".dylib",
  ".wasm",
]);

const GENERATED_PATTERNS = [
  /\.generated\./,
  /\.g\.ts$/,
  /\.g\.dart$/,
  /\.pb\.go$/,
  /\.pb\.ts$/,
  /\.min\.(js|css)$/,
  /\.bundle\.(js|css)$/,
  /\.d\.ts$/,
];

const GENERATED_DIRS = new Set([
  "dist", "build", "out", ".next", "coverage",
  "__generated__", ".cache", ".turbo",
]);

const I18N_PATTERNS = [
  /\.i18n\./,
  /\.locale\./,
  /\.lang\./,
  /\.messages\./,
];

const I18N_DIRS = new Set([
  "locales", "locale", "translations", "i18n", "lang", "languages",
]);

const TEST_PATTERNS = [
  /\.test\./,
  /\.spec\./,
  /\.tests\./,
  /\.specs\./,
  /_test\./,
  /_spec\./,
];

const TEST_DIRS = new Set([
  "__tests__", "test", "tests", "spec", "specs",
  "__test__", "__spec__",
]);

// ─────────────────────────────────────────────
// Classification Logic
// ─────────────────────────────────────────────

/**
 * Classifies a file based on its path, name, and extension
 * to determine how it should be indexed.
 */
export function classifyFile(filePath: string): FileClassification {
  const ext = path.extname(filePath).toLowerCase();
  const basename = path.basename(filePath);
  const segments = filePath.split(path.sep);

  // Check if file is in a generated directory
  if (segments.some(s => GENERATED_DIRS.has(s))) {
    return { category: "generated", shouldIndex: false, shouldEmbed: false, indexStrategy: "skip" };
  }

  // Check generated file patterns
  if (GENERATED_PATTERNS.some(p => p.test(basename))) {
    return { category: "generated", shouldIndex: false, shouldEmbed: false, indexStrategy: "skip" };
  }

  // Assets (binary files)
  if (ASSET_EXTENSIONS.has(ext)) {
    return { category: "asset", shouldIndex: false, shouldEmbed: false, indexStrategy: "skip" };
  }

  // Lockfiles
  if (LOCKFILE_NAMES.has(basename)) {
    return { category: "lockfile", shouldIndex: true, shouldEmbed: false, indexStrategy: "metadata-only" };
  }

  // Localization files
  if (I18N_PATTERNS.some(p => p.test(basename)) || segments.some(s => I18N_DIRS.has(s))) {
    if (SOURCE_EXTENSIONS.has(ext) || ext === ".json" || ext === ".yaml" || ext === ".yml") {
      return { category: "localization", shouldIndex: true, shouldEmbed: true, indexStrategy: "key-aware" };
    }
  }

  // Test files (these are valuable — index them fully)
  if (TEST_PATTERNS.some(p => p.test(basename)) || segments.some(s => TEST_DIRS.has(s))) {
    if (SOURCE_EXTENSIONS.has(ext)) {
      return { category: "test", shouldIndex: true, shouldEmbed: true, indexStrategy: "ast" };
    }
  }

  // Source code
  if (SOURCE_EXTENSIONS.has(ext)) {
    return { category: "source", shouldIndex: true, shouldEmbed: true, indexStrategy: "ast" };
  }

  // Documentation
  if (DOC_EXTENSIONS.has(ext)) {
    return { category: "documentation", shouldIndex: true, shouldEmbed: true, indexStrategy: "fallback" };
  }

  // Configuration files
  if (CONFIG_EXTENSIONS.has(ext) || CONFIG_FILENAMES.has(basename)) {
    return { category: "configuration", shouldIndex: true, shouldEmbed: true, indexStrategy: "structured" };
  }

  // HTML/CSS — source-like but use fallback parser
  if (ext === ".html" || ext === ".css" || ext === ".scss" || ext === ".less") {
    return { category: "source", shouldIndex: true, shouldEmbed: true, indexStrategy: "fallback" };
  }

  // Unknown — safe fallback if it's a text-like file
  return { category: "unknown", shouldIndex: false, shouldEmbed: false, indexStrategy: "skip" };
}

// ─────────────────────────────────────────────
// .vortexignore Support
// ─────────────────────────────────────────────

/**
 * Loads ignore rules from both .gitignore and .vortexignore.
 */
export function loadIgnoreRules(rootDir: string): Ignore {
  const ign = ignore();

  // Load .gitignore
  const gitignorePath = path.join(rootDir, ".gitignore");
  try {
    const content = fs.readFileSync(gitignorePath, "utf-8");
    ign.add(content);
  } catch {
    // No .gitignore
  }

  // Load .vortexignore
  const vortexignorePath = path.join(rootDir, ".vortexignore");
  try {
    const content = fs.readFileSync(vortexignorePath, "utf-8");
    ign.add(content);
  } catch {
    // No .vortexignore
  }

  // Always ignore these directories
  ign.add([
    "node_modules", ".git", "dist", "build", "out", ".next",
    "coverage", "logs", "*.log", ".*",
  ]);

  return ign;
}

/**
 * All extensions that the pipeline may process
 * (superset of old SUPPORTED_EXTENSIONS).
 */
export const INDEXABLE_EXTENSIONS = new Set([
  ...SOURCE_EXTENSIONS,
  ...DOC_EXTENSIONS,
  ...CONFIG_EXTENSIONS,
  ".html", ".css", ".scss", ".less",
]);
