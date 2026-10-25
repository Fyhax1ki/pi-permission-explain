import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { resolve, sep } from "node:path";
import type { TestContext } from "node:test";
import type { Api, AssistantMessage, Model } from "@earendil-works/pi-ai";
import type { ExtensionContext, ExtensionUIContext, ModelRegistry, Theme } from "@earendil-works/pi-coding-agent";
import { DEFAULT_CONFIG } from "../src/config.ts";
import type { PreparedExplanation } from "../src/controller.ts";
import type { Registry } from "../src/models.ts";
import { parsePrompt } from "../src/permissions.ts";
import type { ExplanationResult, Presentation, PromptSnapshot } from "../src/types.ts";
import bash from "./fixtures/bash.json" with { type: "json" };

export const fixture = () => structuredClone(bash);
export function prompt(id = "one", generation = 1): PromptSnapshot {
  const event = fixture(); event.requestId = id;
  const parsed = parsePrompt(event, generation);
  if (!parsed) throw new Error("Invalid fixture");
  return parsed;
}

export const result: ExplanationResult = { text: "Purpose: remove build. Effects: deletes files. Cautions: irreversible.", truncated: false, provider: "test", modelId: "small" };
export const presentation: Presentation = { language: "en", shortcut: "alt+e", modelLabel: "small [test]", routed: false };
export const noticeTheme = (): Theme => strictMock<Theme>({
  fg: (color, text) => {
    if (color !== "accent") throw new Error("Unexpected notification color");
    return `\x1b[38;5;45m${text}\x1b[39m`;
  },
  bold: (text) => `\x1b[1m${text}\x1b[22m`,
});
export function prepared(overrides: Partial<PreparedExplanation> = {}): PreparedExplanation {
  return { presentation, cacheKey: "key", cache: DEFAULT_CONFIG.cache, timeoutMs: 20_000, run: async () => result, ...overrides };
}

export function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
export const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

export function model(id = "small", provider = "test"): Model<Api> {
  return { id, provider, name: id, api: "openai-completions", baseUrl: "http://not-used.invalid", input: ["text"], reasoning: false, contextWindow: 64_000, maxTokens: 8192,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
}

export function relayReasoner(): Model<"openai-completions"> {
  return { ...model("qoder/dfmodel", "magpie"), api: "openai-completions", reasoning: true,
    thinkingLevelMap: { off: null, minimal: null, low: "low", medium: null, high: "high", xhigh: null, max: "max" },
    compat: { supportsReasoningEffort: true } };
}

export function registry(models = [model()]): Registry {
  return {
    getAvailable: () => models,
    find: (provider, id) => models.find((item) => item.provider === provider && item.id === id),
    streamSimple: () => { throw new Error("Unexpected model request"); },
  };
}

export function context(reg = registry(), current: Model<Api> | undefined = model()): ExtensionContext {
  return strictMock<ExtensionContext>({
    model: current, modelRegistry: reg as ModelRegistry, mode: "tui", cwd: "/parent-reference",
    signal: undefined, hasUI: true, scopedModels: [],
    ui: strictMock<ExtensionUIContext>({ notify: () => undefined }),
  });
}

/** Test doubles fail closed if production code reaches outside its declared dependencies. */
export function strictMock<T extends object>(members: Partial<T>): T {
  return new Proxy(members, {
    get(target, key, receiver) {
      if (Reflect.has(target, key)) return Reflect.get(target, key, receiver);
      throw new Error(`Unexpected dependency access: ${String(key)}`);
    },
  }) as T;
}

export function message(text = result.text): AssistantMessage {
  return {
    role: "assistant", content: [{ type: "text", text }], api: "openai-completions", provider: "test", model: "small", stopReason: "stop", timestamp: 1,
    usage: { input: 10, output: 20, cacheRead: 0, cacheWrite: 0, totalTokens: 30, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  };
}

export async function temporary(t: TestContext): Promise<string> {
  const root = resolve(".test-tmp");
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(`${root}${sep}case-`);
  t.after(async () => {
    // Validate the absolute target before any recursive cleanup on Windows.
    if (!resolve(directory).startsWith(`${root}${sep}`)) throw new Error("Unsafe test cleanup target");
    await rm(directory, { recursive: true, force: true });
  });
  return directory;
}
