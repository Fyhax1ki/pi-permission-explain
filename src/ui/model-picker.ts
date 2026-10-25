import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Input, isKeyRelease, type KeyId, matchesKey, SelectList, type SelectListTheme, truncateToWidth } from "@earendil-works/pi-tui";
import { availableModels, CURRENT_MODEL, isRouted } from "../models.ts";
import type { ModelReference } from "../types.ts";
import { singleLine } from "./display.ts";
import type { Translate } from "./i18n.ts";

export interface Choice {
  readonly value: string;
  readonly label: string;
  readonly description?: string;
  readonly disabled?: boolean;
}

export function filterChoices(choices: readonly Choice[], query: string): Choice[] {
  const needle = query.toLocaleLowerCase();
  return choices.filter((choice) => `${choice.label} ${choice.description ?? ""} ${choice.value}`.toLocaleLowerCase().includes(needle));
}

/** Search and selection use stable values, never translated labels. */
export async function pickChoice(
  ctx: ExtensionContext, title: string, choices: readonly Choice[], t: Translate,
  options: { searchable?: boolean; hint?: string; selected?: string; signal?: AbortSignal } = {},
): Promise<string | undefined> {
  if (options.signal?.aborted) return undefined;
  return ctx.ui.custom<string | undefined>((tui, theme, _keys, done) => {
    const search = new Input({ prompt: `${t("search")}: ` });
    const listTheme: SelectListTheme = {
      selectedPrefix: (text) => theme.fg("accent", text),
      selectedText: (text) => theme.fg("accent", text),
      description: (text) => theme.fg("muted", text),
      scrollInfo: (text) => theme.fg("dim", text),
      noMatch: () => t("noMatches"),
    };
    const buildList = (filtered: readonly Choice[]) => {
      const list = new SelectList(filtered.map((choice) => ({
        value: choice.value,
        label: singleLine(choice.label, 500),
        description: singleLine(choice.description ?? "", 500),
      })), Math.max(3, Math.min(10, tui.terminal.rows - 8)), listTheme);
      list.onSelect = (item) => { if (!filtered.find((choice) => choice.value === item.value)?.disabled) done(item.value); };
      list.onCancel = () => done(undefined);
      return list;
    };
    let list = buildList(choices);
    if (options.selected) list.setSelectedIndex(Math.max(0, choices.findIndex((choice) => choice.value === options.selected)));
    const abort = () => done(undefined);
    options.signal?.addEventListener("abort", abort, { once: true });
    return {
      get focused() { return search.focused; },
      set focused(value: boolean) { search.focused = value; },
      render(width: number) {
        if (width < 1) return [];
        return [
          theme.fg("accent", truncateToWidth(title, width, "")),
          ...(options.searchable ? search.render(width) : []),
          ...list.render(width),
          ...(options.hint ? [theme.fg("muted", truncateToWidth(options.hint, width, ""))] : []),
          theme.fg("dim", truncateToWidth(t("navigation"), width, "")),
        ].map((line) => truncateToWidth(line, width, ""));
      },
      handleInput(data: string) {
        if (isKeyRelease(data)) return;
        const navigation: KeyId[] = ["escape", "enter", "up", "down", "pageUp", "pageDown"];
        if (navigation.some((key) => matchesKey(data, key))) list.handleInput(data);
        else if (options.searchable) {
          search.handleInput(data);
          const query = search.getValue().slice(0, 200);
          search.setValue(query);
          list = buildList(filterChoices(choices, query));
        }
        tui.requestRender();
      },
      invalidate() { list.invalidate(); search.invalidate(); },
      dispose() { options.signal?.removeEventListener("abort", abort); },
    };
  });
}

export async function pickModel(ctx: ExtensionContext, saved: ModelReference | null, t: Translate, signal?: AbortSignal): Promise<ModelReference | null | undefined> {
  const models = availableModels(ctx.modelRegistry);
  const valueOf = (provider: string, id: string) => JSON.stringify([provider, id]);
  const choices: Choice[] = [
    { value: CURRENT_MODEL, label: t("current") },
    ...models.map((model) => ({ value: valueOf(model.provider, model.id), label: `${model.name} (${model.id}) [${model.provider}]`, description: isRouted(model) ? t("routed") : undefined })),
  ];
  const selected = saved ? valueOf(saved.provider, saved.modelId) : CURRENT_MODEL;
  if (saved && !choices.some((choice) => choice.value === selected)) choices.push({
    value: selected, label: `${saved.modelId} [${saved.provider}]`, description: t("unavailable"), disabled: true,
  });
  const value = await pickChoice(ctx, t("model"), choices, t, { searchable: true, hint: t("modelHint"), selected, signal });
  if (value === CURRENT_MODEL) return null;
  const model = models.find((item) => valueOf(item.provider, item.id) === value);
  return model ? { provider: model.provider, modelId: model.id } : undefined;
}
