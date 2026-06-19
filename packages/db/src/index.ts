import { PrismaClient } from "@prisma/client";
import * as path from "path";

export const prisma = new PrismaClient({
  datasources: {
    db: {
      url: `file:${path.resolve(process.cwd(), ".vortex.db")}`,
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
}

export * from "@prisma/client";
