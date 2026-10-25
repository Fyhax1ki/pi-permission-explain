import { type Api, clampThinkingLevel, type Model, type ModelThinkingLevel } from "@earendil-works/pi-ai";
import { type Config, ExplainError, isRecord } from "./types.ts";

// Config vocabulary only; model capabilities and clamping come from Pi's public helpers.
const THINKING_LEVELS: readonly ModelThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

export function isThinkingLevel(value: unknown): value is ModelThinkingLevel {
  return (THINKING_LEVELS as readonly unknown[]).includes(value);
}

/** Use Pi's session-level capability clamp without reading or mutating the primary session. */
export function effectiveReasoning(config: Config, model: Model<Api>): ModelThinkingLevel | "explicit-none" {
  return explicitReasoningOff(config, model) ? "explicit-none" : clampThinkingLevel(model, config.reasoning);
}

/** Explicit opt-in is scoped to one provider/model, never inferred from an alias or URL. */
export function explicitReasoningOff(config: Config, model: Model<Api> | undefined): boolean {
  const override = config.reasoningOffOverride;
  return config.reasoning === "off" && !!override && !!model
    && override.provider === model.provider && override.modelId === model.id;
}

export function checkReasoningOverride(config: Config, model: Model<Api>): void {
  // An explicit compatibility test may contradict metadata; it must never cross API boundaries.
  if (explicitReasoningOff(config, model) && model.api !== "openai-completions") {
    throw new ExplainError("reasoningOverrideUnsupported");
  }
}

export function reasoningMetadataDisallowsOff(model: Model<Api>): boolean {
  return model.thinkingLevelMap?.off === null
    || !!(model.compat && "supportsReasoningEffort" in model.compat && model.compat.supportsReasoningEffort === false);
}

/** Allowlisted labels only: custom mapping strings may contain arbitrary configuration data. */
export function reasoningMetadataSummary(model: Model<Api>): string {
  const off = model.thinkingLevelMap?.off;
  const offLabel = off === undefined ? "unset" : off === null ? "null"
    : /^(off|none|disabled|minimal|low|medium|high|xhigh|max|auto)$/i.test(off) ? off : "custom";
  const effort = model.compat && "supportsReasoningEffort" in model.compat ? model.compat.supportsReasoningEffort : undefined;
  const effortLabel = effort === true ? "true" : effort === false ? "false" : "unset";
  return `thinkingLevelMap.off=${offLabel}, compat.supportsReasoningEffort=${effortLabel}`;
}

/** The payload hook is request-local; shared registry models and their metadata stay untouched. */
export function applyReasoningOverride(payload: unknown, config: Config, model: Model<Api> | undefined): unknown {
  if (!explicitReasoningOff(config, model)) return payload;
  if (!model || model.api !== "openai-completions" || !isRecord(payload)) {
    throw new ExplainError("reasoningOverrideUnsupported");
  }
  checkReasoningOverride(config, model);
  // Do not combine this opt-in with a different adapter's thinking dialect or budget.
  const budgetField = model.compat && "thinkingTokenBudgetField" in model.compat ? model.compat.thinkingTokenBudgetField : undefined;
  const keys = ["thinking", "enable_thinking", "reasoning", "chat_template_kwargs", "chat_template_args", "thinking_budget", "reasoning_budget", "thinking_token_budget"];
  if (budgetField) keys.push(budgetField);
  for (const key of keys) {
    if (payload[key] !== undefined) throw new ExplainError("reasoningOverrideConflict");
  }
  return { ...payload, reasoning_effort: "none" };
}
