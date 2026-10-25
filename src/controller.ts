import { ExplanationCache } from "./cache.ts";
import { type ModelDiagnostics, type RequestDiagnostics, type RequestProgress, RequestTrace } from "./diagnostics.ts";
import { abortable } from "./models.ts";
import { type CacheOptions, ExplainError, type ExplanationResult, type ExplanationView, type ModelReference, type Presentation, type PromptSnapshot } from "./types.ts";

export interface PreparedExplanation {
  readonly presentation: Presentation;
  readonly cacheKey: string | undefined;
  readonly cacheIdentity?: ModelReference;
  readonly cache: CacheOptions;
  readonly timeoutMs: number;
  readonly parentSignal?: AbortSignal;
  readonly diagnostics?: ModelDiagnostics;
  run(signal: AbortSignal, onText: (text: string) => void, onProgress?: (event: RequestProgress) => void): Promise<ExplanationResult>;
}

interface Attempt {
  readonly id: number;
  readonly prompt: PromptSnapshot;
  readonly abort: AbortController;
  readonly trace: RequestTrace;
}

export class ExplanationController {
  private view: ExplanationView = { phase: "idle" };
  private attempt: Attempt | undefined;
  private sequence = 0;
  private readonly prepare: (prompt: PromptSnapshot) => Promise<PreparedExplanation>;
  private readonly render: (view: ExplanationView) => void;
  private readonly cache: ExplanationCache;
  private trace: RequestTrace | undefined;

  constructor(prepare: (prompt: PromptSnapshot) => Promise<PreparedExplanation>, render: (view: ExplanationView) => void, cache = new ExplanationCache()) {
    this.prepare = prepare; this.render = render; this.cache = cache;
  }

  get state(): ExplanationView { return this.view; }
  get diagnostics(): RequestDiagnostics | undefined { return this.trace?.snapshot(); }
  get canExplain(): boolean { return this.view.phase !== "idle" && this.view.phase !== "unsupported"; }

  private publish(view: ExplanationView): void {
    this.view = view;
    try { this.render(view); } catch { /* Auxiliary UI must never break permission handling. */ }
  }

  show(prompt: PromptSnapshot, presentation: Presentation): void {
    if (this.view.phase !== "idle" && this.view.prompt.requestId === prompt.requestId && this.view.prompt.sessionGeneration === prompt.sessionGeneration) return;
    this.cancel();
    this.publish({ phase: prompt.scope === "insufficient" ? "unsupported" : "ready", prompt, presentation });
  }

  decide(requestId: string): void {
    if (this.view.phase !== "idle" && this.view.prompt.requestId === requestId) this.clear();
  }

  private cancel(): void {
    const attempt = this.attempt;
    this.attempt = undefined;
    if (attempt) attempt.trace.finish("cancelled");
    attempt?.abort.abort();
  }

  clear(): void { this.cancel(); this.publish({ phase: "idle" }); }
  reset(): void { this.clear(); this.cache.clear(); this.trace = undefined; }

  private valid(attempt: Attempt): boolean {
    return this.attempt === attempt && this.view.phase !== "idle" && this.view.prompt === attempt.prompt;
  }

  /** Set loading synchronously, before config IO, so repeated input cannot start two requests. */
  async trigger(): Promise<void> {
    const view = this.view;
    if (view.phase === "idle" || view.phase === "unsupported" || view.phase === "loading" || view.phase === "done") return;
    const trace = new RequestTrace();
    this.trace = trace;
    const attempt: Attempt = { id: ++this.sequence, prompt: view.prompt, abort: new AbortController(), trace };
    this.attempt = attempt;
    this.publish({ ...view, phase: "loading", text: "" });
    let timer: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    let detachParent: (() => void) | undefined;
    let presentation = view.presentation;
    try {
      const prepared = await abortable(this.prepare(view.prompt), attempt.abort.signal);
      if (!this.valid(attempt)) return;
      trace.prepared(prepared.diagnostics);
      presentation = prepared.presentation;
      if (prepared.parentSignal) {
        const onAbort = () => this.clear();
        prepared.parentSignal.addEventListener("abort", onAbort, { once: true });
        detachParent = () => prepared.parentSignal?.removeEventListener("abort", onAbort);
        if (prepared.parentSignal.aborted) { this.clear(); return; }
      }
      this.publish({ phase: "loading", prompt: view.prompt, presentation, text: "" });
      const cached = prepared.cacheKey ? this.cache.get(prepared.cacheKey, prepared.cache) : undefined;
      if (cached) {
        trace.finish("cache-hit");
        this.publishFinished({ phase: "done", prompt: view.prompt, presentation, result: cached, cached: true }, trace);
        return;
      }
      timer = setTimeout(() => { timedOut = true; attempt.abort.abort(); }, prepared.timeoutMs);
      trace.startRequest();
      const result = await abortable(prepared.run(attempt.abort.signal, (text) => {
        if (this.valid(attempt) && !attempt.abort.signal.aborted) {
          if (text) trace.text();
          this.publish({ phase: "loading", prompt: view.prompt, presentation, text });
        }
      }, (event) => {
        if (this.valid(attempt) && !attempt.abort.signal.aborted) trace.progress(event);
      }), attempt.abort.signal);
      if (!this.valid(attempt) || attempt.abort.signal.aborted) return;
      if (!result.text.trim()) throw new ExplainError("emptyOutput");
      const identity = prepared.cacheIdentity;
      const sameModel = !identity || (result.provider === identity.provider && result.modelId === identity.modelId);
      if (prepared.cacheKey && sameModel) this.cache.set(prepared.cacheKey, result, prepared.cache);
      trace.finish("done", undefined, result.usage);
      this.publishFinished({ phase: "done", prompt: view.prompt, presentation, result, cached: false }, trace);
    } catch (error) {
      if (this.valid(attempt)) {
        const code = timedOut ? "timeout" : error instanceof ExplainError ? error.code : "requestFailed";
        trace.finish("failed", code);
        this.publishFinished({ phase: "failed", prompt: view.prompt, presentation, error: code }, trace);
      }
    } finally {
      if (timer) clearTimeout(timer);
      detachParent?.();
      if (this.attempt === attempt) this.attempt = undefined;
    }
  }

  private publishFinished(view: ExplanationView, trace: RequestTrace): void {
    const start = performance.now();
    this.publish(view);
    trace.displayed(performance.now() - start);
  }
}
