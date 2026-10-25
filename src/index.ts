import { join } from "node:path";
import { type ExtensionAPI, type ExtensionContext, getAgentDir } from "@earendil-works/pi-coding-agent";
import { ConfigStore } from "./config.ts";
import { ExplanationController } from "./controller.ts";
import { modelDiagnostics } from "./diagnostics.ts";
import { ShortcutInput } from "./keys.ts";
import { detectSystemLocale, type ResolvedLocale } from "./locale.ts";
import { resolveModel } from "./models.ts";
import { parseDecision, parsePrompt } from "./permissions.ts";
import { prepareExplanation, presentation } from "./runtime.ts";
import { ExplainError } from "./types.ts";
import { diagnosticsNotice } from "./ui/diagnostics.ts";
import { ExplanationNotifications } from "./ui/explanation-notifications.ts";
import { type MessageKey, translator } from "./ui/i18n.ts";
import { openSettings } from "./ui/settings-panel.ts";

interface Session {
  readonly ctx: ExtensionContext;
  readonly generation: number;
  readonly abort: AbortController;
  readonly controller: ExplanationController;
  readonly notifications: ExplanationNotifications;
  readonly subscriptions: (() => void)[];
  system: ResolvedLocale;
  settingsOpen: boolean;
}

/** Observation only: this extension has no permission decision or command execution capability. */
export default function permissionExplain(pi: ExtensionAPI): void {
  const store = new ConfigStore(join(getAgentDir(), "permission-explain.json"));
  let generation = 0;
  let session: Session | undefined;

  const notify = (ctx: ExtensionContext, key: MessageKey, locale = "en") => {
    try { ctx.ui.notify(translator(locale)(key), "warning"); } catch { /* Isolate optional UI failures. */ }
  };

  const cleanup = () => {
    const previous = session;
    session = undefined;
    generation++;
    if (!previous) return;
    previous.abort.abort();
    previous.controller.reset();
    previous.notifications.dispose();
    for (const unsubscribe of previous.subscriptions) {
      try { unsubscribe(); } catch { /* Continue releasing the remaining subscriptions. */ }
    }
  };

  pi.on("session_start", async (_event, ctx) => {
    cleanup();
    if (ctx.mode !== "tui") return;
    const currentGeneration = generation;
    await store.reload();
    if (generation !== currentGeneration) return;
    const system = detectSystemLocale();
    const abort = new AbortController();
    const notifications = new ExplanationNotifications(ctx.ui);
    const controller = new ExplanationController(
      (prompt) => prepareExplanation(prompt, ctx, store, session?.system ?? system, abort.signal),
      (view) => notifications.update(view),
    );
    const active: Session = { ctx, generation, abort, controller, notifications, system, subscriptions: [], settingsOpen: false };
    session = active;
    if (store.error) notify(ctx, "configInvalid", system.tag);
    const keys = new ShortcutInput();
    active.subscriptions.push(
      pi.events.on("permissions:ui_prompt", (payload: unknown) => {
        if (session !== active) return;
        try {
          const prompt = parsePrompt(payload, active.generation);
          if (!prompt) { controller.clear(); notify(ctx, "unsupported", active.system.tag); return; }
          const config = store.current;
          if (!config?.enabled) { controller.clear(); return; }
          controller.show(prompt, presentation(config, ctx, active.system));
        } catch { controller.clear(); notify(ctx, "unsupported", active.system.tag); }
      }),
      pi.events.on("permissions:decision", (payload: unknown) => {
        if (session !== active) return;
        try { const id = parseDecision(payload); if (id) controller.decide(id); }
        catch { /* Malformed broadcasts cannot adjudicate or crash an approval. */ }
      }),
      ctx.ui.onTerminalInput((data) => {
        const config = store.current;
        if (!keys.matches(data, config?.shortcut ?? "", session === active && config?.enabled === true && controller.canExplain && !active.settingsOpen)) return;
        void controller.trigger().catch(() => notify(ctx, "requestFailed", active.system.tag));
        return { consume: true };
      }),
    );
  });

  pi.on("session_shutdown", cleanup);
  pi.on("session_before_switch", () => session?.controller.reset());
  pi.on("session_before_fork", () => session?.controller.reset());
  pi.on("session_before_tree", () => session?.controller.reset());

  pi.registerCommand("permission-explain-settings", {
    description: "Configure on-demand permission explanations (model, language, shortcut and budgets)",
    handler: async (_args, ctx) => {
      if (ctx.mode !== "tui") { notify(ctx, "tuiOnly"); return; }
      const active = session;
      if (!active || active.settingsOpen) return;
      if (active.controller.state.phase !== "idle") { notify(ctx, "busy", active.system.tag); return; }
      active.settingsOpen = true;
      try { await openSettings(ctx, store, active.abort.signal); }
      catch (error) { notify(ctx, error instanceof ExplainError ? error.code : "configSaveFailed", active.system.tag); }
      finally { active.settingsOpen = false; active.system = detectSystemLocale(); }
    },
  });

  pi.registerCommand("permission-explain-diagnostics", {
    description: "Show last explanation timings and safe model metadata without making a request",
    handler: async (_args, ctx) => {
      if (ctx.mode !== "tui") { notify(ctx, "tuiOnly"); return; }
      const active = session;
      if (!active) return;
      try {
        const config = await store.reload();
        if (session !== active) return;
        const trace = active.controller.diagnostics;
        const selected = !trace && config
          ? modelDiagnostics(resolveModel(ctx.modelRegistry, config.explanationModel, ctx.model), config)
          : undefined;
        ctx.ui.notify(diagnosticsNotice(trace, selected, translator(active.system.tag)), "info");
      } catch (error) {
        notify(ctx, error instanceof ExplainError ? error.code : "requestFailed", active.system.tag);
      }
    },
  });
}
