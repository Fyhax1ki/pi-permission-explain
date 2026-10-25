import { isKeyRelease, type KeyId, matchesKey } from "@earendil-works/pi-tui";

const specialKeys = new Set([
  "escape", "esc", "enter", "return", "tab", "space", "backspace", "delete", "insert",
  "clear", "home", "end", "pageUp", "pageDown", "up", "down", "left", "right",
  ...Array.from({ length: 12 }, (_, index) => `f${index + 1}`),
]);

/** Require a non-printing modifier; shift+letter alone interferes with normal text/IME. */
export function validShortcut(value: unknown): value is KeyId {
  if (typeof value !== "string" || value.length > 64) return false;
  const match = /^((?:(?:ctrl|alt|shift|super)\+)+)(.+)$/.exec(value);
  if (!match?.[1] || !match[2]) return false;
  const modifiers = match[1].slice(0, -1).split("+");
  if (new Set(modifiers).size !== modifiers.length) return false;
  if (!modifiers.some((modifier) => modifier !== "shift")) return false;
  const base = match[2];
  return specialKeys.has(base) || /^[a-z0-9`\-=[\]\\;',./!@#$%^&*()_+|~{}:<>?]$/.test(base);
}

/** Track bracketed paste across chunks without interpreting pasted text as shortcuts. */
export class ShortcutInput {
  private inPaste = false;

  matches(data: string, shortcut: string, active: boolean): boolean {
    const pasteStart = data.includes("\x1b[200~");
    const pasteEnd = data.includes("\x1b[201~");
    if (this.inPaste || pasteStart || pasteEnd) {
      if (pasteStart) this.inPaste = true;
      if (pasteEnd) this.inPaste = false;
      return false;
    }
    return active && data.length <= 64 && !isKeyRelease(data) && validShortcut(shortcut) && matchesKey(data, shortcut);
  }
}
