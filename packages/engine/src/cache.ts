import { prisma } from "@vortex/db";
import * as crypto from "crypto";

export interface CacheKeyParams {
  provider: string;
  model: string;
  userPrompt: string;
  systemPrompt?: string;
  retrievalContextHash?: string;
  commitHash?: string;
  temperature?: number;
}

export class LLMCacheManager {
  private static sessionCache = new Map<string, Promise<string>>();
  /**
   * Generates a deterministic SHA-256 cache key.
   */
  public static generateCacheKey(params: CacheKeyParams): { key: string; promptHash: string; contextHash: string } {
    const promptHash = crypto
      .createHash("sha256")
      .update(params.systemPrompt || "")
      .update(params.userPrompt)
      .digest("hex");

    const contextHash = crypto
      .createHash("sha256")
      .update(params.retrievalContextHash || "")
      .digest("hex");

    const key = crypto
      .createHash("sha256")
      .update(
        JSON.stringify({
          provider: params.provider,
          model: params.model,
          promptHash,
          contextHash,
          temperature: params.temperature || 0,
        })
      )
      .digest("hex");

    return { key, promptHash, contextHash };
  }

  /**
   * Retrieves a cached response if it exists.
   * Updates lastAccessedAt and hitCount on cache hit.
   */
  public static async getCache(key: string): Promise<string | null> {
    if (this.sessionCache.has(key)) {
      return this.sessionCache.get(key) || null;
    }

    try {
      const entry = await prisma.lLMCache.findUnique({
        where: { key },
      });

      if (!entry) return null;

      // Add to session cache so we don't query DB again
      this.sessionCache.set(key, Promise.resolve(entry.response));


      prisma.lLMCache.update({
        where: { key },
        data: {
          lastAccessedAt: new Date(),
          hitCount: { increment: 1 },
        },
      }).catch((err) => console.warn("Failed to update cache stats:", err));

      return entry.response;
    } catch (err) {
      console.warn("Failed to read from LLM Cache:", err);
      return null;
    }
  }

  /**
   * Saves a successful LLM response to the cache.
   */
  public static async setCache(data: {
    key: string;
    model: string;
    response: string;
    promptHash: string;
    contextHash: string;
    commitHash?: string;
  }): Promise<void> {
    try {
      await prisma.lLMCache.upsert({
        where: { key: data.key },
        create: {
          key: data.key,
          model: data.model,
          response: data.response,
          promptHash: data.promptHash,
          contextHash: data.contextHash,
          commitHash: data.commitHash,
        },
        update: {
          response: data.response,
          lastAccessedAt: new Date(),
        },
      });

      this.sessionCache.set(data.key, Promise.resolve(data.response));

      this.cleanupOldCache().catch(() => {});
    } catch (err) {
      console.warn("Failed to write to LLM Cache:", err);
    }
  }

  /**
   * Clears all entries from the cache.
   */
  public static async clearCache(): Promise<void> {
    this.sessionCache.clear();
    await prisma.lLMCache.deleteMany();
  }

  /**
   * Gets the last successfully working model within the last 15 minutes.
   */
  public static async getWorkingModel(): Promise<string | null> {
    try {
      const entry = await prisma.lLMCache.findUnique({
        where: { key: "__WORKING_MODEL__" },
      });
      if (!entry) return null;


      const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
      if (entry.lastAccessedAt < fifteenMinutesAgo) {
        return null;
      }
      return entry.model;
    } catch {
      return null;
    }
  }

  /**
   * Caches the successfully working model.
   */
  public static async setWorkingModel(model: string): Promise<void> {
    try {
      await prisma.lLMCache.upsert({
        where: { key: "__WORKING_MODEL__" },
        create: {
          key: "__WORKING_MODEL__",
          model: model,
          response: "",
          promptHash: "",
          contextHash: "",
        },
        update: {
          model: model,
          lastAccessedAt: new Date()
        }
      });
    } catch {}
  }

  /**
   * Returns cache statistics.
   */
  public static async getStats(): Promise<{
    entries: number;
    hits: number;
    storage: number;
  }> {
    const entries = await prisma.lLMCache.count();
    const result = await prisma.lLMCache.aggregate({
      _sum: { hitCount: true },
    });


    let storageBytes = 0;
    try {
      const fs = require("fs");
      const path = require("path");
      const dbPath = path.resolve(process.cwd(), ".vortex.db");
      if (fs.existsSync(dbPath)) {
        storageBytes = fs.statSync(dbPath).size;
      }
    } catch (err) {
      // ignore
    }

    return {
      entries,
      hits: result._sum.hitCount || 0,
      storage: storageBytes,
    };
  }

  /**
   * Deletes cache entries older than 14 days.
   */
  private static async cleanupOldCache(): Promise<void> {
    const fourteenDaysAgo = new Date();
    fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);

    await prisma.lLMCache.deleteMany({
      where: {
        lastAccessedAt: {
          lt: fourteenDaysAgo,
        },
      },
    });
  }
}
