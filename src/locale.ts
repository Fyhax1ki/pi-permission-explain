import { ExplainError, isRecord } from "./types.ts";

export type LocaleSource = "config" | "rpiv" | "LC_ALL" | "LC_MESSAGES" | "LANGUAGE" | "LANG" | "Intl" | "fallback";
export interface ResolvedLocale {
  readonly tag: string;
  readonly source: LocaleSource;
}

/** Validate explicit BCP 47 tags. Formatting extensions do not control explanation language. */
export function normalizeLocale(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim() || value.length > 64) return undefined;
  try {
    return new Intl.Locale(value.trim()).baseName;
  } catch {
    return undefined;
  }
}

export function normalizeEnvironmentLocale(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 128) return undefined;
  const [base = "", modifier] = value.trim().split("@");
  const tag = base.split(".")[0] ?? "";
  if (/^(C|POSIX)$/i.test(tag)) return modifier ? undefined : "en";
  const normalized = normalizeLocale(tag.replaceAll("_", "-"));
  if (!normalized) return undefined;
  if (!modifier || modifier === "euro") return normalized;
  const script = ({ latin: "Latn", cyrillic: "Cyrl" } as Record<string, string>)[modifier];
  if (!script) return undefined;
  return new Intl.Locale(normalized, { script }).baseName;
}

export function detectSystemLocale(
  env: Record<string, string | undefined> = process.env,
  intl: () => string = () => Intl.DateTimeFormat().resolvedOptions().locale,
): ResolvedLocale {
  for (const source of ["LC_ALL", "LC_MESSAGES", "LANGUAGE", "LANG"] as const) {
    const raw = env[source];
    if (!raw || raw.length > 1024) continue;
    for (const value of source === "LANGUAGE" ? raw.split(":") : [raw]) {
      const tag = normalizeEnvironmentLocale(value);
      if (tag) return { tag, source };
    }
  }
  try {
    const tag = normalizeLocale(intl());
    if (tag) return { tag, source: "Intl" };
  } catch { /* Intl may be unavailable in a stripped runtime. */ }
  return { tag: "en", source: "fallback" };
}

/** Read only the documented, optional snapshot; undefined must not mask Windows Intl. */
export function publicLocaleSnapshot(): unknown {
  try {
    const snapshot: unknown = Reflect.get(globalThis, Symbol.for("rpiv-i18n"));
    return isRecord(snapshot) ? snapshot.locale : undefined;
  } catch {
    return undefined;
  }
}

export function resolveLocale(
  preference: string,
  system: ResolvedLocale,
  shared: unknown = publicLocaleSnapshot(),
): ResolvedLocale {
  if (preference !== "auto") {
    const tag = normalizeLocale(preference);
    if (!tag) throw new ExplainError("configInvalid");
    return { tag, source: "config" };
  }
  const tag = normalizeLocale(shared);
  return tag ? { tag, source: "rpiv" } : system;
}
