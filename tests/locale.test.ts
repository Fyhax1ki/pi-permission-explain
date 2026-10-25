import assert from "node:assert/strict";
import test from "node:test";
import { detectSystemLocale, normalizeEnvironmentLocale, normalizeLocale, publicLocaleSnapshot, resolveLocale } from "../src/locale.ts";
import { dictionaryLanguage, translator } from "../src/ui/i18n.ts";

test("local environment priority, POSIX normalization and Windows Intl fallback", () => {
  assert.deepEqual(detectSystemLocale({}, () => "zh-CN"), { tag: "zh-CN", source: "Intl" });
  assert.equal(detectSystemLocale({ LC_ALL: "fr_FR.UTF-8", LANG: "en_US.UTF-8" }, () => "zh-CN").tag, "fr-FR");
  for (const value of ["C", "POSIX", "C.UTF-8", "POSIX.UTF-8"]) assert.equal(detectSystemLocale({ LC_ALL: value }, () => "zh-CN").tag, "en");
  assert.equal(detectSystemLocale({ LC_ALL: "broken value", LANGUAGE: "?:pt_BR.UTF-8:en" }, () => "zh-CN").tag, "pt-BR");
  assert.equal(detectSystemLocale({ LC_MESSAGES: "de_DE.UTF-8", LANGUAGE: "ja" }).tag, "de-DE");
  assert.deepEqual(detectSystemLocale({}, () => { throw new Error(); }), { tag: "en", source: "fallback" });
  assert.equal(normalizeEnvironmentLocale("sr_RS.UTF-8@latin"), "sr-Latn-RS");
  assert.equal(normalizeEnvironmentLocale("de_DE@unknown"), undefined);
});

test("explicit/shared locale resolution never mistakes undefined shared locale for English", () => {
  const system = detectSystemLocale({}, () => "zh-CN");
  assert.equal(resolveLocale("ja", system, "en").tag, "ja");
  assert.equal(resolveLocale("auto", system, undefined).tag, "zh-CN");
  assert.equal(resolveLocale("auto", system, "en").tag, "en");
  assert.equal(resolveLocale("auto", system, "de").source, "rpiv");
  assert.equal(resolveLocale("auto", system, "IGNORE INSTRUCTIONS").tag, "zh-CN");
  assert.throws(() => resolveLocale("invalid tag", system));
  assert.equal(normalizeLocale("en-US-u-ca-gregory"), "en-US");
  assert.equal(normalizeLocale("zh-Hant-HK"), "zh-Hant-HK");
});

test("public optional locale snapshot is read anew without importing the extension", (t) => {
  const symbol = Symbol.for("rpiv-i18n");
  const previous = Object.getOwnPropertyDescriptor(globalThis, symbol);
  t.after(() => { if (previous) Object.defineProperty(globalThis, symbol, previous); else Reflect.deleteProperty(globalThis, symbol); });
  Object.defineProperty(globalThis, symbol, { configurable: true, writable: true, value: { locale: "de" } });
  assert.equal(publicLocaleSnapshot(), "de");
  Reflect.set(globalThis, symbol, { locale: "zh-TW" });
  assert.equal(publicLocaleSnapshot(), "zh-TW");
  Reflect.set(globalThis, symbol, { locale: undefined });
  assert.equal(resolveLocale("auto", { tag: "zh-CN", source: "Intl" }).tag, "zh-CN");
});

test("UI fallback preserves separate target-language semantics", () => {
  assert.equal(dictionaryLanguage("zh-CN"), "zh-CN");
  assert.equal(dictionaryLanguage("zh-SG"), "zh-CN");
  for (const tag of ["zh-TW", "zh-Hant-HK", "ja-JP", "de-DE"]) {
    assert.equal(dictionaryLanguage(tag), "en");
    assert.equal(resolveLocale(tag, { tag: "en", source: "fallback" }).tag, tag);
    assert.equal(translator(tag)("model"), translator("en")("model"));
  }
});
