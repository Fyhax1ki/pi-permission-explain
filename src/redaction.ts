import { ExplainError } from "./types.ts";

const SECRET_NAME = "(?:[A-Z0-9_]*(?:TOKEN|PASSWORD|PASSWD|API_KEY|SECRET|ACCESS_KEY|PRIVATE_KEY)[A-Z0-9_]*)";
const SHELL_VALUE = String.raw`(?:"(?:\\[\s\S]|[^"\\])*"|'[^']*'|\\[\s\S]|[^\s;&|"'\\])+`;
const assignment = new RegExp(`\\b(${SECRET_NAME}=)${SHELL_VALUE}`, "gi");
const flag = new RegExp(`(--(?:token|password|passwd|api[-_]key|secret|access[-_]key)(?:=|\\s+))${SHELL_VALUE}`, "gi");
const unmaskedAssignment = new RegExp(`\\b${SECRET_NAME}=(?!\\[REDACTED\\])(?=\\S)`, "i");
const unmaskedFlag = /--(?:token|password|passwd|api[-_]key|secret|access[-_]key)(?:=|\s+)(?!\[REDACTED\])(?=\S)/i;

/** Best-effort masking, not a shell parser or a guarantee that no secrets remain. */
export function redact(value: string): string {
  if (/[\x00\x1b]/.test(value)) throw new ExplainError("unsafeInput");
  const masked = value
    .replace(/(["'])(Authorization|Proxy-Authorization|Cookie|Set-Cookie)\s*:(?:\\[\s\S]|(?!\1)[^\\])*?\1|\b(Authorization|Proxy-Authorization|Cookie|Set-Cookie)\s*:[^\r\n]*/gi,
      (_match, quote: string | undefined, quotedName: string | undefined, plainName: string | undefined) =>
        quote ? `${quote}${quotedName}: [REDACTED]${quote}` : `${plainName}: [REDACTED]`)
    .replace(assignment, "$1[REDACTED]")
    .replace(flag, "$1[REDACTED]")
    .replace(/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/gi, "$1[REDACTED]@");
  // An unclosed quoted secret is not safe to send just because the word matcher failed.
  if (unmaskedAssignment.test(masked) || unmaskedFlag.test(masked)) throw new ExplainError("unsafeInput");
  return masked;
}
