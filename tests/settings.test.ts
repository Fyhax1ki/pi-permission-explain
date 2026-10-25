import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import type { ExtensionUIContext, KeybindingsManager, Theme } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import { ConfigStore, DEFAULT_CONFIG } from "../src/config.ts";
import { openSettings } from "../src/ui/settings-panel.ts";
import { context, model, registry, relayReasoner, strictMock, temporary } from "./helpers.ts";

test("real Pi Input/SelectList model search saves only extension reference without model inference", async (t) => {
  const a = model("org/one", "provider-a"); const b = model("org/two", "provider-b");
  const reg = registry([a, b]); const ctx = context(reg, a);
  const path = join(await temporary(t), "permission-explain.json");
  const store = new ConfigStore(path);
  const screens = [
    ["\x1b[B", "\x1b[B", "\r"],
    [..."provider-b", "\r"],
    ["\x1b"],
  ];
  let screen = 0; const notifications: string[] = [];
  const custom: ExtensionUIContext["custom"] = (factory) => new Promise((done, reject) => {
    const tui = strictMock<TUI>({ terminal: { rows: 40 } as TUI["terminal"], requestRender: () => undefined });
    const theme = strictMock<Theme>({ fg: (_color, text) => text });
    Promise.resolve(factory(tui, theme, strictMock<KeybindingsManager>({}), done)).then((component) => {
      const keys = screens[screen++];
      assert.ok(keys, "unexpected settings screen");
      for (const key of keys) component.handleInput?.(key);
      component.dispose?.();
    }).catch(reject);
  });
  ctx.ui = strictMock<ExtensionUIContext>({ custom, notify: (message) => { notifications.push(message); } });
  await openSettings(ctx, store, new AbortController().signal);
  assert.equal(screen, 3);
  assert.deepEqual(store.current?.explanationModel, { provider: "provider-b", modelId: "org/two" });
  assert.equal(ctx.model, a);
  assert.equal(notifications.length, 1);
  assert.deepEqual(JSON.parse(await readFile(path, "utf8")).explanationModel, { provider: "provider-b", modelId: "org/two" });
});

test("explicit none settings require confirmation, bind one model and never change the main model", async (t) => {
  for (const [metadataDeclines, accepted] of [[false, false], [false, true], [true, false], [true, true]] as const) {
    const target = metadataDeclines ? relayReasoner() : model("qoder/dfmodel", "magpie");
    const ctx = context(registry([target]), target);
    const path = join(await temporary(t), "permission-explain.json");
    const store = new ConfigStore(path);
    const screens = [
      ["\x1b[B", "\x1b[B", "\x1b[B", "\x1b[B", "\r"],
      ["\r"],
      [...Array(metadataDeclines ? 3 : 1).fill("\x1b[B"), "\r"],
      ["\x1b"],
    ];
    let screen = 0; let confirmations = 0;
    const custom: ExtensionUIContext["custom"] = (factory) => new Promise((done, reject) => {
      const tui = strictMock<TUI>({ terminal: { rows: 40 } as TUI["terminal"], requestRender: () => undefined });
      const theme = strictMock<Theme>({ fg: (_color, text) => text });
      Promise.resolve(factory(tui, theme, strictMock<KeybindingsManager>({}), done)).then((component) => {
        const keys = screens[screen++];
        assert.ok(keys, "unexpected settings screen");
        for (const key of keys) component.handleInput?.(key);
        component.dispose?.();
      }).catch(reject);
    });
    ctx.ui = strictMock<ExtensionUIContext>({ custom, notify: () => undefined, confirm: async (_title, text) => {
      confirmations++;
      assert.match(text, /qoder\/dfmodel \[magpie\]/);
      assert.match(text, /reasoning_effort=none/);
      assert.ok(text.includes(`thinkingLevelMap.off=${metadataDeclines ? "null" : "unset"}`));
      if (metadataDeclines) assert.match(text, /metadata marks|本地元数据将/);
      return accepted;
    } });
    await openSettings(ctx, store, new AbortController().signal);
    assert.equal(screen, 4); assert.equal(confirmations, 1);
    assert.equal(ctx.model, target);
    assert.equal(store.current?.reasoning, "off");
    assert.equal(store.current?.explanationModel, null);
    if (accepted) {
      const expected = { provider: "magpie", modelId: "qoder/dfmodel", mode: "reasoning-effort-none" };
      assert.deepEqual(store.current?.reasoningOffOverride, expected);
      assert.deepEqual(JSON.parse(await readFile(path, "utf8")).reasoningOffOverride, expected);
      await store.save({ ...DEFAULT_CONFIG, reasoning: "low" });
      assert.equal(store.current?.reasoningOffOverride, null);
    } else {
      assert.equal(store.current?.reasoningOffOverride, null);
      await assert.rejects(readFile(path), { code: "ENOENT" });
    }
  }
});

test("native settings expose low/high/max, clamp old off and clear an explicit-none experiment", async (t) => {
  for (const experiment of [false, true]) {
    const target = relayReasoner();
    const ctx = context(registry([target]), target);
    const store = new ConfigStore(join(await temporary(t), "permission-explain.json"));
    await store.save({ ...DEFAULT_CONFIG, reasoningOffOverride: experiment
      ? { provider: target.provider, modelId: target.id, mode: "reasoning-effort-none" } : null });
    const screens = [
      ["\x1b[B", "\x1b[B", "\x1b[B", "\x1b[B", "\r"],
      ["\r"],
      [...Array(experiment ? 3 : 0).fill("\x1b[A"), "\r"],
      ["\x1b"],
    ];
    let screen = 0;
    const custom: ExtensionUIContext["custom"] = (factory) => new Promise((done, reject) => {
      const tui = strictMock<TUI>({ terminal: { rows: 40 } as TUI["terminal"], requestRender: () => undefined });
      const theme = strictMock<Theme>({ fg: (_color, text) => text });
      Promise.resolve(factory(tui, theme, strictMock<KeybindingsManager>({}), done)).then((component) => {
        if (screen === 2) {
          const text = component.render(160).join("\n");
          for (const level of ["low", "high", "max"]) assert.ok(text.includes(level));
          assert.doesNotMatch(text, /off[ （(]+Pi|minimal|medium|xhigh/);
        }
        const keys = screens[screen++];
        assert.ok(keys, "unexpected settings screen");
        for (const key of keys) component.handleInput?.(key);
        component.dispose?.();
      }).catch(reject);
    });
    ctx.ui = strictMock<ExtensionUIContext>({ custom, notify: () => undefined });
    await openSettings(ctx, store, new AbortController().signal);
    assert.equal(screen, 4);
    assert.equal(store.current?.reasoning, "low");
    assert.equal(store.current?.reasoningOffOverride, null);
    assert.equal(ctx.model, target);
    assert.equal(target.thinkingLevelMap?.off, null);
  }
});
