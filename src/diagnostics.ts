import { type Api, getSupportedThinkingLevels, type Model, type ModelThinkingLevel } from "@earendil-works/pi-ai";
import { effectiveReasoning, explicitReasoningOff, reasoningMetadataSummary } from "./reasoning.ts";
import { type Config, type ErrorCode, type ExplanationResult, isRecord } from "./types.ts";

export interface ModelDiagnostics {
  readonly provider: string;
  readonly modelId: string;
  readonly api: string;
  readonly origin: string;
  readonly selection: "fixed" | "current";
  readonly reasoning: ModelThinkingLevel;
  readonly effectiveReasoning: ModelThinkingLevel | "explicit-none";
  readonly supportedReasoning: string;
  readonly reasoningMapping: "pi-adapter" | "reasoning-effort-none";
  readonly reasoningMetadata: string;
  readonly maxOutputTokens: number;
  readonly timeoutMs: number;
}

export type RequestProgress =
  | { readonly type: "payload"; readonly reasoning: string }
  | { readonly type: "response"; readonly status: number }
  | { readonly type: "thinking" };

export type TracePhase = "preparing" | "requesting" | "done" | "failed" | "cancelled" | "cache-hit";

export interface RequestDiagnostics {
  readonly phase: TracePhase;
  readonly startedAt: string;
  readonly model?: ModelDiagnostics;
  readonly preparationMs?: number;
  readonly requestMs?: number;
  readonly payloadMs?: number;
  readonly responseMs?: number;
  readonly firstThinkingMs?: number;
  readonly firstTextMs?: number;
  readonly generationMs?: number;
  readonly displayMs?: number;
  readonly totalMs: number;
  readonly payloadsPrepared: number;
  readonly responseStatus?: number;
  readonly reasoningOnWire?: string;
  readonly error?: ErrorCode;
  readonly usage?: ExplanationResult["usage"];
}

/** Only keep model identifiers and the origin, never credentials, URL paths, prompts or headers. */
export function modelDiagnostics(model: Model<Api>, config: Config): ModelDiagnostics {
  let origin = "unknown";
  try {
    const url = new URL(model.baseUrl);
    if (url.protocol === "http:" || url.protocol === "https:") origin = url.origin;
  } catch { /* Custom transports may not use a URL. */ }
  return {
    provider: model.provider, modelId: model.id, api: model.api, origin,
    selection: config.explanationModel ? "fixed" : "current",
    reasoning: config.reasoning, maxOutputTokens: config.maxOutputTokens, timeoutMs: config.timeoutMs,
    effectiveReasoning: effectiveReasoning(config, model),
    supportedReasoning: getSupportedThinkingLevels(model).join(" / "),
    reasoningMapping: explicitReasoningOff(config, model) ? "reasoning-effort-none" : "pi-adapter",
    reasoningMetadata: reasoningMetadataSummary(model),
  };
}

/** Inspect an allowlist of reasoning controls only; do not retain the provider payload. */
export function reasoningOnWire(payload: unknown): string {
  if (!isRecord(payload)) return "unobserved";
  const fields: string[] = [];
  const add = (key: string, value: unknown) => {
    if (value === undefined || value === null) return;
    const label = typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))
      ? String(value)
      : typeof value === "string" && /^(off|none|disabled|enabled|minimal|low|medium|high|xhigh|max|auto|adaptive)$/i.test(value)
        ? value : "custom";
    fields.push(`${key}=${label}`);
  };
  add("reasoning_effort", payload.reasoning_effort);
  add("enable_thinking", payload.enable_thinking);
  if (isRecord(payload.reasoning)) {
    add("reasoning.effort", payload.reasoning.effort);
    add("reasoning.enabled", payload.reasoning.enabled);
  }
  if (isRecord(payload.thinking)) add("thinking.type", payload.thinking.type);
  else add("thinking", payload.thinking);
  const config = isRecord(payload.config) ? payload.config : payload.generationConfig;
  if (isRecord(config) && isRecord(config.thinkingConfig)) {
    add("thinkingBudget", config.thinkingConfig.thinkingBudget);
    add("thinkingLevel", config.thinkingConfig.thinkingLevel);
  }
  return fields.length ? fields.join(", ") : "omitted";
}

/** One bounded in-memory trace per explicit request, with monotonic client-side timing. */
export class RequestTrace {
  private readonly now: () => number;
  private readonly started: number;
  private requestStarted: number | undefined;
  private data: RequestDiagnostics = { phase: "preparing", startedAt: new Date().toISOString(), totalMs: 0, payloadsPrepared: 0 };

  constructor(now = () => performance.now()) { this.now = now; this.started = now(); }

  snapshot(): RequestDiagnostics {
    const active = this.data.phase === "preparing" || this.data.phase === "requesting";
    return {
      ...this.data,
      ...(this.data.model ? { model: { ...this.data.model } } : {}),
      ...(this.data.usage ? { usage: { ...this.data.usage } } : {}),
      ...(active ? { totalMs: this.now() - this.started } : {}),
    };
  }

  prepared(model?: ModelDiagnostics): void {
    this.data = { ...this.data, model, preparationMs: this.now() - this.started };
  }

  startRequest(): void {
    this.requestStarted = this.now();
    this.data = { ...this.data, phase: "requesting" };
  }

  progress(event: RequestProgress): void {
    if (this.data.phase !== "requesting" || this.requestStarted === undefined) return;
    const elapsed = this.now() - this.requestStarted;
    if (event.type === "payload") {
      this.data = { ...this.data, payloadMs: this.data.payloadMs ?? elapsed,
        payloadsPrepared: this.data.payloadsPrepared + 1, reasoningOnWire: event.reasoning };
    } else if (event.type === "response") {
      this.data = { ...this.data, responseMs: this.data.responseMs ?? elapsed, responseStatus: event.status };
    } else {
      this.data = { ...this.data, firstThinkingMs: this.data.firstThinkingMs ?? elapsed };
    }
  }

  text(): void {
    if (this.data.phase === "requesting" && this.requestStarted !== undefined && this.data.firstTextMs === undefined) {
      this.data = { ...this.data, firstTextMs: this.now() - this.requestStarted };
    }
  }

  finish(phase: "done" | "failed" | "cancelled" | "cache-hit", error?: ErrorCode, usage?: ExplanationResult["usage"]): void {
    const now = this.now();
    const requestMs = this.requestStarted === undefined ? undefined : now - this.requestStarted;
    this.data = { ...this.data, phase, error, usage, requestMs, totalMs: now - this.started,
      preparationMs: this.data.preparationMs ?? (this.requestStarted === undefined ? now - this.started : undefined),
      generationMs: requestMs !== undefined && this.data.firstTextMs !== undefined ? requestMs - this.data.firstTextMs : undefined };
  }

  displayed(durationMs: number): void {
    this.data = { ...this.data, displayMs: durationMs, totalMs: this.now() - this.started };
  }
}
