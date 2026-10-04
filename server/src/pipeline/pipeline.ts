import type { NodeEntity, AskEvent, AskRequest } from "@canvas-learn/shared";
import type { ModelRouter } from "../llm/router.js";
import type { NodeRepo } from "../db/repos.js";
import {
  STAGE1_SYSTEM,
  stage1Prompt,
  STAGE2_SYSTEM,
  stage2Prompt,
  STAGE3_SYSTEM,
  stage3Prompt,
  SUMMARY_SYSTEM,
  summaryPrompt,
  SECTIONS_SYSTEM,
  sectionsPrompt,
  profileDirectives,
  explainLikeDirective,
  materialGrounding,
  buildContextBlurb,
  modeDirective,
  whyDirective,
  socraticDirective,
  sourceLabelingDirective,
  GAPS_SYSTEM,
  gapsPrompt,
  PROVENANCE_SYSTEM,
  provenancePrompt,
} from "./prompts.js";
import type { LearningProfile } from "@canvas-learn/shared";
import { parseVisualSpec } from "@canvas-learn/shared";
import { extractJsonLenient } from "../llm/router.js";
import { webSearch, formatSnippetsForPrompt } from "./webSearch.js";
import { deriveCanvasTitle } from "../db/canvasTitles.js";

export interface PipelineDeps {
  router: ModelRouter;
  nodes: NodeRepo;
}

const MAX_CHAIN_SUMMARY_TRIGGER = 5; // summarize chains longer than this (PRD §6.3)

/**
 * Decide + generate a visual spec for a Q&A (stage 3 logic, reusable — spec §5).
 * Retry-once per PRD §4.2. `forceType` pins the type (compare → comparison_table).
 *
 * Contract (changed for honest error surfacing): a "none" block is returned ONLY
 * when a model actually answered and judged that no visual fits. Provider/network
 * failures and unparseable model output THROW with an actionable message so
 * callers can report a real error + offer a retry — a swallowed failure used to
 * surface as "no visual fit this content", which is false when the model never
 * responded at all.
 */
export async function generateVisual(
  question: string,
  answer: string,
  speed: "fast" | "quality",
  abort: AbortSignal,
  router: ModelRouter,
  forceType?: "comparison_table",
  /** Called before the stricter retry attempt so callers can stream status updates. */
  onRetry?: () => void,
): Promise<{ type: "none"; status: "ready"; spec: null } | NonNullable<ReturnType<typeof parseVisualSpec>["block"]>> {
  let sawModelResponse = false;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (abort.aborted) throw new Error("Visual generation was cancelled");
    if (attempt === 1) onRetry?.();
    try {
      const hint = forceType ? ` The user explicitly asked to compare — prefer type "comparison_table".` : "";
      const r = await router.generateWithFailover(speed, {
        system: STAGE3_SYSTEM,
        prompt:
          stage3Prompt(question, answer) +
          hint +
          (attempt === 1 ? "\n\nIMPORTANT: Output ONLY the JSON object. Every field must match the schema exactly." : ""),
        temperature: attempt === 0 ? 0.2 : 0.1,
        maxTokens: 700,
        json: true,
        abort,
      });
      sawModelResponse = true;
      // Lenient extraction (same repair path as every other structured call):
      // survives chatty preamble and output truncated mid-object.
      const jsonText = extractJsonLenient(r.text);
      if (!jsonText) throw new Error("model output contained no JSON object");
      const parsed = parseVisualSpec(normalizeVisualPayload(JSON.parse(jsonText)));
      if (parsed.ok && parsed.block) return parsed.block;
      // Model answered but the output didn't validate — log for diagnosis,
      // retry once with the stricter prompt, then report the real failure.
      console.error(`[visual] rejected model output (attempt ${attempt + 1}): ${r.text.slice(0, 400)}`);
      throw new Error("visual spec validation failed");
    } catch (err) {
      if (abort.aborted) throw new Error("Visual generation was cancelled");
      // provider/network/parse failure on this attempt — retry once, then report
      void err;
    }
  }
  if (!sawModelResponse) {
    throw new Error(
      "Visual generation failed: no model responded — check that Ollama is running (Settings → Backend), then try again.",
    );
  }
  throw new Error("Visual generation failed: the model's output couldn't be read as a valid visual — try again.");
}

const DIAGRAM_VISUAL_TYPES = new Set(["cycle_diagram", "flowchart", "timeline"]);

/**
 * Deterministic shape repair for flattened model output. The schema is
 * {type, spec:{...}}, but local models observed in the wild (gemma3:4b,
 * 2026-10-03 live probe) answer with the spec's fields FLATTENED at the top
 * level — e.g. {"type":"cycle_diagram","mermaid":"flowchart LR..."} instead of
 * {"type":"cycle_diagram","spec":{"mermaid":"..."}} — which parseVisualSpec
 * rejects, making on-demand visual generation fail for every answer. This
 * moves the model's OWN values into the schema shape (one level of unwrapping
 * plus flattening repair); it never invents content.
 */
export function normalizeVisualPayload(raw: unknown): unknown {
  const o = unwrapVisualPayload(raw);
  if (typeof o !== "object" || o === null) return o;
  const obj = o as Record<string, unknown>;
  if (obj.spec != null) return obj; // already nested — parser coercions take over
  const t = obj.type;
  if (typeof t === "string" && DIAGRAM_VISUAL_TYPES.has(t)) {
    const m = obj.mermaid ?? obj.code ?? obj.diagram ?? obj.source;
    if (typeof m === "string" && m.trim()) return { ...obj, spec: { mermaid: m } };
  }
  if (t === "chart" && (Array.isArray(obj.labels) || Array.isArray(obj.values))) {
    return { ...obj, spec: { chart_type: obj.chart_type ?? "donut", labels: obj.labels ?? [], values: obj.values ?? [] } };
  }
  if (t === "comparison_table" && (Array.isArray(obj.headers) || Array.isArray(obj.rows))) {
    return { ...obj, spec: { headers: obj.headers ?? [], rows: obj.rows ?? [] } };
  }
  if (t === "interactive_sim" && (typeof obj.sim === "string" || Array.isArray(obj.params))) {
    return { ...obj, spec: { sim: obj.sim, params: obj.params ?? [], ...(typeof obj.title === "string" ? { title: obj.title } : {}) } };
  }
  return obj;
}

/**
 * Tolerate one level of wrapping around the visual payload. The schema is a
 * top-level {type, spec} object, but models sometimes answer
 * {"visual": {type, spec}} / {"result": ...} / {"data": ...}. Descend into the
 * first wrapped object that itself carries a string `type`. Never invents data:
 * if no such wrapper exists the payload is returned unchanged (and validation
 * rejects it as before).
 */
function unwrapVisualPayload(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null) return raw;
  const o = raw as Record<string, unknown>;
  if (typeof o.type === "string") return o; // already shaped
  for (const key of ["visual", "result", "data", "output", "spec"]) {
    const inner = o[key];
    if (typeof inner === "object" && inner !== null && typeof (inner as Record<string, unknown>).type === "string") {
      return inner;
    }
  }
  return o;
}

export interface PipelineCall {
  request: AskRequest;
  abort: AbortSignal;
  /** Canvas-level personalization; AskRequest.profile wins when both exist. */
  profile?: LearningProfile;
  /** Resolved content of req.material_id (loaded by the route), when present. */
  material?: { title: string; content: string };
  /**
   * Fired the moment the answer settles (stage 2), with the final node title —
   * BEFORE the non-fatal enhancement calls (gaps/sections/visual) that can take
   * minutes on local models. The route uses this to title the conversation fast.
   */
  onAnswerSettled?: (nodeId: string, title: string, question: string) => void;
}

/**
 * Run the staged pipeline for one node, emitting AskEvents to the SSE channel.
 * - Stage 1: streamed answer with [[term]] markup
 * - Stage 2: title/followups/tags (small JSON call)
 * - Stage 3: async visual with status events and retry-then-none fallback
 * Also generates per-node context summaries for long chains.
 */
export async function runPipeline(
  node: NodeEntity,
  chain: NodeEntity[],
  call: PipelineCall,
  deps: PipelineDeps,
  emit: (e: AskEvent) => void,
): Promise<void> {
  const { router, nodes } = deps;
  const req = call.request;
  const abort = call.abort;
  const speed = req.model_speed === "quality" ? "quality" : "fast";
  let usedProvider = "";
  let usedModel = "";

  try {
    // ---- context (selection, material, profile — all genuinely change the prompt) ----
    const profile = req.profile ?? call.profile;
    const selectionContext = req.context_text?.trim()
      ? `The user selected this passage while reading — the question is about it:\n"""${req.context_text.trim().slice(0, 1200)}"""`
      : null;
    const blurb = [
      selectionContext,
      call.material ? materialGrounding(call.material.content, call.material.title) : null,
      buildContextBlurb(chain),
    ]
      .filter(Boolean)
      .join("\n\n");

    // why-chain (thinking-spec §5): depth = number of ancestor nodes in this why trail
    // (a bare "Why?" question also continues the trail)
    const q = req.question.trim().toLowerCase();
    const whyDepth = q === "why?" || q === "why" ? chain.length : 0;

    // ---- stage 1: streamed answer ----
    let snippets: Awaited<ReturnType<typeof webSearch>> = [];
    let webPrompt = "";
    if (req.web_search) {
      try {
        snippets = await webSearch(req.question);
        webPrompt = formatSnippetsForPrompt(snippets);
      } catch {
        // offline / blocked → degrade silently, record web_search_used=false
      }
    }
    // Socratic mode (research-spec §6): count how many ancestor turns were socratic
    // so the tutor escalates its questioning instead of repeating itself.
    const socraticStep = req.mode === "socratic" ? chain.filter((c) => c.mode === "socratic").length + 1 : 0;

    const prompt1 = [
      webPrompt,
      profileDirectives(profile),
      explainLikeDirective(req.explain_like),
      modeDirective(req.mode === "socratic" ? undefined : req.mode),
      socraticStep > 0 ? socraticDirective(socraticStep) : "",
      req.mode === "research" || req.web_search ? sourceLabelingDirective(snippets.length > 0) : "",
      whyDepth > 0 ? whyDirective(whyDepth) : "",
      stage1Prompt(node.question, blurb),
    ]
      .filter(Boolean)
      .join("\n\n");

    let answer = "";
    const result1 = await router.generateWithFailover(
      speed,
      {
        system: STAGE1_SYSTEM,
        prompt: prompt1,
        temperature: 0.7,
        maxTokens: 400,
        abort,
      },
      (chunk) => {
        answer += chunk;
        emit({ type: "delta", node_id: node.id, text: chunk });
      },
      () => {
        // failover: previous candidate may have streamed partial tokens — clear and restart
        answer = "";
        emit({ type: "reset", node_id: node.id });
      },
    );
    usedProvider = result1.provider;
    usedModel = result1.model;
    answer = result1.text.trim();
    // Defense in depth: every candidate now fails on empty completions at the
    // provider/router level, but if ALL candidates somehow return empty we must
    // not mark the node "complete" with nothing — surface a real error state.
    if (!answer) {
      throw new Error("The model returned an empty response. Please try regenerating.");
    }
    const webUsed = req.web_search && snippets.length > 0;

    // Extract key terms from [[...]] markers (PRD FR11)
    const keyTerms = [...answer.matchAll(/\[\[([^\]]+)\]\]/g)]
      .map((m) => m[1])
      .filter((t): t is string => typeof t === "string")
      .slice(0, 4);

    // ---- stage 2: title / followups / tags (parallel-friendly; small JSON call) ----
    let title = "";
    let followups: string[] = [];
    let tags: string[] = [];
    try {
      const meta = (await router.generateJson(speed, {
        system: STAGE2_SYSTEM,
        prompt: stage2Prompt(node.question, answer),
        temperature: 0.4,
        maxTokens: 300,
        abort,
      })) as { title?: string; followups?: string[]; tags?: string[] };
      title = (meta.title ?? "").slice(0, 60);
      followups = (meta.followups ?? []).filter((s) => typeof s === "string").slice(0, 4);
      tags = (meta.tags ?? []).filter((s) => typeof s === "string").slice(0, 3);
    } catch {
      // stage-2 failure degrades gracefully: no title/followups/tags
    }
    // Fallback title: the cleaned question (instruction scaffolding removed,
    // word-boundary cap, title-cased) instead of a raw mid-word slice.
    if (!title) title = deriveCanvasTitle(node.question) || node.question.slice(0, 40);

    nodes.update(node.id, {
      status: "complete",
      answer_text: answer,
      key_terms: keyTerms,
      title,
      suggested_followups: followups,
      tags,
      model_used: `${usedProvider}:${usedModel}`,
      web_search_used: webUsed,
      // thinking-spec §2/§8: remember the mode; persist REAL retrieved sources only
      mode: req.mode ?? "",
      sources: webUsed ? snippets.map((s) => ({ title: s.title, snippet: s.snippet })) : [],
    });

    // Emit stage2 NOW, the moment the answer is settled — BEFORE the non-fatal
    // enhancement calls (gaps/sections/summary/visual) below. On slow free-tier
    // models those calls can take minutes, and the client uses stage2 as the
    // "this turn is done" signal to unlock the composer; waiting for them left
    // the UI locked long after the answer was on screen.
    emit({
      type: "stage2",
      node_id: node.id,
      title,
      followups,
      tags,
    });

    // Conversation title: notify the caller NOW (at settle), not at pipeline
    // end — the enhancements below can take minutes and must not delay naming.
    try {
      call.onAnswerSettled?.(node.id, title, node.question);
    } catch {
      // naming is best-effort; never fail the ask over it
    }

    // ---- stage 2.45: knowledge gaps (thinking-spec §19) — non-fatal, complete answers only ----
    try {
        const g = (await router.generateJson("fast", {
          system: GAPS_SYSTEM,
          prompt: gapsPrompt(node.question, buildContextBlurb(chain) || node.question),
          temperature: 0.2,
          maxTokens: 250,
          abort,
        })) as { gaps?: { label?: string; question?: string }[] };
        const gaps = (g.gaps ?? [])
          .filter((x) => x && typeof x.label === "string" && typeof x.question === "string")
          .slice(0, 3)
          .map((x) => ({ label: x.label!.slice(0, 40), question: x.question!.slice(0, 160) }));
        if (gaps.length) nodes.update(node.id, { gaps });
    } catch {
      // gaps are an enhancement — never fatal
    }

    // ---- stage 2.6: provenance audit (research-spec §1) — non-fatal ----
    // Where did this answer's claims come from? Grounded answers get classified
    // against the real material (with a verbatim supporting quote);
    // web-search-backed answers are deterministic "context"; plain tutoring
    // answers get no provenance record at all (nothing to audit).
    try {
      if (call.material) {
        const r = (await router.generateJson("fast", {
          system: PROVENANCE_SYSTEM,
          prompt: provenancePrompt(node.question, answer, call.material.title, call.material.content),
          temperature: 0.1,
          maxTokens: 200,
          abort,
        })) as { status?: string; quote?: string };
        const status = r && ["sourced", "context", "uncertain"].includes(r.status ?? "")
          ? (r.status as "sourced" | "context" | "uncertain")
          : null;
        if (status) {
          // Word-boundary truncation — a quote cut mid-word ("concentratio")
          // reads as corruption; step back to the last space, never past 60%.
          let quote = (r!.quote ?? "").trim().slice(0, 120);
          if (quote.length === 120) {
            const sp = quote.lastIndexOf(" ");
            if (sp > quote.length * 0.6) quote = quote.slice(0, sp);
          }
          nodes.update(node.id, {
            provenance: { status, quote, material_id: node.material_id },
          });
        }
      } else if (webUsed) {
        nodes.update(node.id, { provenance: { status: "context", quote: "", material_id: null } });
      }
    } catch {
      // provenance is best-effort — never fail the ask over it
    }

    // ---- stage 2.4: bite-sized sections (spec §4) — small JSON call, non-fatal ----
    // Only meaningful for a real answer: an empty answer must produce NO sections
    // (this was the source of invented "No explanation was provided" filler).
    if (answer.trim().length > 0) {
      try {
        const sec = (await router.generateJson("fast", {
          system: SECTIONS_SYSTEM,
          prompt: sectionsPrompt(node.question, answer),
          temperature: 0.3,
          maxTokens: 500,
          abort,
        })) as { sections?: { heading?: string; body?: string }[] };
        const sections = (sec.sections ?? [])
          .filter((s) => s && typeof s.heading === "string" && typeof s.body === "string")
          .slice(0, 5)
          .map((s) => ({ heading: s.heading!.slice(0, 60), body: s.body!.slice(0, 600) }));
        // Always overwrite: regeneration must replace (or clear) stale sections
        // rather than keep filler from a previous failed attempt.
        nodes.update(node.id, { sections });
      } catch {
        // sections are an enhancement — plain answer text remains the fallback
      }
    }
    // ---- stage 2.5: context summary for long chains (cached per node, PRD §6.3) ----
    if (chain.length + 1 > MAX_CHAIN_SUMMARY_TRIGGER && !node.context_summary) {
      try {
        const s = (await router.generateJson("fast", {
          system: SUMMARY_SYSTEM,
          prompt: summaryPrompt(node.question, answer),
          temperature: 0.2,
          maxTokens: 150,
          abort,
        })) as { summary?: string };
        if (s.summary) nodes.update(node.id, { context_summary: s.summary.slice(0, 400) });
      } catch {
        // summary failure is non-fatal
      }
    }

    // ---- stage 3: async visual with own status states (PRD FR13) ----
    // A visual failure must NOT fail the completed answer: record an honest
    // "failed" visual block (the card shows the state and the Visualize action
    // is the retry path) and emit the real message as a visual_status event.
    emit({ type: "visual_status", node_id: node.id, status: "generating", message: "Creating a visual..." });
    try {
      const block = await generateVisual(node.question, answer, speed, abort, router, req.compare === true ? "comparison_table" : undefined, () =>
        emit({ type: "visual_status", node_id: node.id, status: "generating", message: "Generating visuals..." }),
      );
      nodes.update(node.id, { visual: block });
      emit({ type: "visual", node_id: node.id, block });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Visual generation failed";
      nodes.update(node.id, { visual: { type: "none", status: "failed", spec: null } });
      emit({ type: "visual_status", node_id: node.id, status: "failed", message });
    }

    // Carry the final persisted node so the client card reflects everything written
    // after stage 2 (provenance, gaps, sections, context summary, visual).
    const finalNode = nodes.get(node.id);
    emit(finalNode ? { type: "done", node_id: node.id, node: finalNode } : { type: "done", node_id: node.id });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    nodes.update(node.id, { status: "failed" });
    emit({ type: "error", node_id: node.id, message });
  }
}


