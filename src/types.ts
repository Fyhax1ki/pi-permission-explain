import type { ModelThinkingLevel } from "@earendil-works/pi-ai";

export interface ModelReference {
  readonly provider: string;
  readonly modelId: string;
}

export interface ReasoningOffOverride extends ModelReference {
  readonly mode: "reasoning-effort-none";
}

export interface CacheOptions {
  readonly enabled: boolean;
  readonly maxEntries: number;
  readonly ttlMs: number;
  readonly maxBytes: number;
}

export interface Config {
  readonly enabled: boolean;
  readonly shortcut: string;
  readonly explanationModel: ModelReference | null;
  readonly language: string;
  readonly reasoning: ModelThinkingLevel;
  readonly reasoningOffOverride: ReasoningOffOverride | null;
  readonly maxOutputTokens: number;
  readonly timeoutMs: number;
  readonly maxInputChars: number;
  readonly cache: CacheOptions;
}

export interface PromptSnapshot {
  readonly requestId: string;
  readonly sessionGeneration: number;
  readonly toolName: string | null;
  readonly gateSurface: string;
  readonly visibleCommand: string | null;
  readonly scope: "visible-command" | "visible-unit" | "insufficient";
  readonly forwarded: boolean;
  readonly requesterSessionId: string | null;
  readonly matchedPattern: string | null;
  readonly decidingPath: string | null;
  readonly gateValue: string;
}

export type ErrorCode =
  | "configInvalid"
  | "configSaveFailed"
  | "modelUnavailable"
  | "noModel"
  | "reasoningOverrideUnsupported"
  | "reasoningOverrideConflict"
  | "inputTooLong"
  | "unsafeInput"
  | "timeout"
  | "emptyOutput"
  | "requestFailed"
  | "cancelled"
  | "unsupported";

/** Only stable categories reach the UI; provider errors may contain credentials. */
export class ExplainError extends Error {
  readonly code: ErrorCode;
  constructor(code: ErrorCode) {
    super(code);
    this.code = code;
  }
}

export interface ExplanationResult {
  readonly text: string;
  readonly truncated: boolean;
  readonly provider: string;
  readonly modelId: string;
  readonly usage?: { readonly input: number; readonly output: number; readonly reasoning: number };
}

export interface Presentation {
  readonly language: string;
  readonly shortcut: string;
  readonly modelLabel: string;
  readonly routed: boolean;
}

interface ViewBase {
  readonly prompt: PromptSnapshot;
  readonly presentation: Presentation;
}

export type ExplanationView =
  | { readonly phase: "idle" }
  | (ViewBase & { readonly phase: "ready" | "unsupported" })
  | (ViewBase & { readonly phase: "loading"; readonly text: string })
  | (ViewBase & { readonly phase: "done"; readonly result: ExplanationResult; readonly cached: boolean })
  | (ViewBase & { readonly phase: "failed"; readonly error: ErrorCode });

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
