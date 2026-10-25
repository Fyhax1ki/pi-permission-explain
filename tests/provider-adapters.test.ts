import assert from "node:assert/strict";
import test from "node:test";
import { type Api, type Model, normalizeContext, type ProviderStreams } from "@earendil-works/pi-ai";
import * as anthropic from "@earendil-works/pi-ai/api/anthropic-messages";
import * as google from "@earendil-works/pi-ai/api/google-generative-ai";
import * as completions from "@earendil-works/pi-ai/api/openai-completions";
import * as responses from "@earendil-works/pi-ai/api/openai-responses";
import { DEFAULT_CONFIG } from "../src/config.ts";
import { capPayload, requestOptions } from "../src/models.ts";
import { isRecord } from "../src/types.ts";
import { model, relayReasoner } from "./helpers.ts";

test("installed Pi provider adapters map off/low and keep output ceilings without network", async (t) => {
  let network = 0;
  const forbiddenFetch = async () => { network++; throw new Error("Network forbidden in offline tests"); };
  t.mock.method(globalThis, "fetch", forbiddenFetch);
  const cases: { adapter: ProviderStreams; model: Model<Api>; check: (payload: Record<string, unknown>, low: boolean) => void }[] = [
    {
      adapter: anthropic,
      model: { ...model("claude-test", "anthropic"), api: "anthropic-messages", reasoning: true },
      check: (payload, low) => {
        assert.equal(payload.max_tokens, 384);
        if (low) assert.ok(isRecord(payload.thinking));
        else assert.deepEqual(payload.thinking, { type: "disabled" });
      },
    },
    {
      adapter: responses,
      model: { ...model("gpt-5", "openai"), api: "openai-responses", reasoning: true },
      check: (payload, low) => {
        assert.equal(payload.max_output_tokens, 384);
        assert.ok(isRecord(payload.reasoning));
        assert.equal(payload.reasoning.effort, low ? "low" : "none");
      },
    },
    {
      adapter: google,
      model: { ...model("gemini-2.5-flash", "google"), api: "google-generative-ai", reasoning: true },
      check: (payload, low) => {
        assert.ok(isRecord(payload.config));
        assert.equal(payload.config.maxOutputTokens, 384);
        assert.ok(isRecord(payload.config.thinkingConfig));
        assert.equal(typeof payload.config.thinkingConfig.thinkingBudget, "number");
        if (!low) assert.equal(payload.config.thinkingConfig.thinkingBudget, 0);
      },
    },
  ];
  for (const item of cases) {
    for (const low of [false, true]) {
      let payload: unknown;
      const options = requestOptions({ ...DEFAULT_CONFIG, reasoning: low ? "low" : "off" }, new AbortController().signal, item.model);
      const stream = item.adapter.streamSimple(item.model, normalizeContext({ messages: [{ role: "user", content: "fixture", timestamp: 1 }] }), {
        ...options, apiKey: "offline-placeholder-not-a-real-key",
        // Google rejects the custom-fetch option before preparing a payload; global fetch is guarded too.
        ...(item.model.api === "google-generative-ai" ? {} : { fetch: forbiddenFetch }),
        onPayload: (value) => { payload = capPayload(value, 384); throw new Error("Stop before transport"); },
      });
      await stream.result();
      assert.equal(network, 0);
      assert.ok(isRecord(payload), `Missing ${item.model.api} payload`);
      item.check(payload, low);
    }
  }
});

test("compatible relays can receive no reasoning-off parameter unless the model maps it", async (t) => {
  let network = 0;
  const forbiddenFetch = async () => { network++; throw new Error("Network forbidden"); };
  t.mock.method(globalThis, "fetch", forbiddenFetch);
  for (const explicitOff of [false, true]) {
    let payload: unknown;
    const target: Model<"openai-completions"> = {
      ...model("relay/test-reasoner", "test-relay"), api: "openai-completions", reasoning: true,
      compat: { supportsReasoningEffort: true },
      ...(explicitOff ? { thinkingLevelMap: { off: "none" } } : {}),
    };
    const stream = completions.streamSimple(target, normalizeContext({ messages: [{ role: "user", content: "fixture", timestamp: 1 }] }), {
      ...requestOptions(DEFAULT_CONFIG, new AbortController().signal, target), apiKey: "offline-placeholder",
      fetch: forbiddenFetch,
      onPayload: (value) => { payload = value; throw new Error("Stop before transport"); },
    });
    await stream.result();
    assert.ok(isRecord(payload));
    assert.equal(payload.reasoning_effort, explicitOff ? "none" : undefined);
  }
  assert.equal(network, 0);
});

test("explicit none reaches the real Completions payload hook only for its opted-in model", async (t) => {
  let network = 0;
  const forbiddenFetch = async () => { network++; throw new Error("Network forbidden"); };
  t.mock.method(globalThis, "fetch", forbiddenFetch);
  const target = relayReasoner();
  for (const mode of ["explicit", "adapter", "low", "high", "max", "other-model"] as const) {
    const config = { ...DEFAULT_CONFIG,
      reasoning: mode === "low" || mode === "high" || mode === "max" ? mode : "off" as const,
      reasoningOffOverride: mode === "adapter" ? null : {
        provider: target.provider, modelId: mode === "other-model" ? "another" : target.id, mode: "reasoning-effort-none" as const,
      },
    };
    let payload: unknown;
    const observed: string[] = [];
    const options = requestOptions(config, new AbortController().signal, target, (event) => {
      if (event.type === "payload") observed.push(event.reasoning);
    });
    const stream = completions.streamSimple(target, normalizeContext({ messages: [{ role: "user", content: "fixture", timestamp: 1 }] }), {
      ...options, apiKey: "offline-placeholder", fetch: forbiddenFetch,
      onPayload: async (value, actual) => {
        payload = await options.onPayload?.(value, actual);
        throw new Error("Stop before transport");
      },
    });
    await stream.result();
    assert.ok(isRecord(payload));
    const expected = mode === "explicit" ? "none" : mode === "high" || mode === "max" ? mode : "low";
    assert.equal(payload.reasoning_effort, expected);
    assert.equal(payload.max_tokens ?? payload.max_completion_tokens, 384);
    assert.deepEqual(observed, [expected ? `reasoning_effort=${expected}` : "omitted"]);
    assert.equal(target.thinkingLevelMap?.off, null);
  }
  assert.equal(network, 0);
});
