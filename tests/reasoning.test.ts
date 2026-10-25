import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { clampThinkingLevel, createAssistantMessageEventStream, getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import { ConfigStore, DEFAULT_CONFIG } from "../src/config.ts";
import { modelDiagnostics } from "../src/diagnostics.ts";
import { explain, requestOptions } from "../src/models.ts";
import { applyReasoningOverride, checkReasoningOverride, effectiveReasoning, explicitReasoningOff, reasoningMetadataDisallowsOff } from "../src/reasoning.ts";
import { prepareExplanation } from "../src/runtime.ts";
import type { Config } from "../src/types.ts";
import { context, message, model, prompt, registry, relayReasoner, temporary } from "./helpers.ts";

const target = model("qoder/dfmodel", "magpie");
const config: Config = { ...DEFAULT_CONFIG, reasoningOffOverride: {
  provider: target.provider, modelId: target.id, mode: "reasoning-effort-none",
} };

test("explicit none only affects the opted-in explanation model and never mutates payload/metadata", () => {
  const payload = Object.freeze({ reasoning_effort: "high", max_tokens: 384, messages: [] });
  const shared = Object.freeze({ ...target, thinkingLevelMap: Object.freeze({ low: "low" }) });
  assert.deepEqual(applyReasoningOverride(payload, config, shared), { ...payload, reasoning_effort: "none" });
  assert.equal(payload.reasoning_effort, "high");
  assert.equal("off" in shared.thinkingLevelMap, false);
  assert.equal(applyReasoningOverride(payload, DEFAULT_CONFIG, shared), payload);
  assert.equal(applyReasoningOverride(payload, { ...config, reasoning: "low" }, shared), payload);
  for (const other of [model(target.id, "other"), model("qoder-cn/dfmodel", target.provider), undefined]) {
    assert.equal(explicitReasoningOff(config, other), false);
    assert.equal(applyReasoningOverride(payload, config, other), payload);
  }
  assert.equal(modelDiagnostics(shared, config).reasoningMapping, "reasoning-effort-none");
  assert.equal(modelDiagnostics(model(), config).reasoningMapping, "pi-adapter");
  const options = requestOptions(config, new AbortController().signal, target);
  assert.throws(() => options.onPayload?.({}, model("other", target.provider)), { message: "reasoningOverrideUnsupported" });
});

test("native reasoning matches Pi's supported levels and session clamp instead of omitting unsupported off", () => {
  const target = relayReasoner();
  assert.deepEqual(getSupportedThinkingLevels(target), ["low", "high", "max"]);
  for (const [requested, expected] of [["off", "low"], ["minimal", "low"], ["low", "low"], ["medium", "high"], ["high", "high"], ["xhigh", "max"], ["max", "max"]] as const) {
    const requestedConfig = { ...DEFAULT_CONFIG, reasoning: requested };
    assert.equal(effectiveReasoning(requestedConfig, target), expected);
    assert.equal(effectiveReasoning(requestedConfig, target), clampThinkingLevel(target, requested));
    assert.equal(requestOptions(requestedConfig, new AbortController().signal, target).reasoning, expected);
  }
  const diagnostics = modelDiagnostics(target, DEFAULT_CONFIG);
  assert.equal(diagnostics.reasoning, "off");
  assert.equal(diagnostics.effectiveReasoning, "low");
  assert.equal(diagnostics.supportedReasoning, "low / high / max");
  assert.equal(effectiveReasoning({ ...DEFAULT_CONFIG, reasoning: "max" }, model()), "off");
  assert.equal(requestOptions({ ...DEFAULT_CONFIG, reasoning: "max" }, new AbortController().signal, model()).reasoning, undefined);
  assert.equal(target.thinkingLevelMap?.off, null);
});

test("the explanation stream carries the model-scoped override without changing registry models", async () => {
  const reg = registry([target]);
  let calls = 0;
  reg.streamSimple = (selected, _context, options) => {
    calls++;
    assert.equal(selected, target);
    assert.equal(options?.maxRetries, 0);
    assert.deepEqual(options?.onPayload?.({ max_tokens: 1024 }, selected), { max_tokens: 384, reasoning_effort: "none" });
    const stream = createAssistantMessageEventStream();
    stream.push({ type: "done", reason: "stop", message: message() });
    return stream;
  };
  const result = await explain(reg, target, { messages: [] }, config, new AbortController().signal, () => undefined);
  assert.ok(result.text);
  assert.equal(calls, 1);
  assert.equal(reg.find(target.provider, target.id), target);
  assert.equal(target.thinkingLevelMap, undefined);
});

test("explicit none still rejects unsupported APIs and conflicting payload dialects", async () => {
  for (const unsupported of [
    { ...target, api: "pi-virtual" }, { ...target, api: "openai-responses" },
  ]) {
    assert.throws(() => checkReasoningOverride(config, unsupported), { message: "reasoningOverrideUnsupported" });
    await assert.rejects(explain(registry([unsupported]), unsupported, { messages: [] }, config,
      new AbortController().signal, () => assert.fail("Unexpected text")), { message: "reasoningOverrideUnsupported" });
  }
  assert.throws(() => applyReasoningOverride(null, config, target), { message: "reasoningOverrideUnsupported" });
  for (const key of ["thinking", "enable_thinking", "reasoning", "chat_template_kwargs", "chat_template_args", "thinking_budget", "reasoning_budget", "thinking_token_budget"]) {
    assert.throws(() => applyReasoningOverride({ [key]: {} }, config, target), { message: "reasoningOverrideConflict" });
  }
});

test("explicit opt-in can test incompatible metadata without changing ordinary off or shared metadata", () => {
  for (const annotated of [
    { ...target, thinkingLevelMap: Object.freeze({ off: null }) },
    { ...target, compat: Object.freeze({ supportsReasoningEffort: false }) },
    { ...target, thinkingLevelMap: Object.freeze({ off: null }), compat: Object.freeze({ supportsReasoningEffort: false }) },
  ]) {
    const shared = Object.freeze(annotated);
    const original = JSON.stringify(shared);
    assert.equal(reasoningMetadataDisallowsOff(shared), true);
    assert.doesNotThrow(() => checkReasoningOverride(config, shared));
    assert.deepEqual(applyReasoningOverride({}, config, shared), { reasoning_effort: "none" });
    const payload = Object.freeze({});
    assert.equal(applyReasoningOverride(payload, DEFAULT_CONFIG, shared), payload);
    assert.equal(applyReasoningOverride(payload, { ...config, reasoning: "low" }, shared), payload);
    assert.equal(JSON.stringify(shared), original);
  }
  assert.equal(reasoningMetadataDisallowsOff(target), false);
});

test("changing the override changes cache identity and following another model does not inherit it", async (t) => {
  const store = new ConfigStore(join(await temporary(t), "config.json"));
  const other = model("qoder-cn/dfmodel", "magpie");
  const ctx = context(registry([target, other]), target);
  const system = { tag: "en", source: "Intl" } as const;
  const signal = new AbortController().signal;
  const initial = await prepareExplanation(prompt(), ctx, store, system, signal);
  await store.save(config);
  const overridden = await prepareExplanation(prompt(), ctx, store, system, signal);
  assert.notEqual(initial.cacheKey, overridden.cacheKey);
  assert.equal(ctx.model, target);
  assert.equal(ctx.model.thinkingLevelMap, undefined);
  ctx.model = other;
  const followed = await prepareExplanation(prompt(), ctx, store, system, signal);
  assert.equal(followed.diagnostics?.reasoningMapping, "pi-adapter");
  await store.save(DEFAULT_CONFIG);
  const noOverride = await prepareExplanation(prompt(), ctx, store, system, signal);
  assert.equal(followed.cacheKey, noOverride.cacheKey);
});
