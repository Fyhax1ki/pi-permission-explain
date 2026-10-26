import { stripTerminalSequences } from "@earendil-works/pi-tui";
import { MAX_OUTPUT_CHARS } from "../prompt.ts";

/** Model text and registry labels are data, never terminal escape sequences or interactive Markdown. */
export function safeText(text: string, limit = MAX_OUTPUT_CHARS): string {
  return stripTerminalSequences(text.slice(0, limit))
    .replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "")
    .replaceAll("\t", " ");
}

export function singleLine(text: string, limit = 200): string {
  return safeText(text, limit).replace(/[\r\n]+/g, " ");
}

/** Render model prose as one plain paragraph: no Markdown headings, lists, emphasis, code spans or line breaks. */
export function plainProse(text: string, limit = MAX_OUTPUT_CHARS): string {
  return safeText(text, limit)
    .replace(/^\s*```.*$/gm, " ")
    .replace(/^\s{0,3}(?:#{1,6}|[-*+•>]|\d+[.)])\s+/gm, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
