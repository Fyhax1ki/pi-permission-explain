import { createHash } from "node:crypto";
import type { CacheOptions, ExplanationResult } from "./types.ts";

export function cacheKey(parts: unknown): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

interface Entry {
  readonly result: ExplanationResult;
  readonly created: number;
  readonly expires: number;
  readonly bytes: number;
}

/** LRU + lazy TTL; bytes estimate UTF-8 key/result JSON, not total JavaScript heap overhead. */
export class ExplanationCache {
  private readonly entries = new Map<string, Entry>();
  private bytes = 0;
  private readonly now: () => number;
  constructor(now = Date.now) { this.now = now; }
  get size(): number { return this.entries.size; }
  get estimatedBytes(): number { return this.bytes; }

  clear(): void { this.entries.clear(); this.bytes = 0; }

  private remove(key: string): void {
    const entry = this.entries.get(key);
    if (entry) { this.bytes -= entry.bytes; this.entries.delete(key); }
  }

  private prune(options: CacheOptions): boolean {
    if (!options.enabled || !options.maxEntries || !options.ttlMs || !options.maxBytes) {
      this.clear(); return false;
    }
    for (const [key, entry] of this.entries) {
      if (Math.min(entry.expires, entry.created + options.ttlMs) <= this.now()) this.remove(key);
    }
    while (this.entries.size > options.maxEntries || this.bytes > options.maxBytes) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.remove(oldest);
    }
    return true;
  }

  get(key: string, options: CacheOptions): ExplanationResult | undefined {
    if (!this.prune(options)) return undefined;
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key); this.entries.set(key, entry);
    return entry.result;
  }

  set(key: string, result: ExplanationResult, options: CacheOptions): void {
    if (!this.prune(options) || !result.text.trim()) return;
    const bytes = Buffer.byteLength(key) + Buffer.byteLength(JSON.stringify(result));
    if (bytes > options.maxBytes) return;
    this.remove(key);
    const created = this.now();
    this.entries.set(key, { result, bytes, created, expires: created + options.ttlMs });
    this.bytes += bytes;
    this.prune(options);
  }
}
