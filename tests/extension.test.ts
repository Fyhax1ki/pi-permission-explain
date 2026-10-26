import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import { createEventBus, discoverAndLoadExtensions, type ExtensionCommandContext, type ExtensionContext, type ExtensionUIContext, type TerminalInputHandler } from "@earendil-works/pi-coding-agent";
import { context, fixture, flush, message, model, noticeTheme, registry, strictMock, temporary } from "./helpers.ts";

test("real Pi loader + isolated event bus: lifecycle, raw input, no global shortcut/tools or session writes", async (t) => {
  const dir = await temporary(t);
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = dir;
  t.after(() => { if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous; });
  const events = createEventBus();
  const loaded = await discoverAndLoadExtensions([resolve("src/index.ts")], dir, dir, events);
  assert.deepEqual(loaded.errors, []);
  assert.equal(loaded.extensions.length, 1);
  const extension = loaded.extensions[0];
  assert.ok(extension);
  assert.equal(extension.tools.size, 0); assert.equal(extension.shortcuts.size, 0);
  assert.ok(extension.commands.has("permission-explain-settings"));
  const diagnostics = extension.commands.get("permission-explain-diagnostics");
  assert.ok(diagnostics);

  let raw: TerminalInputHandler | undefined;
  let attached = 0; let detached = 0; let calls = 0; let statuses = 0; let widgets = 0;
  const notifications: string[] = [];
  let stream = createAssistantMessageEventStream();
  const reg = registry();
  reg.streamSimple = () => { calls++; stream = createAssistantMessageEventStream(); return stream; };
  const ui = strictMock<ExtensionUIContext>({
    theme: noticeTheme(),
    notify: (message) => { notifications.push(message); },
    onTerminalInput: (handler) => { raw = handler; attached++; return () => { raw = undefined; detached++; }; },
    setWidget: () => { widgets++; },
    setStatus: () => { statuses++; },
  });
  const ctx = context(reg); ctx.ui = ui;
  const emit = async (type: string, context: ExtensionContext = ctx) => {
    for (const handler of extension.handlers.get(type) ?? []) await handler({ type, reason: "reload" }, context);
  };
  await emit("session_start");
  assert.equal(attached, 1);
  assert.equal(raw?.("\x1be"), undefined);
  assert.equal(calls, 0);
  await diagnostics.handler("", ctx as ExtensionCommandContext);
  assert.equal(calls, 0); assert.match(notifications.at(-1) ?? "", /openai-completions/);
  notifications.length = 0;
  events.emit("permissions:ui_prompt", fixture());
  assert.ok(statuses > 0); assert.equal(widgets, 0);
  assert.equal(raw?.("y"), undefined);
  assert.deepEqual(raw?.("\x1be"), { consume: true });
  assert.deepEqual(raw?.("\x1be"), { consume: true });
  // Config IO is intentional only after the trigger; wait for that single request.
  for (let index = 0; index < 50 && calls === 0; index++) await flush();
  assert.equal(calls, 1);
  stream.push({ type: "done", reason: "stop", message: message() });
  await flush();
  raw?.("\x1be"); assert.equal(calls, 1);
  assert.equal(notifications.length, 1); assert.match(notifications[0] ?? "", /Removes the build directory/);
  assert.match(notifications[0] ?? "", /\x1b\[38;5;45m/);
  await diagnostics.handler("", ctx as ExtensionCommandContext);
  assert.equal(calls, 1); assert.match(notifications.at(-1) ?? "", /done/);
  events.emit("permissions:decision", { requestId: fixture().requestId, result: "deny" });
  assert.equal(raw?.("\x1be"), undefined);
  await emit("session_shutdown");
  const before = statuses;
  events.emit("permissions:ui_prompt", fixture());
  assert.equal(statuses, before); assert.equal(raw, undefined); assert.equal(detached, 1);
  for (const mode of ["rpc", "print", "json"] as const) {
    const nonTui = context(reg, model()); nonTui.mode = mode; nonTui.ui = ui;
    await emit("session_start", nonTui);
    events.emit("permissions:ui_prompt", fixture());
    assert.equal(attached, 1);
  }
  await emit("session_start"); assert.equal(attached, 2);
  await emit("session_start"); assert.equal(attached, 3); assert.equal(detached, 2);
  await emit("session_shutdown"); assert.equal(detached, 3);
  assert.equal(calls, 1);
  assert.equal(widgets, 0);
  assert.deepEqual(await readdir(dir), []);
});
