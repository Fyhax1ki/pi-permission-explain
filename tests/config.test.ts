import assert from "node:assert/strict";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { atomicWrite, ConfigStore, DEFAULT_CONFIG, validateConfig } from "../src/config.ts";
import { temporary } from "./helpers.ts";

test("defaults and strict validation never turn an invalid fixed model into current", () => {
  assert.deepEqual(validateConfig({}), DEFAULT_CONFIG);
  assert.equal(validateConfig({ explanationModel: null }).explanationModel, null);
  assert.deepEqual(validateConfig({ explanationModel: { provider: "custom", modelId: "org/name" } }).explanationModel, { provider: "custom", modelId: "org/name" });
  for (const raw of [null, [], 1, { explanationModel: "cheap" }, { explanationModel: {} }, { explanationModel: { provider: "p", modelId: "" } }, { enabled: "true" }, { shortcut: "wat+e" }, { shortcut: "e" }, { shortcut: "shift+e" }, { language: "not a language" }, { reasoning: "none" }, { cache: null }]) assert.throws(() => validateConfig(raw));
});

test("configuration accepts Pi's native thinking vocabulary, not arbitrary wire values", () => {
  for (const level of ["off", "minimal", "low", "medium", "high", "xhigh", "max"]) {
    assert.equal(validateConfig({ reasoning: level }).reasoning, level);
  }
  for (const level of ["none", "auto", "enabled", null, 0]) assert.throws(() => validateConfig({ reasoning: level }));
});

test("all numeric budgets enforce inclusive integer bounds", () => {
  for (const [key, min, max] of [["maxOutputTokens", 128, 2048], ["timeoutMs", 1000, 120000], ["maxInputChars", 512, 64000]] as const) {
    for (const value of [min, max]) assert.doesNotThrow(() => validateConfig({ [key]: value }));
    for (const value of [min - 1, max + 1, 1.5, "384", null]) assert.throws(() => validateConfig({ [key]: value }));
  }
  for (const [key, max] of [["maxEntries", 128], ["ttlMs", 1800000], ["maxBytes", 2097152]] as const) {
    assert.doesNotThrow(() => validateConfig({ cache: { [key]: 0 } }));
    assert.throws(() => validateConfig({ cache: { [key]: max + 1 } }));
  }
});

test("explicit reasoning-off overrides require a bounded provider/model and a known preset", () => {
  const override = { provider: "magpie", modelId: "qoder/dfmodel", mode: "reasoning-effort-none" };
  assert.deepEqual(validateConfig({ reasoningOffOverride: override }).reasoningOffOverride, override);
  assert.ok(Object.isFrozen(validateConfig({ reasoningOffOverride: override }).reasoningOffOverride));
  for (const invalid of [true, [], {}, "none", { ...override, provider: "" }, { ...override, modelId: "x\nsecret" },
    { ...override, mode: "high" }, { ...override, modelId: "x".repeat(513) }]) {
    assert.throws(() => validateConfig({ reasoningOffOverride: invalid }));
  }
  assert.equal(validateConfig({ reasoning: "off" }).reasoningOffOverride, null);
});

test("missing config stays absent; manual edits reload and bad edits retain last good", async (t) => {
  const dir = await temporary(t); const path = join(dir, "permission-explain.json");
  const store = new ConfigStore(path);
  assert.deepEqual(await store.reload(), DEFAULT_CONFIG);
  assert.deepEqual(await readdir(dir), []);
  await writeFile(path, '{"language":"ja","future":42,"cache":{"futureCache":true}}');
  assert.equal((await store.reload())?.language, "ja");
  await store.save({ ...DEFAULT_CONFIG, language: "zh-TW" });
  const saved = JSON.parse(await readFile(path, "utf8"));
  assert.equal(saved.future, 42); assert.equal(saved.cache.futureCache, true);
  await writeFile(path, '{"explanationModel":');
  assert.equal((await store.reload())?.language, "zh-TW");
  assert.equal(store.error, "configInvalid");
  const fresh = new ConfigStore(path);
  assert.equal(await fresh.reload(), undefined);
  assert.equal(fresh.error, "configInvalid");
});

test("failed writes never commit config; real Windows rename failure preserves destination", async (t) => {
  const dir = await temporary(t); const path = join(dir, "config.json");
  const store = new ConfigStore(path, async () => { throw new Error("simulated secret IO detail"); });
  await store.reload();
  await assert.rejects(store.save({ ...DEFAULT_CONFIG, language: "ja" }), { message: "configSaveFailed" });
  assert.equal(store.current?.language, "auto");
  const destination = join(dir, "destination");
  await mkdir(destination);
  await assert.rejects(atomicWrite(destination, "not written"));
  assert.deepEqual(await readdir(dir), ["destination"]);
});

test("atomic replacement leaves only the final valid file", async (t) => {
  const dir = await temporary(t); const path = join(dir, "config.json");
  const store = new ConfigStore(path);
  await store.save(DEFAULT_CONFIG);
  await store.save({ ...DEFAULT_CONFIG, language: "de-DE" });
  assert.equal(JSON.parse(await readFile(path, "utf8")).language, "de-DE");
  assert.deepEqual(await readdir(dir), ["config.json"]);
});
