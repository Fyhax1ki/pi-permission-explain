import type { ModelDiagnostics, RequestDiagnostics } from "../diagnostics.ts";
import { singleLine } from "./display.ts";
import type { Translate } from "./i18n.ts";

/** Formatting diagnostics never issues a request or includes command/provider response text. */
export function diagnosticsNotice(trace: RequestDiagnostics | undefined, selected: ModelDiagnostics | undefined, t: Translate): string {
  const lines = [t("diagnosticsTitle")];
  const model = trace?.model ?? selected;
  if (model) {
    lines.push(
      `${t("model")}: ${singleLine(model.modelId)} [${singleLine(model.provider)}] (${model.selection})`,
      `API: ${singleLine(model.api)} | ${t("endpointOrigin")}: ${singleLine(model.origin)}`,
      `${t("reasoning")}: ${model.reasoning} | ${t("maxOutputTokens")}: ${model.maxOutputTokens} | ${t("timeoutMs")}: ${model.timeoutMs}`,
      `${t("effectiveReasoning")}: ${model.effectiveReasoning} | ${t("supportedReasoning")}: ${model.supportedReasoning || "-"}`,
      `${t("reasoningMapping")}: ${model.reasoningMapping}`,
      `${t("reasoningMetadata")}: ${model.reasoningMetadata}`,
    );
  }
  if (!trace) return [...lines, t("noDiagnostics")].join("\n");
  const time = (ms: number | undefined) => ms === undefined ? "-" : `${ms.toFixed(1)} ms`;
  lines.push(
    `${t("startedAt")}: ${trace.startedAt}`,
    `${t("diagnosticState")}: ${trace.phase}${trace.error ? ` (${trace.error})` : ""}`,
    `${t("localPreparation")}: ${time(trace.preparationMs)} | ${t("totalTime")}: ${time(trace.totalMs)}`,
    `${t("requestTime")}: ${time(trace.requestMs)} | ${t("payloadReady")}: ${time(trace.payloadMs)}`,
    `${t("firstResponse")}: ${time(trace.responseMs)} | ${t("firstThinking")}: ${time(trace.firstThinkingMs)}`,
    `${t("firstText")}: ${time(trace.firstTextMs)} | ${t("generationTime")}: ${time(trace.generationMs)}`,
    `${t("displayTime")}: ${time(trace.displayMs)} | HTTP: ${trace.responseStatus ?? "-"}`,
    `${t("preparedPayloads")}: ${trace.payloadsPrepared} | ${t("reasoningOnWire")}: ${singleLine(trace.reasoningOnWire ?? "-")}`,
  );
  if (trace.usage) lines.push(`${t("usage")}: ${trace.usage.input}/${trace.usage.output}/${trace.usage.reasoning}`);
  return lines.join("\n");
}
