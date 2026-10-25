import { isRecord, type PromptSnapshot } from "./types.ts";

const nullableString = (value: unknown): value is string | null => value === null || typeof value === "string";
const nonempty = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;

/** Project public facts only. Display value and gate value have deliberately different meanings. */
export function parsePrompt(event: unknown, sessionGeneration: number): PromptSnapshot | undefined {
  if (!isRecord(event) || !nonempty(event.requestId) || event.requestId.length > 512) return undefined;
  if (!["tool_call", "skill_input", "skill_read"].includes(String(event.source))) return undefined;
  if (!nullableString(event.surface) || !nullableString(event.value)) return undefined;
  const request = event.request;
  if (!isRecord(request) || !nonempty(request.surface) || typeof request.value !== "string") return undefined;
  if (!nullableString(request.toolName) || !nullableString(request.matchedPattern)) return undefined;
  const requester = request.requester;
  if (!isRecord(requester) || typeof requester.forwarded !== "boolean" || !nullableString(requester.sessionId)) return undefined;
  if (event.forwarding !== null && (!isRecord(event.forwarding) || !nullableString(event.forwarding.requesterSessionId))) return undefined;
  if (request.decidingPath !== null && (!isRecord(request.decidingPath) || typeof request.decidingPath.path !== "string")) return undefined;

  const forwarding = isRecord(event.forwarding) ? event.forwarding : undefined;
  const forwarded = requester.forwarded || forwarding !== undefined;
  const displayIsShell = event.surface === "bash" || (
    request.toolName === "bash" && nonempty(request.invokedToolName) && event.surface === request.invokedToolName
  );
  const shell = event.source === "tool_call" && request.toolName === "bash" && displayIsShell;
  const supportedGate = ["bash", "path", "read", "write", "edit", "external_directory"].includes(request.surface);
  // A path-only projection is not a shell command just because the gated tool is bash.
  const pathOnly = request.surface !== "bash" && event.value === request.value;
  const command = shell && supportedGate && !pathOnly && nonempty(event.value) ? event.value : null;
  return {
    requestId: event.requestId, sessionGeneration,
    toolName: request.toolName, gateSurface: request.surface,
    visibleCommand: command,
    scope: command === null ? "insufficient" : request.surface === "bash" ? "visible-unit" : "visible-command",
    forwarded,
    requesterSessionId: forwarded ? (forwarding?.requesterSessionId as string | null | undefined) ?? requester.sessionId : null,
    matchedPattern: request.matchedPattern,
    decidingPath: isRecord(request.decidingPath) ? String(request.decidingPath.path) : null,
    gateValue: request.value,
  };
}

export function parseDecision(event: unknown): string | undefined {
  return isRecord(event) && nonempty(event.requestId) && (event.result === "allow" || event.result === "deny")
    ? event.requestId : undefined;
}
