import assert from "node:assert/strict";
import test from "node:test";
import { parseDecision, parsePrompt } from "../src/permissions.ts";
import pathEvent from "./fixtures/bash-path.json" with { type: "json" };
import externalDirectory from "./fixtures/bash-external-directory.json" with { type: "json" };
import { fixture } from "./helpers.ts";

test("bash rules explain only visible units; path asks use display command, never the gate path", () => {
  const bash = parsePrompt(fixture(), 4);
  assert.equal(bash?.scope, "visible-unit"); assert.equal(bash?.sessionGeneration, 4);
  const path = parsePrompt(pathEvent, 1);
  assert.equal(path?.visibleCommand, "cat /protected/config");
  assert.equal(path?.gateValue, "/protected/config");
  assert.equal(path?.decidingPath, "/protected/config");
  assert.equal(path?.scope, "visible-command");
  assert.equal(parsePrompt({ ...pathEvent, value: pathEvent.request.value }, 1)?.scope, "insufficient");
});

test("only reliable shell surfaces supported, including explicitly published bash aliases", () => {
  assert.equal(parsePrompt({ ...fixture(), surface: "powershell" }, 1)?.scope, "insufficient");
  const alias = fixture();
  const published = { ...alias, surface: "exec_command", request: { ...alias.request, invokedToolName: "exec_command" } };
  assert.equal(parsePrompt(published, 1)?.scope, "visible-unit");
  assert.equal(parsePrompt({ ...alias, source: "skill_read" }, 1)?.scope, "insufficient");
  assert.equal(parsePrompt({ ...alias, value: null }, 1)?.scope, "insufficient");
});

test("bash external-directory asks explain the command and gate on the deciding path", () => {
  const ask = parsePrompt(externalDirectory, 2);
  assert.equal(ask?.scope, "visible-command");
  assert.equal(ask?.visibleCommand, externalDirectory.value);
  assert.equal(ask?.gateValue, "/tmp/naa*");
  assert.equal(ask?.decidingPath, "/tmp/naa*");
  // Without a deciding path distinct from the gate value, equality still only proves a path projection.
  const toolAsk = { ...pathEvent, value: pathEvent.request.value, request: { ...pathEvent.request, surface: "external_directory", decidingPath: null } };
  assert.equal(parsePrompt(toolAsk, 1)?.scope, "insufficient");
});

test("forwarded identity is distinct from tool-call identity and parent directory", () => {
  const event = { ...fixture(), forwarding: { requesterAgentName: "child", requesterSessionId: "child-session" } };
  const snapshot = parsePrompt(event, 1);
  assert.equal(snapshot?.forwarded, true); assert.equal(snapshot?.requesterSessionId, "child-session");
  assert.equal(snapshot && "cwd" in snapshot, false);
  assert.equal(snapshot && "toolCallId" in snapshot, false);
});

test("malformed public events are rejected at unknown boundaries", () => {
  for (const event of [null, {}, [], { ...fixture(), requestId: " " }, { ...fixture(), value: 4 }, { ...fixture(), forwarding: {} }, { ...fixture(), request: {} }, { ...fixture(), request: { ...fixture().request, requester: null } }]) assert.equal(parsePrompt(event, 1), undefined);
  assert.equal(parseDecision({ requestId: "one", result: "allow" }), "one");
  assert.equal(parseDecision({ requestId: "one", result: "ask" }), undefined);
});
