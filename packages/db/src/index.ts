import { PrismaClient } from "@prisma/client";
import * as path from "path";

export const prisma = new PrismaClient({
  datasources: {
    db: {
      url: `file:${path.resolve(process.cwd(), ".vortex.db")}`,
    },
  },
});
export * from "@prisma/client";
