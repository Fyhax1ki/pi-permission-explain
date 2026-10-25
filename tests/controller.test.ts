import assert from "node:assert/strict";
import test from "node:test";
import { ExplanationCache } from "../src/cache.ts";
import { ExplanationController } from "../src/controller.ts";
import { ExplainError, type ExplanationResult, type ExplanationView } from "../src/types.ts";
import { deferred, flush, prepared, presentation, prompt, result } from "./helpers.ts";

test("100 approvals without explanation make zero model/preparation requests", () => {
  let calls = 0;
  const controller = new ExplanationController(async () => { calls++; return prepared(); }, () => undefined);
  for (let index = 0; index < 100; index++) { controller.show(prompt(String(index)), presentation); controller.decide(String(index)); }
  assert.equal(calls, 0); assert.equal(controller.state.phase, "idle");
});

test("rapid triggers deduplicate before config IO; done results are reused", async () => {
  const gate = deferred<ReturnType<typeof prepared>>();
  let preparations = 0; let calls = 0;
  const controller = new ExplanationController(() => { preparations++; return gate.promise; }, () => undefined);
  controller.show(prompt(), presentation);
  const first = controller.trigger();
  await controller.trigger();
  assert.equal(preparations, 1); assert.equal(controller.state.phase, "loading");
  gate.resolve(prepared({ run: async () => { calls++; return result; } }));
  await first; await controller.trigger();
  assert.equal(calls, 1); assert.equal(controller.state.phase, "done");
});

test("only matching decisions clear; cancellation drops late text/result/cache writes", async () => {
  const late = deferred<ExplanationResult>(); const cache = new ExplanationCache();
  let signal: AbortSignal | undefined; let onText: (text: string) => void = () => undefined;
  const controller = new ExplanationController(async () => prepared({ run: (s, update) => { signal = s; onText = update; return late.promise; } }), () => undefined, cache);
  controller.show(prompt(), presentation); const running = controller.trigger(); await flush();
  controller.decide("not-one"); assert.equal(controller.state.phase, "loading");
  controller.decide("one"); assert.equal(signal?.aborted, true);
  onText("late malicious text"); late.resolve(result); await running;
  assert.equal(controller.state.phase, "idle"); assert.equal(cache.size, 0);
});

test("new prompt and generation supersede old attempts, even when request IDs repeat", async () => {
  const late = deferred<ExplanationResult>(); let calls = 0;
  const controller = new ExplanationController(async () => prepared({ cacheKey: undefined, run: async () => ++calls === 1 ? late.promise : { ...result, text: "new" } }), () => undefined);
  controller.show(prompt("one", 1), presentation); const old = controller.trigger(); await flush();
  controller.show(prompt("one", 2), presentation); await controller.trigger();
  late.resolve({ ...result, text: "old" }); await old;
  assert.equal(controller.state.phase, "done");
  if (controller.state.phase === "done") assert.equal(controller.state.result.text, "new");
});

test("timeout releases a non-cooperating request; late failures do not replace retry success", async () => {
  const late = deferred<ExplanationResult>(); let calls = 0;
  const controller = new ExplanationController(async () => prepared({ timeoutMs: 5, run: () => ++calls === 1 ? late.promise : Promise.resolve(result) }), () => undefined);
  controller.show(prompt(), presentation); await controller.trigger();
  assert.equal(controller.state.phase, "failed");
  if (controller.state.phase === "failed") assert.equal(controller.state.error, "timeout");
  assert.equal(calls, 1);
  await controller.trigger(); late.reject(new Error("late provider secret")); await flush();
  assert.equal(calls, 2); assert.equal(controller.state.phase, "done");
});

test("safe failures retry only on explicit trigger, unsupported prompts never prepare", async () => {
  let calls = 0; const views: ExplanationView[] = [];
  const controller = new ExplanationController(async () => prepared({ run: async () => { calls++; throw new Error("do not leak credential"); } }), (view) => views.push(view));
  controller.show({ ...prompt(), scope: "insufficient", visibleCommand: null }, presentation);
  await controller.trigger(); assert.equal(calls, 0);
  controller.show(prompt("supported"), presentation); await controller.trigger();
  assert.equal(calls, 1);
  assert.ok(!JSON.stringify(views).includes("credential"));
  await controller.trigger(); assert.equal(calls, 2);
});

test("empty responses and aborted preparation never populate the cache", async () => {
  const cache = new ExplanationCache();
  const controller = new ExplanationController(async () => prepared({ run: async () => ({ ...result, text: " " }) }), () => undefined, cache);
  controller.show(prompt(), presentation); await controller.trigger();
  assert.equal(controller.state.phase, "failed"); assert.equal(cache.size, 0);
  const pending = deferred<ReturnType<typeof prepared>>(); let run = 0;
  const other = new ExplanationController(() => pending.promise, () => undefined, cache);
  other.show(prompt(), presentation); const work = other.trigger(); other.reset();
  pending.resolve(prepared({ run: async () => { run++; return result; } })); await work;
  assert.equal(run, 0);
});

test("session cache reusable only with explicit key; reset and routed requests disable reuse", async () => {
  for (const routed of [false, true]) {
    let calls = 0;
    const controller = new ExplanationController(async () => prepared({ cacheKey: routed ? undefined : "same-key", run: async () => { calls++; return result; } }), () => undefined);
    controller.show(prompt("one"), presentation); await controller.trigger(); await controller.trigger();
    controller.show(prompt("two"), presentation); await controller.trigger();
    assert.equal(calls, routed ? 2 : 1);
    controller.reset(); controller.show(prompt("three", 2), presentation); await controller.trigger();
    assert.equal(calls, routed ? 3 : 2);
  }
});

test("parent abort clears UI; renderer failures cannot break the state machine", async () => {
  const parent = new AbortController(); const pending = deferred<ExplanationResult>();
  const controller = new ExplanationController(async () => prepared({ parentSignal: parent.signal, run: () => pending.promise }), () => { throw new Error("UI broke"); });
  controller.show(prompt(), presentation); const work = controller.trigger(); await flush();
  parent.abort(); await work;
  assert.equal(controller.state.phase, "idle");
  pending.reject(new ExplainError("requestFailed")); await flush();
});

test("unexpected returned model identity is not cached as the selected model", async () => {
  const cache = new ExplanationCache();
  const controller = new ExplanationController(async () => prepared({ cacheIdentity: { provider: "expected", modelId: "expected" } }), () => undefined, cache);
  controller.show(prompt(), presentation); await controller.trigger();
  assert.equal(controller.state.phase, "done"); assert.equal(cache.size, 0);
});
