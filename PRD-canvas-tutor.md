# PRD: Local Infinite-Canvas AI Tutor ("Canvas Learn")

**Author:** Draft for [you]
**Date:** Sept 16, 2026
**Status:** Draft v2 — revised after reviewing a screen recording of Wondering's Canvas
**Inspiration:** Wondering's Canvas feature (wondering.app) — a spatial, node-based Q&A learning surface where each question/answer pair is a card on an infinite canvas, and follow-up questions branch off visually from their parent.

---

## 1. Problem & Goal

Wondering's Canvas lets a learner ask a question, get a **visual + textual** answer, then ask a follow-up that spawns a **connected node** nearby — so a learning session becomes a spatial mind-map instead of a linear chat log. This is good for bite-sized, habitual learning because:
- Branching questions stay visually tied to their context (no scrolling up through a long chat).
- The canvas itself becomes a reviewable artifact ("what did I learn today").
- Visual answers (diagrams, comparisons) aid retention more than plain text.

**Goal:** Build a self-hostable, local-first version of this using **Ollama** (fully local models) or **OpenRouter's free-tier models** (when a stronger model is needed), so there's no dependency on Wondering's paid backend.

**Non-goals (v1):** live "podcast-style" voice tutor, course marketplace/Browse tab, mobile apps, multi-user collaboration. These can be v2+.

---

## 2. Observed Product Walkthrough (from screen recording)

This section documents exactly what Wondering's Canvas does, frame by frame, so the clone targets the real interaction model instead of a guess.

**Layout**
- Left sidebar: Home / Create / Canvas / Library / Profile nav, a list of saved canvases (dropdown + "new canvas" `+`), a streak counter (flame icon) and a "stars"/points counter, an Upgrade CTA, and the user's profile chip at the bottom.
- Main area: an infinite dotted-grid canvas. A global prompt bar is pinned bottom-center: **"Start another thread..."** — submitting this creates a new, unconnected **root node** anywhere convenient on the canvas.
- That global prompt bar also carries two controls that matter for the clone: a **web-search toggle** (globe icon, "Web search on") and a **model-speed selector** ("Fast ▾"). Both apply per-message.

**Node lifecycle (this is the core interaction to replicate)**
1. User types a question → a **node** (bordered card) appears on the canvas. Inside it, the question renders instantly as a dark pill/chat-bubble in the top-right of the card.
2. A `...` typing indicator shows briefly, then the **answer text streams in** below the question, left-aligned, in plain prose (short — a few sentences).
3. Certain key terms inside the streamed answer are auto-highlighted as **inline chips** (light pill with a sparkle icon, e.g. `✨ water cycle`, `✨ hydrologic cycle`, `✨ groundwater`, `✨ atmosphere`). These are clickable — clicking one spawns a **new connected child node** whose question is essentially "explain {term}", titled after that term (e.g. a chip click produced a node titled simply "ice caps").
4. Once the text finishes, status text switches to **"Creating a visual..."** then **"Generating visuals..."** — i.e., the visual is a *separate, later* generation step, not part of the same streamed response. The visual renders inside a sub-panel below the text once ready, and diagrams appear to build progressively (nodes/arrows added one at a time) rather than popping in all at once.
5. Three visual types were observed, chosen per-question by the model:
   - **Cyclic/flow diagrams** — labeled colored boxes connected by curved arrows (e.g. "Stages of the Hydrologic Cycle": Evaporation → Condensation → Collection → back to Evaporation), used for processes/cycles.
   - **Illustrations** — a single detailed themed graphic (e.g. a labeled cartoon-style water-cycle scene with clouds, mountains, arrows for precipitation/evaporation/runoff), used for a "what is X" / show-me-the-whole-picture question.
   - **Charts** — a donut/pie chart with a legend and percentages (e.g. "Earth's Water Distribution": Ocean 96.5%, Freshwater 2.5%, Other Saline 1%), used for proportion/quantity questions.
6. Below the visual, each node has its own **"Ask a follow-up..."** input, docked to the bottom of that specific node — submitting it creates a new child node connected to *this* node specifically (not the global thread bar).
7. Below the node (outside its border), Wondering also surfaces **2–4 suggested follow-up questions** as separate clickable rows (e.g. "How much freshwater is actually accessible for human use?", "Where is most of the surface freshwater located?"). Clicking one behaves like typing it into that node's follow-up box.
8. Small circular **`+` buttons** float at the top, left, and right edges of a node — these let the user manually spawn a new connected node in a specific spatial direction without necessarily asking a follow-up tied to the text.
9. Each node header shows: an auto-generated short **title** (derived from the Q&A, renamed once the answer completes — e.g. "what is watercycle" → "The Water Cycle"), plus icon buttons to **collapse/expand**, **delete**, and **save to notes/library**.
10. **Connections** between parent and child nodes render as curved (often dashed) lines with small draggable handle-dots along the curve; the whole graph is pannable/zoomable, with zoom/fullscreen controls bottom-right and undo/redo top-right.

**Implication for the clone's generation pipeline:** this confirms a **staged pipeline**, not one big LLM call —
`(1) stream answer text with inline term markup` → `(2) generate 2–4 suggested follow-up questions` → `(3) asynchronously decide + generate a visual (flow diagram / illustration / chart)`. Each stage can hit a different model (e.g. a fast small local model for stage 1's streaming feel, a slightly stronger call for stage 3's structured output).

---

## 3. Target User & Core Use Case

- Solo learner (you, initially) who wants to explore a topic in short sessions, branch into tangents, and revisit/review the canvas later.
- Primary loop: **Ask → text streams in with clickable key-term chips → visual generates shortly after → branch via a term chip, the node's own follow-up box, or a suggested-question row → canvas accumulates over days → periodic review pass over old nodes (habit/spaced repetition).**

---

## 4. Core Concepts / Data Model

### 4.1 Node
Each Q&A exchange is one node on the canvas.

```
Node {
  id: uuid
  canvas_id: uuid
  parent_id: uuid | null          // null = root node (new topic/thread)
  branch_origin: "thread" | "followup_box" | "term_chip" | "suggested_question" | "manual_plus"
  title: string                   // auto-generated short title, set once answer completes
  question: string
  answer_text: markdown string    // includes inline term-chip markup, e.g. [[water cycle]]
  key_terms: string[]             // terms rendered as clickable chips in answer_text
  suggested_followups: string[]   // 2-4 model-generated next-question suggestions
  answer_visual: VisualBlock | null
  position: { x: number, y: number }
  size: { w: number, h: number }
  model_used: string              // e.g. "llama3.1:8b" or "openrouter/mistral-7b-free"
  web_search_used: boolean
  created_at: timestamp
  tags: string[]                  // auto-extracted topic tags, for review/spaced repetition
  review_state: {                 // for habit/spaced-repetition loop
    due_at: timestamp
    interval_days: number
    ease: number
    last_reviewed_at: timestamp | null
    times_reviewed: number
  }
}
```

### 4.2 VisualBlock
The "visual as well as informative" part. Matching what was observed (flow diagrams, single illustrations, and charts — generated *after* the text, asynchronously), replicate this cheaply and reliably by having the LLM emit **structured visual specs** that a fixed set of renderers turn into SVG/HTML on the canvas, rather than calling an image-gen model:

```
VisualBlock {
  type: "cycle_diagram" | "flowchart" | "illustration" | "chart" | "comparison_table" | "timeline" | "none"
  status: "pending" | "generating" | "ready" | "failed"
  spec: JSON | mermaid_string
}
```
- **cycle_diagram / flowchart / timeline** → rendered via Mermaid.js (matches the observed step-by-step "build one node at a time" animation reasonably well, or can be faked client-side by revealing Mermaid nodes sequentially).
- **illustration** → a curated **icon/SVG-scene composer**: the LLM picks from a fixed library of themed SVG icon assets (clouds, mountains, arrows, labeled shapes) and positions/labels them via JSON, rather than free-form image generation. This is the most complex renderer to build and is a reasonable v1 simplification: start with cycle_diagram + chart, add illustration in a later phase once the icon library exists.
- **chart** → a small chart component (e.g. Chart.js or Recharts) fed `{chart_type: "donut"|"bar"|"line", labels, values}`.
- **comparison_table** → a plain React table component.
- The LLM is prompted to **choose the right visual type** and output valid structured data for it (JSON schema per type, validated before render; on failure, retry once, then fall back to `type: none` and just show the text).
- `status` drives the UI copy shown to the user ("Creating a visual...", "Generating visuals...") exactly like the original.

### 4.3 Canvas
```
Canvas {
  id: uuid
  title: string
  streak_count: integer      // consecutive days used, for the flame-icon habit counter
  stars_count: integer       // simple gamification points (e.g. +1 per node created/reviewed)
  created_at, updated_at
  nodes: Node[]
  edges: derived from parent_id (no separate table needed for v1)
}
```

### 4.4 Edge (implicit)
Parent → child relationship, rendered as a curved (dashed) connecting line with drag handles, per the recording. No independent entity needed unless you later want non-hierarchical links (e.g. "relates to" links between siblings) — flag as a v2 nice-to-have.

---

## 5. Functional Requirements

### 5.1 Canvas & node shell
- FR1: Infinite pannable/zoomable 2D dotted-grid canvas, with zoom in/out + fullscreen controls (bottom-right) and undo/redo (top-right), matching the recording's layout.
- FR2: Global bottom-center prompt bar, **"Start another thread..."**, with a web-search toggle and a "Fast ▾" model-speed dropdown → submitting creates a new unconnected **root node**.
- FR3: Node header shows an auto-generated **title** (set once the answer completes) plus collapse/expand, delete, and "save to library" icon buttons.
- FR4: Question renders immediately as a dark bubble top-right inside the new node; a `...` indicator shows until the first answer tokens arrive.
- FR5: Node-local **"Ask a follow-up..."** input, docked to the bottom of every node → creates a child node connected to *that* node.
- FR6: Small `+` buttons on a node's top/left/right edges → manually create a connected child node positioned in that direction, without requiring follow-up text tied to content.
- FR7: Nodes are draggable; parent→child connections render as curved (dashed) lines with drag-handle dots, and re-render live as nodes move.
- FR8: Multiple canvases, listed in a left sidebar (Home/Create/Canvas/Library/Profile nav + per-canvas list + "new canvas" `+`), each independently saved/loadable.
- FR9: Sidebar shows a streak counter (flame) and a points/stars counter, tied to `Canvas.streak_count` / `stars_count`.

### 5.2 Q&A generation pipeline (staged, per the recording)
- FR10: **Stage 1 — Answer text:** on question submit, send `{question, ancestor-chain context, canvas title}` to the LLM; stream `answer_text` token-by-token into the node.
- FR11: **Inline key terms:** the same stage-1 output marks 2–4 key terms in the text (e.g. via a lightweight markup convention the model is asked to use, like `[[term]]`), rendered client-side as clickable sparkle-icon chips. Clicking a chip submits a new question ("Explain {term}" or similar) as a **child node** titled after that term.
- FR12: **Stage 2 — Suggested follow-ups:** a second, small/fast call (or the same call with a second output field) generates 2–4 short follow-up questions, rendered as clickable rows below the node. Clicking one behaves exactly like typing it into that node's follow-up box.
- FR13: **Stage 3 — Visual (async, after text):** once stage 1 finishes, kick off a separate call that (a) decides whether/which visual type fits (`cycle_diagram`, `flowchart`, `illustration`, `chart`, `comparison_table`, `timeline`, or `none`) and (b) emits the structured spec. Show status text ("Creating a visual...", "Generating visuals...") while pending, matching the observed UI; render into the node when ready.
- FR14: Regenerate / "try a different angle" button per node (re-runs stage 1–3).
- FR15: **Model-speed selector** ("Fast ▾") on every prompt bar maps to a concrete backend model choice (see §6.4) — e.g. Fast = small local Ollama model, a slower/higher-quality option = larger local model or an OpenRouter free model.
- FR16: **Web-search toggle** — when on, stage 1 is preceded by a lightweight retrieval step (a free/local search API or scraper) whose top results are injected into the prompt as context; `web_search_used` is recorded on the node.

### 5.3 Habit / spaced repetition loop
- FR17: Each node gets an initial `review_state` (e.g. due in 1 day) once created.
- FR18: A "Review" mode: surfaces due nodes as flashcards (question → reveal answer+visual), independent of canvas position. Use a simple SM-2 or FSRS-lite scheduling algorithm (open-source implementations exist; FSRS is what Wondering references).
- FR19: User self-rates recall (Again/Hard/Good/Easy) → updates `review_state`, and increments the streak/stars counters on completion.
- FR20: Daily reminder / streak counter (local notification or just an in-app "N cards due today" badge — no push infra needed for local-first v1).

### 5.4 Persistence
- FR21: All canvases/nodes stored locally (SQLite file or IndexedDB if pure client-side). Exportable as JSON for backup.
- FR22: No account system required for v1 (single local user). Leave room for optional sync later.

---

## 6. Technical Architecture

### 6.1 High-level stack

| Layer | Choice | Why |
|---|---|---|
| Canvas UI | **React + [React Flow](https://reactflow.dev/) or [tldraw](https://tldraw.dev/)** | Both give pan/zoom/node/edge primitives out of the box; React Flow is more purpose-built for node-graphs like this. |
| Diagram/visual rendering | **Mermaid.js** (flowcharts, timelines, simple diagrams) + a small custom React table/chart component | No image-gen needed; deterministic, fast, themeable. |
| App/API server | **FastAPI (Python) or Node/Express** | Thin layer: receives question + context, calls LLM, parses/validates structured output, streams back to client. |
| LLM (local) | **Ollama**, models like `llama3.1:8b`, `qwen2.5:7b-instruct`, `phi3.5` | Local, free, private. Instruct-tuned models needed for reliable structured (JSON) output. |
| LLM (fallback/stronger) | **OpenRouter free-tier models**, e.g. `meta-llama/llama-3.1-8b-instruct:free`, `google/gemini-flash-...:free`, `mistralai/mistral-7b-instruct:free` (verify current free list at openrouter.ai/models — it changes) | For questions where local model quality is insufficient. |
| DB | **SQLite** (via `sqlite3`/Prisma/SQLAlchemy) | Zero-config, file-based, fits "local" goal. |
| Spaced repetition | **ts-fsrs** (TypeScript) or **py-fsrs** (Python) open-source libs implementing FSRS | Same algorithm family Wondering cites. |

### 6.2 LLM call design — three stages, matching the observed behavior

This directly mirrors what the recording shows (text streams first with clickable terms and suggested follow-ups; the visual appears later, with its own "generating" status):

**Stage 1 — Answer + key terms (streamed).**
System prompt instructs the model to answer concisely (bite-sized, 80–150 words) given the ancestor-chain context, and to wrap 2–4 important terms in `[[double brackets]]` inline as it writes. Stream tokens directly to the node; client-side regex converts `[[term]]` into a clickable chip as it streams in.

**Stage 2 — Suggested follow-ups.**
Immediately after stage 1 completes (or in parallel, since it doesn't need to stream), a short call: *"Given this Q&A, suggest 3 natural follow-up questions a curious learner might ask next. Respond as a JSON array of strings only."* Rendered as clickable rows under the node once ready — this can run on the same fast model as stage 1.

**Stage 3 — Visual (async, own loading state).**
Once stage 1's text is final, fire a separate call: *"Given this question and answer, decide if a visual aid would help. Respond with ONLY JSON: `{"type": "...", "spec": ...}`."*
```
- "cycle_diagram" / "flowchart" / "timeline" → spec is a valid Mermaid string
- "illustration" → spec is {"scene": "...", "elements": [{"icon": "cloud"|"mountain"|"arrow"|..., "label": "...", "x":.., "y":..}]}  (icon set defined by the clone's asset library)
- "chart" → spec is {"chart_type": "donut"|"bar"|"line", "labels": [...], "values": [...]}
- "comparison_table" → spec is {"headers": [...], "rows": [[...]]}
- "none" → spec is null
```
Validate against a schema (`zod`/`pydantic`); on failure, retry once, then fall back to `type: none`. The node shows "Creating a visual..." then "Generating visuals..." while this is in flight, then renders the result — for `cycle_diagram`/`flowchart`, optionally reveal Mermaid nodes one-by-one (setTimeout stagger) to approximate the observed progressive-build animation.

Breaking generation into three narrowly-scoped calls (rather than one call producing everything) is also what makes this feasible on small local 7–8B models — each call has a small, well-defined job instead of one large ambiguous one.

### 6.3 Context management
- Only pass the **ancestor chain** (path from root to current node) to the LLM, not the whole canvas — keeps token count low, which matters a lot for local 7–8B models with small effective context.
- Summarize long ancestor chains beyond ~5 nodes into a short "context so far" blurb (generated once, cached) rather than replaying every Q&A verbatim.

### 6.4 Model routing & the "Fast ▾" / web-search controls
- The prompt bar's **"Fast ▾" dropdown** maps to a small config, e.g.: `Fast` → local Ollama small model (`qwen2.5:7b-instruct` or `phi3.5`, low latency, used for stage 1/2); `Quality` → a larger local model (`llama3.1:8b`/`qwen2.5:14b` if hardware allows) or a specific OpenRouter free model, used mainly for stage 3's structured output where reliability matters more than speed.
- The **web-search toggle** triggers a lightweight retrieval step before stage 1: query a free/no-key search API (e.g. DuckDuckGo HTML scrape, or SearXNG if self-hosted) for the question, take top 3 snippets, inject as extra context in the stage-1 prompt. This is optional and off by default to keep things fully offline-capable.
- Server abstracts Ollama and OpenRouter behind one interface (`generate(prompt, model_id, stream) -> tokens`), since both expose OpenAI-compatible-ish chat completion APIs — a thin adapter handles the differences.

---

## 7. UX Flow (v1)

1. User opens app → sidebar lists canvases → creates new canvas or opens existing.
2. Empty canvas shows the "Canvas — A visual way to understand things in parallel" empty state with the global prompt bar. User types a question, optionally toggling web search / picking Fast vs Quality → submits.
3. Node appears: question bubble instantly, `...` indicator, then answer text streams in with inline term chips; status flips to "Creating a visual..." → visual renders; 2–4 suggested follow-ups appear below the node; node title updates from the raw question to a short generated title.
4. User branches by: clicking a term chip, typing in the node's own "Ask a follow-up..." box, clicking a suggested-follow-up row, or using a directional `+` button — each spawns a connected child node, linked by a curved line.
5. User can drag nodes to rearrange, zoom out to see the whole map (undo/redo top-right, zoom/fullscreen bottom-right), collapse/delete/save individual nodes, and rename the canvas.
6. Separately, a "Review" tab shows due cards from all canvases (spaced repetition mode), decoupled from spatial layout, and increments the streak/stars counters shown in the sidebar.

---

## 8. Non-Functional Requirements
- **Latency:** streaming required — local 7-8B models can take 5-20s for a full answer; must feel responsive via token streaming, not a spinner.
- **Offline-capable:** with local Ollama models + SQLite, the app should work fully offline (OpenRouter path obviously needs internet).
- **Cost:** $0 — Ollama is free/local; OpenRouter free-tier models have rate limits (design for graceful fallback to local model if free-tier limit hit).
- **Portability:** runs as a local web app (`localhost`), single Docker Compose (frontend + API + SQLite) or just `npm run dev` + `ollama serve`.

---

## 9. Milestones

| Phase | Scope |
|---|---|
| M1 — Core loop | Canvas UI (React Flow), global prompt bar → root node, node-local follow-up box → child node, stage-1 streamed answer w/ inline `[[term]]` → chip rendering, via local Ollama model, SQLite persistence. |
| M2 — Suggested follow-ups + chip branching | Stage-2 call for suggested questions (clickable rows), term-chip click → child node, node auto-titling. |
| M3 — Visuals | Stage-3 async visual call, "Creating a visual.../Generating visuals..." status states, Mermaid renderer for cycle_diagram/flowchart/timeline, chart renderer for donut/bar/line, schema validation + fallback to `none`. Illustration type deferred to M6 (needs an icon-asset library to look good). |
| M4 — Canvas UX polish | Directional `+` buttons, draggable curved connectors with handles, drag/zoom/undo-redo/fullscreen, multi-canvas sidebar management. |
| M5 — Model routing & controls | "Fast ▾" selector wired to real local/OpenRouter models, web-search toggle + retrieval step, OpenRouter adapter with free-tier rate-limit fallback to local. |
| M6 — Habit loop + illustrations | FSRS scheduling, Review mode, streak/stars counters in sidebar; build out the illustration renderer (SVG icon composer) as the stretch visual type. |
| M7 (stretch) | Export/share canvas as image or JSON, canvas-wide "summarize what I learned" node, node "save to library" persistence view. |

---

## 10. Open Questions
- Which local model gives the best `[[term]]`-marking and JSON-schema reliability at 7-8B scale? (Worth benchmarking `qwen2.5:7b-instruct` vs `llama3.1:8b` vs `phi3.5` specifically on structured-output adherence for stage 2/3.)
- Is the illustration type worth building at all for a personal/local clone, given it needs a curated icon library to look good — or is it acceptable to only ever produce cycle_diagram/flowchart/chart and skip freeform illustrations?
- Auto-layout algorithm for child nodes — simple radial/offset positioning (as seen in the recording) vs. a proper tree-layout library (e.g. `dagre`, which React Flow integrates with)?
- Should tags/topics be auto-extracted per node (for the Review mode's grouping) via a lightweight local classification call, or kept manual?
- Free OpenRouter models' context limits and rate limits change frequently — needs a small "capabilities check" on startup rather than hardcoding.
- What should the streak/stars logic actually reward (nodes created vs. reviews completed vs. days active) — the recording only shows the counters, not what drives them.

---

## 11. Suggested Repo Structure
```
/frontend        React + React Flow + Mermaid renderer
/server          FastAPI, LLM adapter (ollama + openrouter), FSRS scheduler
/server/db       SQLite schema + migrations
docker-compose.yml
```
