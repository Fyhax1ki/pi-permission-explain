import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { cacheKey } from "./cache.ts";
import type { ConfigStore } from "./config.ts";
import type { PreparedExplanation } from "./controller.ts";
import { modelDiagnostics } from "./diagnostics.ts";
import { type ResolvedLocale, resolveLocale } from "./locale.ts";
import { explain, isRouted, resolveModel } from "./models.ts";
import { buildInput, PROMPT_VERSION } from "./prompt.ts";
import { checkReasoningOverride, effectiveReasoning, explicitReasoningOff } from "./reasoning.ts";
import { type Config, ExplainError, type Presentation, type PromptSnapshot } from "./types.ts";
import { singleLine } from "./ui/display.ts";
import { translator } from "./ui/i18n.ts";

export function presentation(config: Config, ctx: ExtensionContext, system: ResolvedLocale): Presentation {
  const language = resolveLocale(config.language, system).tag;
  const current = ctx.model;
  const fixed = config.explanationModel;
  const model = fixed ? ctx.modelRegistry.find(fixed.provider, fixed.modelId) : current;
  const label = fixed ? `${fixed.modelId} [${fixed.provider}]`
    : `${translator(language)("current")}${current ? `: ${current.id} [${current.provider}]` : ""}`;
  return {
    language, shortcut: config.shortcut, modelLabel: singleLine(label, 600),
    routed: model ? isRouted(model) : false,
  };
}

/** Snapshot configuration and the dynamic ctx.model only when an explanation is requested. */
export async function prepareExplanation(
  prompt: PromptSnapshot, ctx: ExtensionContext, store: ConfigStore,
  system: ResolvedLocale, sessionSignal: AbortSignal,
): Promise<PreparedExplanation> {
  const config = await store.reload();
  if (sessionSignal.aborted) throw new ExplainError("cancelled");
  if (store.error) ctx.ui.notify(translator(system.tag)("configInvalid"), "warning");
  if (!config) throw new ExplainError("configInvalid");
  if (!config.enabled) throw new ExplainError("cancelled");
  const model = resolveModel(ctx.modelRegistry, config.explanationModel, ctx.model);
  checkReasoningOverride(config, model);
  const view = presentation(config, ctx, system);
  const input = buildInput(prompt, ctx.cwd, view.language, config);
  const key = isRouted(model) ? undefined : cacheKey({
    provider: model.provider, modelId: model.id, api: model.api, endpoint: model.baseUrl,
    language: view.language, version: PROMPT_VERSION, input: input.digest,
    reasoning: config.reasoning, maxOutputTokens: config.maxOutputTokens,
    effectiveReasoning: effectiveReasoning(config, model),
    thinkingLevelMap: model.thinkingLevelMap,
    compat: model.compat,
    reasoningOffOverride: explicitReasoningOff(config, model) ? config.reasoningOffOverride : null,
    maxInputChars: config.maxInputChars, timeoutMs: config.timeoutMs,
  });
  return {
    presentation: { ...view, modelLabel: singleLine(`${model.id} [${model.provider}]`, 600) },
    diagnostics: modelDiagnostics(model, config),
    cacheKey: key, cacheIdentity: { provider: model.provider, modelId: model.id },
    cache: config.cache, timeoutMs: config.timeoutMs, parentSignal: ctx.signal,
    run: (signal, onText, onProgress) => explain(ctx.modelRegistry, model, input.context, config, signal, onText, onProgress),
  };
}
