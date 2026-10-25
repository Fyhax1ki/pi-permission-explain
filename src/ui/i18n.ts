import en from "../../locales/en.json" with { type: "json" };
import zhCN from "../../locales/zh-CN.json" with { type: "json" };

export type MessageKey = keyof typeof en;
export type Translate = (key: MessageKey) => string;

export function dictionaryLanguage(tag: string): "zh-CN" | "en" {
  try {
    const locale = new Intl.Locale(tag).maximize();
    return locale.language === "zh" && locale.script === "Hans" ? "zh-CN" : "en";
  } catch { return "en"; }
}

export function translator(tag: string): Translate {
  const dictionary: Partial<Record<MessageKey, string>> = dictionaryLanguage(tag) === "zh-CN" ? zhCN : en;
  return (key) => dictionary[key] ?? en[key];
}
