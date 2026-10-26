import type { ExtensionUIContext, Theme } from "@earendil-works/pi-coding-agent";
import type { ExplanationView } from "../types.ts";
import { plainProse, singleLine } from "./display.ts";
import { translator } from "./i18n.ts";

export const STATUS_ID = "permission-explain";

export function explanationNotice(view: Extract<ExplanationView, { phase: "done" }>, theme?: Theme): string {
  const t = translator(view.presentation.language);
  const result = view.result;
  const title = `${t("title")} | ${singleLine(result.modelId)} [${singleLine(result.provider)}]`;
  const lines = [
    theme ? theme.bold(title) : title,
    "",
    plainProse(result.text),
    ...(result.truncated ? [t("truncated")] : []),
  ].join("\n");
  // Pi wraps info notifications in dim; clear faint before applying trusted theme styles.
  return theme ? `\x1b[22m${theme.fg("accent", lines)}\x1b[22m` : lines;
}

/** Use Pi's notification area, never the permission dialog or its adjacent widget slots. */
export class ExplanationNotifications {
  private previous: ExplanationView = { phase: "idle" };
  private status: string | undefined;
  private readonly ui: ExtensionUIContext;

  constructor(ui: ExtensionUIContext) { this.ui = ui; }

  update(view: ExplanationView): void {
    const previous = this.previous;
    this.previous = view;
    let status: string | undefined;
    if (view.phase !== "idle") {
      const t = translator(view.presentation.language);
      const p = view.presentation;
      if (view.phase === "ready" || view.phase === "loading") {
        status = singleLine(`${p.shortcut}: ${t(view.phase === "loading" ? "loading" : "explain")} | ${p.modelLabel} | ${p.language}`, 800);
      } else if (view.phase === "unsupported") {
        status = t("unsupported");
      }
    }
    this.setStatus(status);
    try {
      if (view.phase === "done") {
        if (previous.phase !== "done" || previous.prompt !== view.prompt || previous.result !== view.result) {
          let notice = explanationNotice(view);
          try { notice = explanationNotice(view, this.ui.theme); }
          catch { /* A missing or faulty theme must not hide the explanation. */ }
          this.ui.notify(notice, "info");
        }
      } else if (view.phase === "failed") {
        if (previous.phase !== "failed" || previous.prompt !== view.prompt || previous.error !== view.error) {
          const t = translator(view.presentation.language);
          this.ui.notify(`${t("title")}: ${t(view.error)}`, "warning");
        }
      }
    } catch { /* Optional Pi notifications cannot affect permission handling. */ }
  }

  private setStatus(status: string | undefined): void {
    if (this.status === status) return;
    this.status = status;
    try { this.ui.setStatus(STATUS_ID, status); } catch { /* Keep approval independent of rendering. */ }
  }

  dispose(): void {
    this.setStatus(undefined);
    this.previous = { phase: "idle" };
  }
}
