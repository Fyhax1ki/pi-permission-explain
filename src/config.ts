import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { validShortcut } from "./keys.ts";
import { normalizeLocale } from "./locale.ts";
import { isThinkingLevel } from "./reasoning.ts";
import { type Config, ExplainError, isRecord } from "./types.ts";

export const DEFAULT_CONFIG: Config = Object.freeze({
  enabled: true,
  shortcut: "alt+e",
  explanationModel: null,
  language: "auto",
  reasoning: "off",
  reasoningOffOverride: null,
  maxOutputTokens: 384,
  timeoutMs: 20_000,
  maxInputChars: 12_000,
  cache: Object.freeze({ enabled: true, maxEntries: 16, ttlMs: 300_000, maxBytes: 262_144 }),
});
const MAX_CONFIG_BYTES = 65_536;

function boolean(value: unknown, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") throw new ExplainError("configInvalid");
  return value;
}
function integer(value: unknown, fallback: number, min: number, max: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    throw new ExplainError("configInvalid");
  }
  return value;
}
function identifier(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 512 && !/[\x00-\x1f\x7f-\x9f]/.test(value);
}

/** Validate known fields strictly; a malformed fixed model never becomes the current model. */
export function validateConfig(raw: unknown): Config {
  if (!isRecord(raw)) throw new ExplainError("configInvalid");
  const defaults = DEFAULT_CONFIG;
  const model = raw.explanationModel;
  if (model !== undefined && model !== null && (!isRecord(model) || !identifier(model.provider) || !identifier(model.modelId))) {
    throw new ExplainError("configInvalid");
  }
  const shortcut = raw.shortcut === undefined ? defaults.shortcut : raw.shortcut;
  if (!validShortcut(shortcut)) throw new ExplainError("configInvalid");
  const language = raw.language === undefined || raw.language === "auto" ? "auto" : normalizeLocale(raw.language);
  if (!language) throw new ExplainError("configInvalid");
  const reasoning = raw.reasoning === undefined ? "off" : raw.reasoning;
  if (!isThinkingLevel(reasoning)) throw new ExplainError("configInvalid");
  const override = raw.reasoningOffOverride;
  if (override !== undefined && override !== null && (!isRecord(override)
    || !identifier(override.provider) || !identifier(override.modelId) || override.mode !== "reasoning-effort-none")) {
    throw new ExplainError("configInvalid");
  }
  const cache = raw.cache === undefined ? {} : raw.cache;
  if (!isRecord(cache)) throw new ExplainError("configInvalid");
  return Object.freeze({
    enabled: boolean(raw.enabled, true), shortcut, language, reasoning,
    reasoningOffOverride: isRecord(override) && identifier(override.provider) && identifier(override.modelId)
      ? Object.freeze({ provider: override.provider, modelId: override.modelId, mode: "reasoning-effort-none" as const }) : null,
    explanationModel: isRecord(model) && identifier(model.provider) && identifier(model.modelId)
      ? Object.freeze({ provider: model.provider, modelId: model.modelId }) : null,
    maxOutputTokens: integer(raw.maxOutputTokens, 384, 128, 2048),
    timeoutMs: integer(raw.timeoutMs, 20_000, 1000, 120_000),
    maxInputChars: integer(raw.maxInputChars, 12_000, 512, 64_000),
    cache: Object.freeze({
      enabled: boolean(cache.enabled, true),
      maxEntries: integer(cache.maxEntries, 16, 0, 128),
      ttlMs: integer(cache.ttlMs, 300_000, 0, 1_800_000),
      maxBytes: integer(cache.maxBytes, 262_144, 0, 2_097_152),
    }),
  });
}

/** Same-directory rename; never delete the destination to make a Windows rename succeed. */
export async function atomicWrite(path: string, content: string): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  await mkdir(dirname(path), { recursive: true });
  try {
    await writeFile(temporary, content, { flag: "wx", mode: 0o600 });
    await rename(temporary, path);
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}

export class ConfigStore {
  private value: Config | undefined;
  private raw: Record<string, unknown> = {};
  private stamp: string | undefined;
  private queue: Promise<unknown> = Promise.resolve();
  error: "configInvalid" | undefined;
  readonly path: string;
  private readonly write: typeof atomicWrite;

  constructor(path: string, write = atomicWrite) {
    this.path = path;
    this.write = write;
  }

  get current(): Config | undefined { return this.value; }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.queue.then(operation, operation);
    this.queue = next.catch(() => undefined);
    return next;
  }

  /** No watcher: only startup, explicit settings and an explanation trigger call this. */
  reload(): Promise<Config | undefined> {
    return this.serialize(async () => {
      try {
        const metadata = await stat(this.path);
        const stamp = `${metadata.mtimeMs}:${metadata.ctimeMs}:${metadata.size}`;
        if (stamp === this.stamp) return this.value;
        if (metadata.size > MAX_CONFIG_BYTES) throw new ExplainError("configInvalid");
        const text = await readFile(this.path, "utf8");
        if (Buffer.byteLength(text) > MAX_CONFIG_BYTES) throw new ExplainError("configInvalid");
        const raw: unknown = JSON.parse(text);
        const config = validateConfig(raw);
        if (isRecord(raw)) this.raw = raw;
        this.value = config;
        this.stamp = stamp;
        this.error = undefined;
      } catch (error) {
        if (isRecord(error) && error.code === "ENOENT") {
          this.value = DEFAULT_CONFIG;
          this.raw = {};
          this.stamp = undefined;
          this.error = undefined;
        } else {
          this.error = "configInvalid";
        }
      }
      return this.value;
    });
  }

  /** Validate -> persist -> commit; preserve unknown top-level/cache fields for future versions. */
  save(config: Config): Promise<void> {
    return this.serialize(async () => {
      const validated = validateConfig(config);
      const raw = {
        ...this.raw, ...validated,
        cache: { ...(isRecord(this.raw.cache) ? this.raw.cache : {}), ...validated.cache },
      };
      const content = `${JSON.stringify(raw, null, 2)}\n`;
      if (Buffer.byteLength(content) > MAX_CONFIG_BYTES) throw new ExplainError("configSaveFailed");
      try { await this.write(this.path, content); }
      catch { throw new ExplainError("configSaveFailed"); }
      this.value = validated;
      this.raw = raw;
      this.stamp = undefined;
      this.error = undefined;
    });
  }
}
