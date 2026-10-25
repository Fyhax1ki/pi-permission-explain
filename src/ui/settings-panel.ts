import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import { ConfigStore, DEFAULT_CONFIG, validateConfig } from "../config.ts";
import { detectSystemLocale, resolveLocale } from "../locale.ts";
import { resolveModel } from "../models.ts";
import { checkReasoningOverride, effectiveReasoning, isThinkingLevel, reasoningMetadataDisallowsOff, reasoningMetadataSummary } from "../reasoning.ts";
import { type Config, ExplainError } from "../types.ts";
import { singleLine } from "./display.ts";
import { type MessageKey, type Translate, translator } from "./i18n.ts";
import { type Choice, pickChoice, pickModel } from "./model-picker.ts";

async function pickLanguage(ctx: ExtensionContext, config: Config, t: Translate, signal: AbortSignal): Promise<string | undefined> {
  const detected = resolveLocale("auto", detectSystemLocale());
  const value = await pickChoice(ctx, t("language"), [
    { value: "auto", label: `${t("auto")} (${detected.tag}, ${t(`source_${detected.source}`)})` },
    { value: "zh-CN", label: t("localeSimple") },
    { value: "zh-TW", label: t("localeTraditional") },
    { value: "en", label: t("localeEnglish") },
    { value: "__custom__", label: t("customLanguage") },
  ], t, { selected: config.language, signal });
  return value === "__custom__" ? ctx.ui.input(t("languageTag"), config.language, { signal }) : value;
}

async function advanced(ctx: ExtensionContext, config: Config, t: Translate, signal: AbortSignal): Promise<Config | undefined> {
  const key = await pickChoice(ctx, t("advanced"), [
    { value: "reasoning", label: t("reasoning"), description: config.reasoning === "off" && config.reasoningOffOverride
      ? singleLine(`off / none: ${config.reasoningOffOverride.modelId} [${config.reasoningOffOverride.provider}]`) : config.reasoning },
    { value: "maxOutputTokens", label: t("maxOutputTokens"), description: String(config.maxOutputTokens) },
    { value: "timeoutMs", label: t("timeoutMs"), description: String(config.timeoutMs) },
    { value: "cache", label: t("cache"), description: t(config.cache.enabled ? "on" : "off") },
  ], t, { signal });
  if (key === "cache") return { ...config, cache: { ...config.cache, enabled: !config.cache.enabled } };
  if (key === "reasoning") {
    const model = resolveModel(ctx.modelRegistry, config.explanationModel, ctx.model);
    const levels = getSupportedThinkingLevels(model);
    const choices: Choice[] = levels.map((level) => ({ value: level, label: level === "off" ? t("reasoningOffAdapter") : level }));
    if (model.api === "openai-completions") choices.push({ value: "explicit-none", label: t("reasoningOffExplicit") });
    const selected = effectiveReasoning(config, model);
    const hint = `${t("reasoning")}: ${config.reasoning} | ${t("effectiveReasoning")}: ${selected}`;
    const reasoning = await pickChoice(ctx, t("reasoning"), choices, t, { selected, hint, signal });
    if (reasoning === "explicit-none") {
      const next: Config = { ...config, reasoning: "off", reasoningOffOverride: {
        provider: model.provider, modelId: model.id, mode: "reasoning-effort-none",
      } };
      checkReasoningOverride(next, model);
      const target = singleLine(`${model.id} [${model.provider}]`);
      const details = [target, `${t("reasoningMetadata")}: ${reasoningMetadataSummary(model)}`];
      if (reasoningMetadataDisallowsOff(model)) details.push(t("reasoningOffMetadataWarning"));
      details.push(t("reasoningOffConfirm"));
      return await ctx.ui.confirm(t("reasoningOffExplicit"), details.join("\n"), { signal }) ? next : undefined;
    }
    return isThinkingLevel(reasoning) && levels.includes(reasoning) ? { ...config, reasoning, reasoningOffOverride: null } : undefined;
  }
  if (key === "maxOutputTokens" || key === "timeoutMs") {
    const input = await ctx.ui.input(t(key), String(config[key]), { signal });
    if (input === undefined) return undefined;
    if (!/^\d+$/.test(input)) throw new ExplainError("configInvalid");
    return { ...config, [key]: Number(input) };
  }
  return undefined;
}

/** Every edit is validated and saved before the in-memory configuration changes. */
export async function openSettings(ctx: ExtensionContext, store: ConfigStore, signal: AbortSignal): Promise<void> {
  let system = detectSystemLocale();
  let t = translator(system.tag);
  let config = await store.reload();
  if (signal.aborted) return;
  if (store.error) ctx.ui.notify(t("configInvalid"), "warning");
  if (!config) {
    if (!await ctx.ui.confirm(t("repairTitle"), t("repairPrompt"), { signal }) || signal.aborted) return;
    await store.save(DEFAULT_CONFIG);
    config = store.current;
  }
  while (config && !signal.aborted) {
    const locale = resolveLocale(config.language, system);
    t = translator(locale.tag);
    const model = config.explanationModel;
    const choices: Choice[] = [
      { value: "enabled", label: t("enabled"), description: t(config.enabled ? "on" : "off") },
      { value: "shortcut", label: t("shortcut"), description: config.shortcut },
      { value: "model", label: t("model"), description: model ? singleLine(`${model.modelId} [${model.provider}]`) : t("current") },
      { value: "language", label: t("language"), description: `${config.language} (${locale.tag}, ${t(`source_${locale.source}`)})` },
      { value: "advanced", label: t("advanced") },
    ];
    const key = await pickChoice(ctx, t("settingsTitle"), choices, t, { signal });
    if (!key || signal.aborted) return;
    try {
      let next: Config | undefined;
      if (key === "enabled") next = { ...config, enabled: !config.enabled };
      else if (key === "shortcut") {
        const shortcut = await ctx.ui.input(t("shortcut"), config.shortcut, { signal });
        if (shortcut !== undefined) next = { ...config, shortcut };
      } else if (key === "model") {
        const explanationModel = await pickModel(ctx, config.explanationModel, t, signal);
        if (explanationModel !== undefined) next = { ...config, explanationModel };
      } else if (key === "language") {
        const language = await pickLanguage(ctx, config, t, signal);
        if (language !== undefined) next = { ...config, language };
      } else if (key === "advanced") next = await advanced(ctx, config, t, signal);
      if (signal.aborted) return;
      if (next) {
        await store.save(validateConfig(next));
        ctx.ui.notify(t("saved"), "info");
      }
    } catch (error) {
      const key: MessageKey = error instanceof ExplainError ? error.code : "configSaveFailed";
      ctx.ui.notify(t(key), "error");
    }
    if (signal.aborted) return;
    config = await store.reload();
    if (store.error) ctx.ui.notify(t("configInvalid"), "warning");
    system = detectSystemLocale();
  }
}
