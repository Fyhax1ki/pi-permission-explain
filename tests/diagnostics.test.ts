import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_CONFIG } from "../src/config.ts";
import { ExplanationController } from "../src/controller.ts";
import { modelDiagnostics, reasoningOnWire, RequestTrace } from "../src/diagnostics.ts";
import { diagnosticsNotice } from "../src/ui/diagnostics.ts";
import { translator } from "../src/ui/i18n.ts";
import { deferred, flush, model, prepared, presentation, prompt, result } from "./helpers.ts";

test("model diagnostics discard URL credentials, paths and query strings", () => {
  const data = modelDiagnostics({ ...model(), baseUrl: "https://user:secret@example.test:444/private?api_key=secret" }, DEFAULT_CONFIG);
  assert.equal(data.origin, "https://example.test:444");
  assert.doesNotMatch(JSON.stringify(data), /secret|private|api_key/);
  assert.equal(data.selection, "current");
});

test("payload diagnostics inspect reasoning controls only, not secrets or command content", () => {
  assert.equal(reasoningOnWire({ messages: [{ content: "private command" }], api_key: "secret" }), "omitted");
  assert.equal(reasoningOnWire({ reasoning_effort: "none" }), "reasoning_effort=none");
  assert.equal(reasoningOnWire({ thinking: { type: "disabled" } }), "thinking.type=disabled");
  assert.equal(reasoningOnWire({ reasoning_effort: "unexpected-secret-value" }), "reasoning_effort=custom");
  assert.equal(reasoningOnWire({ config: { thinkingConfig: { thinkingBudget: 0 } } }), "thinkingBudget=0");
});

test("reasoning metadata identifies null/false declarations and redacts arbitrary mapping strings", () => {
  const declared = modelDiagnostics({ ...model(), thinkingLevelMap: { off: null }, compat: { supportsReasoningEffort: false } }, DEFAULT_CONFIG);
  assert.equal(declared.reasoningMetadata, "thinkingLevelMap.off=null, compat.supportsReasoningEffort=false");
  assert.match(diagnosticsNotice(undefined, declared, translator("en")), /thinkingLevelMap.off=null/);
  const unknown = modelDiagnostics({ ...model(), thinkingLevelMap: { off: "secret-provider-value\n" } }, DEFAULT_CONFIG);
  assert.equal(unknown.reasoningMetadata, "thinkingLevelMap.off=custom, compat.supportsReasoningEffort=unset");
  assert.doesNotMatch(JSON.stringify(unknown), /secret-provider-value/);
});

test("trace separates preparation, payload, headers, thinking, first text and generation", () => {
  let clock = 0;
  const trace = new RequestTrace(() => clock);
  clock = 5; trace.prepared(modelDiagnostics(model(), DEFAULT_CONFIG));
  trace.startRequest();
  clock = 15; trace.progress({ type: "payload", reasoning: "omitted" });
  clock = 105; trace.progress({ type: "response", status: 200 });
  clock = 205; trace.progress({ type: "thinking" });
  clock = 1005; trace.text();
  clock = 1105; trace.text();
  clock = 2005; trace.finish("done");
  clock = 2007; trace.displayed(2);
  const data = trace.snapshot();
  assert.equal(data.preparationMs, 5); assert.equal(data.payloadMs, 10);
  assert.equal(data.responseMs, 100); assert.equal(data.firstThinkingMs, 200);
  assert.equal(data.firstTextMs, 1000); assert.equal(data.generationMs, 1000);
  assert.equal(data.requestMs, 2000); assert.equal(data.displayMs, 2);
  assert.equal(data.totalMs, 2007); assert.equal(data.payloadsPrepared, 1);
  trace.progress({ type: "payload", reasoning: "late" });
  assert.equal(trace.snapshot().payloadsPrepared, 1);
  assert.match(diagnosticsNotice(data, undefined, translator("en")), /1000.0 ms/);
});

test("controller diagnostics describe the real attempt and ignore late cancelled progress", async () => {
  const pending = deferred<typeof result>();
  let progress: Parameters<ReturnType<typeof prepared>["run"]>[2];
  const controller = new ExplanationController(async () => prepared({
    diagnostics: modelDiagnostics(model(), DEFAULT_CONFIG),
    run: (_signal, text, update) => {
      progress = update;
      update?.({ type: "payload", reasoning: "omitted" }); text("partial");
      return pending.promise;
    },
  }), () => undefined);
  controller.show(prompt(), presentation);
  const work = controller.trigger(); await flush();
  assert.equal(controller.diagnostics?.phase, "requesting");
  controller.decide("one"); await work;
  assert.equal(controller.diagnostics?.phase, "cancelled");
  progress?.({ type: "response", status: 200 }); pending.resolve(result); await flush();
  assert.equal(controller.diagnostics?.responseStatus, undefined);
  assert.doesNotMatch(JSON.stringify(controller.diagnostics), /rm -rf|partial/);
  controller.reset(); assert.equal(controller.diagnostics, undefined);
});

test("cache hits have no new model-request timing or old generation usage", async () => {
  const controller = new ExplanationController(async () => prepared(), () => undefined);
  controller.show(prompt("one"), presentation); await controller.trigger();
  controller.show(prompt("two"), presentation); await controller.trigger();
  assert.equal(controller.diagnostics?.phase, "cache-hit");
  assert.equal(controller.diagnostics?.requestMs, undefined);
  assert.equal(controller.diagnostics?.payloadsPrepared, 0);
  assert.equal(controller.diagnostics?.usage, undefined);
});
