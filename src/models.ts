import type { Api, AssistantMessageEvent, Context, Model, ModelsSimpleStreamOptions } from "@earendil-works/pi-ai";
import type { ModelRegistry } from "@earendil-works/pi-coding-agent";
import { type RequestProgress, reasoningOnWire } from "./diagnostics.ts";
import { MAX_OUTPUT_CHARS } from "./prompt.ts";
import { applyReasoningOverride, checkReasoningOverride, effectiveReasoning, explicitReasoningOff } from "./reasoning.ts";
import { type Config, ExplainError, type ExplanationResult, isRecord, type ModelReference } from "./types.ts";

export type Registry = Pick<ModelRegistry, "getAvailable" | "find" | "streamSimple">;
export const CURRENT_MODEL = "__current__";

export function isRouted(model: Model<Api>): boolean { return model.api === "pi-virtual"; }

export function availableModels(registry: Registry): Model<Api>[] {
  return registry.getAvailable().filter((model) => (!model.type || model.type === "chat") && model.input.includes("text"));
}

export function resolveModel(registry: Registry, preference: ModelReference | null, current: Model<Api> | undefined): Model<Api> {
  const model = preference ? registry.find(preference.provider, preference.modelId) : current;
  if (!model) throw new ExplainError(preference ? "modelUnavailable" : "noModel");
  if (!availableModels(registry).some((item) => item.provider === model.provider && item.id === model.id)) {
    // No fallback: a different provider/model may cost more or disclose data to another party.
    throw new ExplainError("modelUnavailable");
  }
  return model;
}

/** Final guard against Pi adapters adding a thinking budget to maxTokens (1.4.0). */
export function capPayload(payload: unknown, limit: number): unknown {
  if (!isRecord(payload)) return payload;
  const capped = { ...payload };
  for (const key of ["max_tokens", "max_completion_tokens", "max_output_tokens"]) {
    if (typeof capped[key] === "number") capped[key] = Math.min(capped[key], limit);
  }
  for (const [container, key] of [["generationConfig", "maxOutputTokens"], ["config", "maxOutputTokens"], ["inferenceConfig", "maxTokens"]]) {
    if (!container || !key) continue;
    const nested = capped[container];
    if (isRecord(nested) && typeof nested[key] === "number") capped[container] = { ...nested, [key]: Math.min(nested[key], limit) };
  }
  return capped;
}

/** Mirror Pi's session clamp before calling the adapter; experimental overrides remain request-local. */
export function requestOptions(config: Config, signal: AbortSignal, model: Model<Api>, onProgress?: (event: RequestProgress) => void): ModelsSimpleStreamOptions {
  const level = effectiveReasoning(config, model);
  return {
    reasoning: level === "off" || level === "explicit-none" ? undefined : level,
    maxTokens: config.maxOutputTokens,
    timeoutMs: config.timeoutMs,
    maxRetries: 0,
    signal,
    toolChoice: "none",
    cacheRetention: "none",
    onPayload: (payload, actual) => {
      if (explicitReasoningOff(config, model) && actual && (actual.provider !== model.provider
        || actual.id !== model.id || actual.api !== "openai-completions")) {
        throw new ExplainError("reasoningOverrideUnsupported");
      }
      const capped = capPayload(applyReasoningOverride(payload, config, model), config.maxOutputTokens);
      onProgress?.({ type: "payload", reasoning: reasoningOnWire(capped) });
      return capped;
    },
    onResponse: (response) => onProgress?.({ type: "response", status: response.status }),
  };
}

/** Race one promise with cancellation and always release our signal listener. */
export async function abortable<T>(promise: PromiseLike<T>, signal: AbortSignal): Promise<T> {
  const pending = Promise.resolve(promise);
  if (signal.aborted) {
    void pending.catch(() => undefined);
    throw new ExplainError("cancelled");
  }
  let rejectAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectAbort = () => reject(new ExplainError("cancelled"));
    signal.addEventListener("abort", rejectAbort, { once: true });
  });
  try { return await Promise.race([pending, aborted]); }
  finally { if (rejectAbort) signal.removeEventListener("abort", rejectAbort); }
}

/** A single independent tool-free stream. No agent loop, primary-model mutation or retries. */
export async function explain(
  registry: Registry, model: Model<Api>, context: Context, config: Config,
  signal: AbortSignal, onText: (text: string) => void,
  onProgress?: (event: RequestProgress) => void,
): Promise<ExplanationResult> {
  if (signal.aborted) throw new ExplainError("cancelled");
  checkReasoningOverride(config, model);
  const stream = registry.streamSimple(model, context, requestOptions(config, signal, model, onProgress));
  const iterator = stream[Symbol.asyncIterator]();
  let text = "";
  try {
    while (true) {
      const next = await abortable(iterator.next(), signal);
      if (signal.aborted) throw new ExplainError("cancelled");
      if (next.done) throw new ExplainError("emptyOutput");
      const event: AssistantMessageEvent = next.value;
      if (event.type === "text_delta") {
        text = (text + event.delta).slice(0, MAX_OUTPUT_CHARS);
        onText(text);
      } else if (event.type === "thinking_delta" && event.delta) {
        onProgress?.({ type: "thinking" });
      } else if (event.type === "error") {
        throw new ExplainError("requestFailed");
      } else if (event.type === "done") {
        if (event.reason !== "stop" && event.reason !== "length") throw new ExplainError("requestFailed");
        const result = event.message.content.filter((part) => part.type === "text").map((part) => part.text).join("\n");
        if (!result.trim()) throw new ExplainError("emptyOutput");
        return {
          text: result.slice(0, MAX_OUTPUT_CHARS),
          truncated: event.reason === "length" || result.length > MAX_OUTPUT_CHARS,
          provider: event.message.provider, modelId: event.message.model,
          usage: { input: event.message.usage.input, output: event.message.usage.output, reasoning: event.message.usage.reasoning ?? 0 },
        };
      }
    }
  } finally {
    // Do not wait forever for a provider that ignores AbortSignal or iterator.return().
    if (iterator.return) void Promise.resolve(iterator.return()).catch(() => undefined);
  }
}
