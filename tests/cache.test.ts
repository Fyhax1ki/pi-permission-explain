import assert from "node:assert/strict";
import test from "node:test";
import { cacheKey, ExplanationCache } from "../src/cache.ts";
import { DEFAULT_CONFIG } from "../src/config.ts";
import { result } from "./helpers.ts";

test("LRU eviction, lazy TTL and byte budgets are bounded", () => {
  let now = 0; const cache = new ExplanationCache(() => now);
  const options = { ...DEFAULT_CONFIG.cache, maxEntries: 2, ttlMs: 100 };
  cache.set("one", result, options); cache.set("two", result, options);
  assert.equal(cache.get("one", options), result);
  cache.set("three", result, options);
  assert.equal(cache.get("two", options), undefined);
  assert.equal(cache.size, 2);
  now = 101;
  assert.equal(cache.get("one", options), undefined);
  assert.equal(cache.size, 0);
  cache.set("big", { ...result, text: "x".repeat(1000) }, { ...options, maxBytes: 200 });
  assert.equal(cache.size, 0);
  cache.set("one", result, options);
  assert.ok(cache.estimatedBytes > 0);
  cache.clear(); assert.equal(cache.estimatedBytes, 0);
});

test("zero in any budget disables caching and clears retained values", () => {
  for (const changed of [{ enabled: false }, { maxEntries: 0 }, { maxBytes: 0 }, { ttlMs: 0 }]) {
    const cache = new ExplanationCache();
    cache.set("one", result, DEFAULT_CONFIG.cache);
    const options = { ...DEFAULT_CONFIG.cache, ...changed };
    assert.equal(cache.get("one", options), undefined);
    cache.set("two", result, options); assert.equal(cache.size, 0);
  }
  const cache = new ExplanationCache();
  cache.set("empty", { ...result, text: "  " }, DEFAULT_CONFIG.cache);
  assert.equal(cache.size, 0);
});

test("keys contain only digests and distinguish providers, models, language and options", () => {
  const base = { provider: "p", modelId: "a/b", language: "zh-CN", version: "v1", command: "secret command", limit: 384 };
  const key = cacheKey(base);
  assert.match(key, /^[a-f0-9]{64}$/);
  for (const field of Object.keys(base)) assert.notEqual(key, cacheKey({ ...base, [field]: "different" }));
});

test("shortening TTL takes effect for already-retained entries", () => {
  let now = 0;
  const cache = new ExplanationCache(() => now);
  cache.set("one", result, DEFAULT_CONFIG.cache);
  now = 2000;
  assert.equal(cache.get("one", { ...DEFAULT_CONFIG.cache, ttlMs: 1000 }), undefined);
});
