import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, Text, visibleWidth } from "@earendil-works/pi-tui";
import { ShortcutInput, validShortcut } from "../src/keys.ts";
import { safeText } from "../src/ui/display.ts";
import { explanationNotice, ExplanationNotifications } from "../src/ui/explanation-notifications.ts";
import { filterChoices } from "../src/ui/model-picker.ts";
import { noticeTheme, presentation, prompt, result, strictMock } from "./helpers.ts";

test("exact modified keys only; normal keys, IME, releases and paste pass through", () => {
  for (const key of ["alt+e", "ctrl+alt+x", "super+k", "ctrl+pageUp", "alt++"]) assert.equal(validShortcut(key), true, key);
  for (const key of ["e", "shift+e", "foo+e", "ctrl+ctrl+e", "alt+", "alt+wat"]) assert.equal(validShortcut(key), false, key);
  const keys = new ShortcutInput();
  assert.equal(keys.matches("\x1be", "alt+e", false), false);
  assert.equal(keys.matches("\x1be", "alt+e", true), true);
  for (const data of ["e", "y", "s", "n", "r", "\r", "\x1b", "\x0f", "中文", "\x1b[101;3:3u"]) assert.equal(keys.matches(data, "alt+e", true), false);
  assert.equal(keys.matches("\x1b[101;3u", "alt+e", true), true);
  assert.equal(keys.matches("\x1b[200~", "alt+e", false), false);
  assert.equal(keys.matches("\x1be", "alt+e", true), false);
  assert.equal(keys.matches("\x1b[201~", "alt+e", true), false);
  assert.equal(keys.matches("\x1be", "alt+e", true), true);
});

test("Pi notifications preserve complete text and omit the four removed banners", () => {
  assert.equal(safeText("before\x1b[2Jafter\u202e"), "beforeafter");
  const view = { phase: "done", prompt: prompt(), presentation: { ...presentation, language: "zh-CN", modelLabel: "very-long-provider-模型".repeat(10) }, result: { ...result, text: "说明中文长文字\n".repeat(60) }, cached: false } as const;
  const notice = explanationNotice(view);
  assert.ok(notice.includes(view.result.text));
  assert.doesNotMatch(notice, /有限脱敏|不保证覆盖|推理偏好尽力适配|不是批准或安全保证/);
  assert.match(notice, /small \[test\]/);
});

test("only completion notifies once; streaming uses status, never widgets or a focused dialog", () => {
  const messages: string[] = []; const statuses: (string | undefined)[] = []; let widgets = 0;
  const ui = strictMock<ExtensionUIContext>({
    theme: noticeTheme(),
    notify: (message) => { messages.push(message); },
    setStatus: (_key, status) => { statuses.push(status); },
    setWidget: () => { widgets++; },
  });
  const notifications = new ExplanationNotifications(ui);
  const snapshot = prompt();
  notifications.update({ phase: "ready", prompt: snapshot, presentation });
  for (const text of ["", "partial", "partial text"]) notifications.update({ phase: "loading", prompt: snapshot, presentation, text });
  assert.equal(messages.length, 0); assert.equal(statuses.length, 2);
  const done = { phase: "done", prompt: snapshot, presentation, result, cached: false } as const;
  notifications.update(done); notifications.update({ ...done });
  assert.equal(messages.length, 1);
  assert.match(messages[0] ?? "", /\x1b\[38;5;45m/);
  notifications.update({ phase: "idle" }); notifications.dispose();
  assert.equal(messages.length, 1); assert.equal(statuses.at(-1), undefined); assert.equal(widgets, 0);
});

test("highlighted explanations strip model escape sequences before applying theme color and bold title", () => {
  const view = { phase: "done", prompt: prompt(), presentation,
    result: { ...result, modelId: "small\x1b[2J", text: "First\x1b[31m line\x1b[0m\nSecond\u202e line", truncated: true }, cached: false } as const;
  const plain = explanationNotice(view);
  const styled = explanationNotice(view, noticeTheme());
  assert.equal(stripTerminalSequences(styled), plain);
  assert.ok(styled.startsWith("\x1b[22m\x1b[38;5;45m\x1b[1m"));
  assert.ok(styled.endsWith("\x1b[39m\x1b[22m"));
  assert.doesNotMatch(styled, /\x1b\[2J|\x1b\[31m|\u202e/);
  assert.ok(styled.includes("First line\nSecond line"));
  // Exercise Pi's normal dim wrapper and real multiline/wrapping component.
  const wrapped = `\x1b[90m\x1b[2m${styled}\x1b[22;39m`;
  for (const width of [12, 40, 120]) {
    const rendered = new Text(wrapped, 1, 0).render(width);
    assert.ok(rendered.length > 1);
    for (const line of rendered) assert.ok(visibleWidth(line) <= width);
    assert.ok(rendered.some((line) => line.includes("\x1b[38;5;45m")));
  }
});

test("theme failures fall back to a plain info notification instead of hiding the explanation", () => {
  for (const theme of [undefined, strictMock<ReturnType<typeof noticeTheme>>({ bold: () => { throw new Error("Theme unavailable"); } })]) {
    const messages: string[] = [];
    const ui = strictMock<ExtensionUIContext>({
      ...(theme ? { theme } : {}),
      notify: (message, type) => { assert.equal(type, "info"); messages.push(message); },
      setStatus: () => undefined,
    });
    const view = { phase: "done", prompt: prompt(), presentation, result, cached: false } as const;
    new ExplanationNotifications(ui).update(view);
    assert.deepEqual(messages, [explanationNotice(view)]);
  }
});

test("cancelling an unfinished explanation never leaves a partial Pi notification", () => {
  const messages: string[] = []; const statuses: (string | undefined)[] = [];
  const notifications = new ExplanationNotifications(strictMock<ExtensionUIContext>({
    notify: (message) => { messages.push(message); },
    setStatus: (_key, status) => { statuses.push(status); },
  }));
  notifications.update({ phase: "loading", prompt: prompt(), presentation, text: "partial" });
  notifications.update({ phase: "idle" });
  assert.deepEqual(messages, []); assert.equal(statuses.at(-1), undefined);
});

test("search matches display names, IDs and providers, independently of translated labels", () => {
  const choices = [{ value: '["provider-a","org/small"]', label: "Friendly Name", description: "provider-a" }];
  for (const query of ["friendly", "org/small", "PROVIDER-A"]) assert.equal(filterChoices(choices, query).length, 1);
  assert.equal(filterChoices(choices, "absent").length, 0);
});

test("locale dictionaries have equal keys and stable error categories", async () => {
  const en = JSON.parse(await readFile(new URL("../locales/en.json", import.meta.url), "utf8"));
  const zh = JSON.parse(await readFile(new URL("../locales/zh-CN.json", import.meta.url), "utf8"));
  assert.deepEqual(Object.keys(en).sort(), Object.keys(zh).sort());
});
