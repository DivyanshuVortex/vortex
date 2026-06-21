import { PrismaClient } from "@prisma/client";
import * as path from "path";
export { findProjectRoot } from "./findRoot";
import { findProjectRoot } from "./findRoot";

const projectRoot = findProjectRoot(process.cwd());
const dbPath = path.join(projectRoot, ".vortex.db");

export const prisma = new PrismaClient({
  datasources: {
    db: {
      url: `file:${dbPath}`,
    },
  },
});

export async function initDatabase() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "Chunk" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "file" TEXT NOT NULL,
      "language" TEXT NOT NULL,
      "name" TEXT NOT NULL,
      "symbolPath" TEXT NOT NULL,
      "kind" TEXT NOT NULL,
      "parent" TEXT,
      "isExported" BOOLEAN NOT NULL,
      "isAsync" BOOLEAN NOT NULL,
      "signature" TEXT,
      "dependencies" TEXT NOT NULL,
      "startLine" INTEGER NOT NULL,
      "endLine" INTEGER NOT NULL,
      "hash" TEXT NOT NULL,
      "content" TEXT NOT NULL,
      "embedding" TEXT,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "Memory" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "type" TEXT NOT NULL,
      "content" TEXT NOT NULL,
      "source" TEXT NOT NULL,
      "tags" TEXT NOT NULL,
      "embedding" TEXT,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "ReviewHistory" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "prNumber" INTEGER NOT NULL,
      "owner" TEXT NOT NULL,
      "repo" TEXT NOT NULL,
      "verdict" TEXT NOT NULL,
      "summary" TEXT NOT NULL,
      "findings" TEXT NOT NULL,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "LLMCache" (
      "key" TEXT NOT NULL PRIMARY KEY,
      "model" TEXT NOT NULL,
      "response" TEXT NOT NULL,
      "promptHash" TEXT NOT NULL,
      "contextHash" TEXT NOT NULL,
      "commitHash" TEXT,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "lastAccessedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "hitCount" INTEGER NOT NULL DEFAULT 0
    );
  `);
}

export * from "@prisma/client";
