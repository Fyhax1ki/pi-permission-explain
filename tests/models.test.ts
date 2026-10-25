import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import { ConfigStore, DEFAULT_CONFIG } from "../src/config.ts";
import { abortable, availableModels, capPayload, explain, requestOptions, resolveModel } from "../src/models.ts";
import { MAX_OUTPUT_CHARS } from "../src/prompt.ts";
import { prepareExplanation } from "../src/runtime.ts";
import { context, flush, message, model, prompt, registry, temporary } from "./helpers.ts";

test("model registry includes custom chat models, separate providers and IDs containing slash", () => {
  const a = model("org/shared", "a"); const b = model("org/shared", "b");
  const reg = registry([a, b, { ...model("image-input-only"), input: ["image"] }]);
  assert.equal(availableModels(reg).length, 2);
  assert.equal(resolveModel(reg, { provider: "b", modelId: "org/shared" }, a), b);
  assert.throws(() => resolveModel(reg, { provider: "gone", modelId: "cheap" }, a), { message: "modelUnavailable" });
  assert.throws(() => resolveModel(reg, null, undefined), { message: "noModel" });
  assert.throws(() => resolveModel(reg, null, model("unavailable")), { message: "modelUnavailable" });
});

test("options use independent reasoning, zero retries, no tools and output ceiling guards", () => {
  const signal = new AbortController().signal;
  const target = { ...model(), reasoning: true };
  const off = requestOptions(DEFAULT_CONFIG, signal, target);
  assert.equal(off.reasoning, undefined); assert.equal(off.maxRetries, 0); assert.equal(off.toolChoice, "none");
  assert.equal(off.maxTokens, 384); assert.equal(off.signal, signal);
  assert.equal(requestOptions({ ...DEFAULT_CONFIG, reasoning: "low" }, signal, target).reasoning, "low");
  assert.deepEqual(capPayload({ max_tokens: 2432, other: true }, 384), { max_tokens: 384, other: true });
  assert.deepEqual(capPayload({ generationConfig: { maxOutputTokens: 999 } }, 384), { generationConfig: { maxOutputTokens: 384 } });
  assert.deepEqual(capPayload({ max_output_tokens: 200 }, 384), { max_output_tokens: 200 });
});

test("fake stream yields only text/usage and returns length-limit warning without continuation", async () => {
  const stream = createAssistantMessageEventStream(); let calls = 0;
  const reg = registry(); reg.streamSimple = () => { calls++; return stream; };
  const updates: string[] = [];
  const work = explain(reg, model(), { messages: [] }, DEFAULT_CONFIG, new AbortController().signal, (text) => updates.push(text));
  stream.push({ type: "text_delta", contentIndex: 0, delta: "hello", partial: message("hello") });
  stream.push({ type: "done", reason: "length", message: message("hello") });
  const result = await work;
  assert.equal(result.text, "hello"); assert.equal(result.truncated, true); assert.equal(calls, 1);
  assert.deepEqual(updates, ["hello"]); assert.equal(result.usage?.input, 10);
});

test("empty, tool-use and error responses fail safely; completed text is bounded", async () => {
  for (const reason of ["empty", "tool", "error", "large"]) {
    const stream = createAssistantMessageEventStream(); const reg = registry(); reg.streamSimple = () => stream;
    const work = explain(reg, model(), { messages: [] }, DEFAULT_CONFIG, new AbortController().signal, () => undefined);
    if (reason === "error") stream.push({ type: "error", reason: "error", error: { ...message(), stopReason: "error", errorMessage: "credential in provider error" } });
    else stream.push({ type: "done", reason: reason === "tool" ? "toolUse" : "stop", message: message(reason === "empty" ? "" : "x".repeat(MAX_OUTPUT_CHARS + 10)) });
    if (reason === "large") { const result = await work; assert.equal(result.text.length, MAX_OUTPUT_CHARS); assert.equal(result.truncated, true); }
    else await assert.rejects(work, { message: reason === "empty" ? "emptyOutput" : "requestFailed" });
  }
});

test("abort releases stalled stream readers and observes already-rejected promises", async () => {
  const stream = createAssistantMessageEventStream(); const reg = registry(); reg.streamSimple = () => stream;
  const abort = new AbortController();
  const work = explain(reg, model(), { messages: [] }, DEFAULT_CONFIG, abort.signal, () => assert.fail("late UI update"));
  abort.abort(); await assert.rejects(work, { message: "cancelled" });
  stream.push({ type: "done", reason: "stop", message: message() });
  await assert.rejects(abortable(Promise.reject(new Error("late")), abort.signal), { message: "cancelled" });
  await flush();
});

test("prepare snapshots trigger-time model/language; fixed failure never falls back", async (t) => {
  const store = new ConfigStore(join(await temporary(t), "config.json"));
  await store.reload();
  const a = model("cheap", "a"); const b = model("expensive", "b");
  const reg = registry([a, b]); const ctx = context(reg, a); const signal = new AbortController().signal;
  const system = { tag: "en", source: "Intl" } as const;
  const first = await prepareExplanation(prompt(), ctx, store, system, signal);
  ctx.model = b;
  const second = await prepareExplanation(prompt(), ctx, store, system, signal);
  assert.match(first.presentation.modelLabel, /cheap/); assert.match(second.presentation.modelLabel, /expensive/);
  assert.notEqual(first.cacheKey, second.cacheKey);
  await store.save({ ...DEFAULT_CONFIG, language: "ja", explanationModel: { provider: "a", modelId: "cheap" } });
  const fixed = await prepareExplanation(prompt(), ctx, store, system, signal);
  assert.equal(fixed.presentation.language, "ja"); assert.match(fixed.presentation.modelLabel, /cheap/);
  assert.equal(ctx.model, b);
  await store.save({ ...DEFAULT_CONFIG, explanationModel: { provider: "missing", modelId: "cheap" } });
  await assert.rejects(prepareExplanation(prompt(), ctx, store, system, signal), { message: "modelUnavailable" });
  assert.equal(ctx.model, b);
});

test("virtual models are labeled and never get a cross-approval cache key", async (t) => {
  const routed = { ...model(), api: "pi-virtual" };
  const store = new ConfigStore(join(await temporary(t), "config.json"));
  const prepared = await prepareExplanation(prompt(), context(registry([routed]), routed), store, { tag: "en", source: "Intl" }, new AbortController().signal);
  assert.equal(prepared.presentation.routed, true); assert.equal(prepared.cacheKey, undefined);
});
