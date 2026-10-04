<div align="center">

# Ponder

**The place where a question turns into an exploration, and an exploration turns into understanding.**

A local-first, AI-native **thinking & learning environment** — conversation-first like a modern AI assistant,
source-aware like a research tool, and spatial like a mind map. Ask anything, then branch, visualize,
challenge, practice, and remember — all on an infinite canvas that grows with your curiosity.

[Features](#-features) · [Quick start](#-quick-start) · [How it works](#-how-it-works) · [Architecture](#%EF%B8%8F-architecture) · [Roadmap](#%EF%B8%8F-roadmap)

![tests](https://img.shields.io/badge/tests-195%20passing-brightgreen) ![local](https://img.shields.io/badge/local--first-SQLite%20%2B%20Ollama-blueviolet) ![llm](https://img.shields.io/badge/LLMs-Ollama%20%2B%20OpenRouter%20free%20tier-green)

</div>

---

## Screenshots

| | |
|---|---|
| **Home — start with curiosity** | **Infinite canvas — thinking, mapped** |
| ![Home in light mode: the composer is the page](docs/screenshots/home-light.png) | ![Canvas in dark mode: a real branched exploration](docs/screenshots/canvas-dark.png) |
| **Knowledge graph — what you've explored, connected** | **Home — dark mode** |
| ![Knowledge graph built from real exploration](docs/screenshots/knowledge-graph.png) | ![Home in dark mode](docs/screenshots/home-dark.png) |
| **Canvas — light mode** | **Library — saved ideas, cards, sources** |
| ![Canvas in light mode](docs/screenshots/canvas-light.png) | ![Library](docs/screenshots/library.png) |

*Every screenshot is captured from a real running instance — no mock data anywhere in Ponder.*

## Why Ponder?

Most AI tools stop at the answer. Ponder treats the answer as a starting point:

> **Question → Conversation → Context → Branch → Visualize → Research → Challenge → Practice → Create → Remember**

- **Conversation-first** — no modes to pick up front. Start with a question; contextual actions (Explore, Visualize, Research, Challenge, Practice, Open in Canvas) appear where they matter.
- **Thinking, spatially** — every follow-up becomes a node on an infinite canvas, so a session turns into a map of your understanding.
- **Source-aware** — research answers separate *what is known*, *what is inferred*, and *what is uncertain*, and never fabricate citations.
- **Honest by design** — no fake streaks, fake progress, or placeholder content anywhere. If there's no data yet, you'll see a polished empty state.

## ✨ Features

### Conversation & exploration
- **Home launchpad** — "What are you curious about?", a large composer (web-search toggle, Socratic *Think with me* toggle, Fast/Quality selector), 6 real example prompts, and a capability strip. Every question started from Home opens a **brand-new canvas + conversation** — never appended to an existing one; in-canvas questions stay in that canvas with full thread context.
- **Staged AI pipeline** per question — answer streams token-by-token with clickable **key-term chips**; auto-title + suggested follow-ups; then an automatic **visual** (Mermaid diagram, chart, comparison table, timeline — or a manipulable **interactive simulation** with live sliders when the idea is about a physics, economics, or probability relationship).
- **Visualize on demand** — every completed answer has a *Visualize* action: a pulsing skeleton loader appears in the visual slot the instant you click; on success the real rendered diagram/chart/table/simulation takes its place and persists on the node (survives refresh); on failure the actual error message + a *Retry visual* action is shown — repeated clicks are deduped to one in-flight request, and a failed generation never masquerades as "no visual fit this content".
- **Provenance on every answer** — when a canvas studies a source, each completed answer is audited: *from your source* (with a verbatim quote), *added context* (web), or *uncertain* — badged on the card and in the Source Explorer. Never invented.
- **Automatic conversation naming** — each canvas is titled from its first real question (AI heading when available, otherwise a cleaned version of the question) the moment the answer settles; follow-ups never rename it, so titles are stable and meaningful in history.
- **Branching everywhere** — term chips, follow-up boxes, suggested questions, directional `+` buttons, and the global prompt bar all create child nodes on the canvas.
- **Thinking modes** — Explain, Research (with web retrieval), Socratic (*Think with me*), Challenge (attack the reasoning), Compare, and *Explain it like…* styles that change actual model behavior.

### Thinking surfaces
- **Infinite canvas** (React Flow) — pannable dotted grid, dashed parent→child edges, drag/zoom/fullscreen, undo/redo. The canvas **auto-frames each new answer** at a readable zoom (question kept in view) using real measured bounding boxes, remembers your viewport per canvas, and never fights a manual pan. Answer text **sizes to its content** (the card grows; the stage re-measures and gently re-fits), and when an answer is genuinely long, the wheel over it **scrolls the text, not the canvas** — a native listener isolates the scrollable region from d3-zoom's pane listener and hands the wheel back to the canvas once the text reaches its end (natural scroll chaining). Zoom/pan/pinch elsewhere on the canvas are untouched.
- **Thinking Map** — AI-generated facets of the question space, each expandable into a real node.
- **Evidence Board** — collect claims, supporting/counter evidence, and open questions.
- **Knowledge Graph** — every concept you've actually explored, connected by real parent-child relationships.
- **Why-chains** — recursive "Why?" nodes keep the trail of reasoning visible.
- **Ask Ponder** — select any text anywhere in the app for contextual actions (Explain, Why?, Challenge, Connect, Visualize, Practice…).
- **Source Explorer** — attach text, URLs, or files (incl. PDFs) to a canvas; each source gets an AI summary, key points, and extracted core concepts; every answer's provenance + web sources are listed and auditable, and a click jumps the canvas to that node.
- **Artifacts** — one-click **study guide, research brief, timeline, or flashcard deck** generated strictly from a canvas's real Q&A; a deck's cards import straight into your spaced review (idempotent).

### Learning that sticks
- **Practice** — multiple-choice, fill-blank, ordering, and short-answer exercises generated from your own material, with misconception-aware feedback.
- **Adaptive** — practice misses become known weak spots; exams and recommendations weight toward them.
- **Test me** — generated exams from your real explored topics, with an honest scoring summary.
- **Active recall** — "Can you explain it without looking?" graded against the source.
- **Concept chips** — a source's extracted concepts become interactive chips: *Explain* (grounded in that source), *Visualize* (diagram/simulation), or *Practice* (unlocks automatically once a node about the concept exists — it explains it first, then drills it).
- **Audio learning** — read-aloud for any answer (real Web Speech TTS with pause/resume, speed & volume, autoplay opt-in) plus a per-canvas **🎧 Recap**: a short spoken summary of what you actually learned, generated on demand.
- **Spaced repetition** — concepts become knowledge cards scheduled with **FSRS**; Review surfaces what's due. **Exam results and recall grades also feed FSRS per knowledge-graph concept** — weak topics are pulled forward and resurface in Review automatically.
- **Personal context** — Ponder adapts to your goal, level, style, and time budget (Profile popover).

### Local-first foundations
- **Your machine, your data** — SQLite file on disk, no accounts, no telemetry. The API binds `127.0.0.1` only.
- **Free LLMs** — 20+ OpenRouter free-tier models discovered live and preferred automatically, with local Ollama as a resilient fallback (failover, rate-limit cooldowns, streaming-safe `<think>` stripping).
- **Multi-canvas sidebar** with rename/delete, streak 🔥 / stars ⭐, full JSON export/import, and deep links. Titles update live as a conversation gets named, and persist across refresh and restart.
- **Explore** — every thinking map you've built, in one place. Sharing is local-first and real: **export your whole workspace** (canvases, answers, maps, concept links, cards, sources) as one JSON file, send it anywhere, and **import** it on another machine — idempotent, no accounts, no cloud. There is deliberately no community feed; the honest empty state says so.
- **Mobile** — composer-first on small screens: drawer sidebar, a single scrollable canvas toolbar, safe-area-aware input bar, and pinch/pan canvas that still auto-frames new answers.

## 🚀 Quick start

**Requirements:** Node ≥ 22 · npm · [Ollama](https://ollama.com) (for local models)

```bash
git clone <your-repo-url> ponder
cd ponder
npm install
npm run dev        # API on 127.0.0.1:8787 + Vite on 5173 (auto-increments if busy)
```

Open the printed Vite URL and ask your first question. First run auto-creates your first canvas.

> **Port 8787 already in use?** (e.g. a second copy of the repo, or a previous instance still running) The server detects the conflict at startup, prints which process holds the port, and exits cleanly — stop that process and run again. It never crashes mid-run with a bare `EADDRINUSE` trace.

<details>
<summary><strong>Optional: OpenRouter free models (recommended)</strong></summary>

```bash
cp .env.example .env
```

```env
OPENROUTER_API_KEY=sk-or-...   # free key at openrouter.ai/keys
```

With a key present, free models are preferred automatically (`CANVAS_PREFER_OPENROUTER=true` is the default).
Without it, everything runs on Ollama.

</details>

<details>
<summary><strong>Optional: model overrides & Docker</strong></summary>

 ```bash
 CANVAS_FAST_MODEL=llama3.2:3b   # stage 1/2 fallback (defaults shown — chat-verified on this machine)
 CANVAS_QUALITY_MODEL=gemma3:4b  # stage 3 fallback
 ```

Docker: `docker compose up` (Ollama expected on the host at `host.docker.internal:11434`).

</details>

## How it works

1. **Ask** — type in the composer. The 3-stage pipeline streams an answer with term chips, then titles, follow-ups, and a visual (or a manipulable simulation).
2. **Branch** — click a term chip, a suggested follow-up, or select any text → *Ask Ponder*.
3. **Ground** — attach sources (text/URL/PDF); answers get provenance, and the **Source Explorer** audits each one.
4. **Think** — flip on **Think with me** (Socratic), **Challenge**, or **Research**; open the **Thinking Map**, **Evidence Board**, or **Knowledge Graph**.
5. **Practice** — *Practice this* on any node; *Test me* for a full exam; *Recall* to explain it back; **🎧 Recap** to listen. Exam & recall grades feed FSRS so weak concepts resurface.
6. **Create & share** — turn the canvas into **Artifacts** (guide/brief/timeline/deck); **Export** the learning map as JSON and import it anywhere.
7. **Remember** — save knowledge cards; **Review** brings them back on an FSRS schedule, per concept.

## ⚙️ Architecture

 ```
 ponder/
 ├─ packages/shared/     zod schemas + types shared by both apps (Node, VisualSpec + SimSpec, Provenance,
 │                       Artifact, ConceptMastery, SSE events, conceptKey)
 ├─ server/              Express + better-sqlite3 (localhost-only)
 │  ├─ src/llm/          provider interface, Ollama + OpenRouter adapters, failover router
  │  ├─ src/pipeline/     3-stage prompts + orchestration, provenance + artifact + recap prompts,
  │  │                    visual spec parsing/normalization (flattened-output repair), web search,
  │  │                    context builder
 │  ├─ src/db/           schema, migrations, repos, stats, FSRS scheduling, title derivation/repair,
 │  │                    concept-mastery (per-concept FSRS)
 │  ├─ src/review/       FSRS scheduler
 │  ├─ src/util/         dependency-free PDF text extraction (no content is ever invented)
 │  └─ data/app.db       your data (gitignored)
 ├─ frontend/            Vite + React 18 + React Flow + Zustand + TanStack Query + Tailwind
 │  ├─ src/app/          pages (Home, Canvas, Graph, Library, Review, Explore, Settings)
 │  ├─ src/components/   canvas/, thinking/ (Source Explorer, Artifacts), practice/, visuals/ (SimulationVisual),
 │  │                    learning/ (materials), sidebar/, ask/
  │  └─ src/lib/          api client (SSE streaming), inline markdown, prefs, ask routing, viewport math,
  │                       wheel/zoom isolation, deterministic simulation math, speech text-cleaning,
  │                       concept matching
 ├─ scripts/             one-off screenshot capture for this README
 └─ docs/screenshots/    real captures of the running app
 ```

**LLM routing:** every stage tries OpenRouter **free models first** (catalog discovered live from `/api/v1/models`, refreshed every 10 min; round-robin; 429 → cooldown, 403/daily-limit → session skip), then falls back to the configured local Ollama model. `model_used` on each node records what actually answered.

**Streaming:** the ask endpoint is SSE over `fetch` ReadableStream — events: `node_created`, `delta`, `reset` (failover restarts), `stage2`, `visual_status`, `visual`, `done`, `error`, `canvas_titled` (conversation auto-named). `stage2` is emitted the moment the answer settles, so the composer unlocks without waiting for the post-answer enhancements (gaps/sections/visual), which can take minutes on slow local models. The client applies events to an optimistic node store, so reloads mid-generation degrade gracefully.

## Verify & test

```bash
curl http://127.0.0.1:8787/api/health   # {"ok":true,"ollama_reachable":true,...}
npm run typecheck                       # all three packages
npm test                                # vitest suites across server + frontend
```

## 🗺️ Roadmap

Ponder's loop: **Question → Conversation → Context → Branch → Visualize → Research → Challenge → Practice → Create → Remember → New question.**

**Delivered:**

- [x] **Source-grounded research workspace** — text/URL/file (incl. PDF) sources attached to a canvas, AI summaries + extracted concepts, per-answer provenance (*from your source* with verbatim quote / *added context* / *uncertain*), auditable Source Explorer.
- [x] **Artifact generation** — study guides, research briefs, timelines, flashcard decks from a canvas's real Q&A; decks import into spaced review idempotently.
- [x] **Concept extraction from materials** — source concepts as interactive chips: explain (grounded in that source) / visualize / practice (auto-unlocks once a node exists).
- [x] **Interactive simulations** — projectile motion, compound interest, binomial distribution; the LLM picks the sim + starting params, but the picture is computed by deterministic client math, so sliders always work.
- [x] **Audio learning** — read-aloud (Web Speech TTS) + on-demand spoken **Recap** of a canvas.
- [x] **Spaced-review integration** — exam results and recall grades feed FSRS per knowledge-graph concept; due concepts resurface in Review.
- [x] **Explore/Discover (local-first)** — all your learning maps in one place; whole-workspace JSON export/import as the sharing mechanism; honest empty state, no fake community.
- [x] **Mobile layout polish** — composer-first: drawer sidebar, scrollable canvas toolbar, safe-area-aware composer, pinch/pan canvas.
- [x] **Canvas stability & correct visual generation** — answer text sizes to content with wheel/zoom isolation (scrolling over long answers scrolls the text, never zooms the canvas); on-demand *Visualize* with skeleton → visual / error + retry lifecycle and click dedupe; honest LLM-failure contract across all structured generation (no masked failures, no fake "none", shape-repaired model output, crash-safe route validation) — ADR-008.

### Planned Improvements

Everything below is **not yet implemented** — an item is marked complete only when its implementation and tests exist and have been verified.

**A. More deterministic simulations** — expand the simulation library (currently projectile motion, compound interest, binomial distribution) with additional interactive, scientifically accurate simulations:

- **Pendulum** — periodic motion, angular displacement, and the relevant physical parameters (length, gravity, damping).
- **RC circuit** — capacitor charging and discharging over time.
- **Logistic growth** — population growth under a carrying-capacity constraint.
- **SIR epidemic model** — susceptible / infected / recovered population dynamics.

The architecture follows ADR-003 strictly: the LLM selects the appropriate simulation and proposes initial parameters; deterministic client-side math computes the state and renders the visualization. Each simulation ships with mathematically correct, unit-tested calculations — parameter ranges, units, boundary conditions, and numerical stability verified — and is not considered complete until its implementation and tests exist. The LLM never invents simulation outputs or computes animation frames.

**B. Global search across the learning map** — search across all local canvases from the sidebar, covering questions, answers, and the terms/text contained in canvas nodes. Results are clearly labeled with their source canvas; selecting one opens the corresponding canvas, navigates to the matching node, and focuses it using the existing pan-and-zoom behavior. Search stays entirely local, using the application's existing data — no cloud search service, account system, or new infrastructure.

**C. Local backup and restore** — a reliable workflow for the single `app.db` database file:

- A **Back up now** action; backups saved to a clearly documented local backup folder, with optional scheduled local snapshots.
- A backup history with timestamps and metadata, and a clear one-click restore of a selected backup.
- Reliability contract: consistent backups via an appropriate SQLite backup mechanism (never a blind copy of a live database), a backup validated before restore, a safety backup of the current database taken before any restoration, and safe handling of shutdown, connections, rollback, and restart.
- All operations are local. The feature is considered done only when it works and has been tested.

**D. Model picker in Settings** — select the preferred fast and quality models directly in the Settings UI:

- The list comes from live Ollama discovery — models Ollama actually reports as installed, never hardcoded names — with separate selections for the fast and quality roles, persisted locally across restarts, refreshable on demand, and graceful handling of unavailable models.
- **Configuration precedence (mandatory):** `CANVAS_FAST_MODEL` overrides the saved fast-model preference when set; `CANVAS_QUALITY_MODEL` overrides the saved quality-model preference when set; when an env var is unset, the locally saved preference (where valid) is used, followed by the existing documented fallback.
- Settings makes the *effective* configuration visible, so a user can tell when an environment variable is overriding their selection.

**E. Large-canvas performance** — improve performance for canvases with many nodes (every card currently renders at full fidelity regardless of visibility):

- Off-screen node culling, level-of-detail rendering when zoomed far out, efficient viewport-based rendering and updates, and fewer unnecessary React re-renders / expensive recalculations.
- Must preserve: correct canvas coordinates, stable pan-and-zoom, node state / conversation history / branches / persisted content, usability of selected or actively edited nodes, and search navigation, simulations, visualizations, and canvas auto-focus.
- No performance improvement is claimed without measurements on actual large canvases.

### Deliberately Deferred

**A. Illustration rendering (ADR-005)** — the illustration schema is complete (scene descriptions, labeled elements, captions, style information) and persisted specifications round-trip correctly. However, **no illustration renderer is exposed**: there are no placeholder graphics and no nonfunctional illustration controls, and the Stage-3 visual-generation prompt does not offer illustration as an available output type — supported diagrams are used for spatial or structural explanations instead. Implementation resumes only when a renderer can produce genuinely illustration-quality results, verified against real persisted illustration specifications — never as a basic icon-placement approximation.

**B. Lecture capture and transcription (ADR-006)** — out of scope until a suitable local speech-to-text (STT) model is available. No cloud transcription as a substitute; no mock transcripts or simulated recording functionality. The existing read-aloud and recap capabilities are retained. This is revisited only after a local model has been evaluated for accuracy, latency, hardware requirements, and privacy.

### Rejected by Design

**Community feed, accounts, and cloud sync (ADR-007)** — intentionally excluded from Ponder's product direction: no community feed or social profiles, no mandatory user accounts or authentication, no cloud synchronization or remote user-data storage. Ponder is a **local-first personal learning environment**, and the **JSON file is the sharing unit** — portable JSON export/import remains the supported way to share learning content. These are not features awaiting implementation; they are rejected by design.

*The roadmap follows one principle: implement capabilities as real production behavior, or show an honest empty state — never mock UI.*

## Notes & decisions

- **ADR-001:** streak/stars are **global** (app_state), not per-canvas — a streak is a person-level habit signal.
- **ADR-002:** Explore is **local-first file sharing**, not a community feed — no accounts, no cloud, no synthetic activity. Exporting a `ponder-learning-map.json` and importing it on another machine *is* the sharing surface.
- **ADR-003:** simulations are **deterministic client math** — the LLM only chooses which simulation and its starting parameters; trajectory, balance curves, and distributions are computed locally, so the visuals are always correct and manipulable (and never hallucinated).
- **ADR-004:** provenance is **non-fatal** — if the audit model call fails or times out, the answer still stands; it simply gets no provenance badge rather than a fabricated one. Web-only answers are marked *added context* by rule, not by the model.
- **ADR-005:** the **illustration visual type is schema-ready with an intentionally unexposed renderer**. Persisted illustration specs render as an honest deferred notice showing their preserved data (scene/elements/caption) — never a placeholder drawing. The Stage-3 prompt does not offer the type (guarded by tests). Implementation is gated on a renderer that meets a genuinely illustrative quality bar, per the Deliberately Deferred section above.
- **ADR-006:** **lecture capture / transcription stays out of scope** until a local STT model meets accuracy, latency, hardware, and privacy requirements. No recording, no transcription pipeline, no cloud substitute — and no placeholder results. The existing audio-out features (read-aloud, 🎧 recap) are retained and unaffected. (Composer voice *input* is a separate, shipped typing convenience and is not lecture capture.)
- **ADR-007:** import/export validates schema versions: legacy v1 (no version field) and v2 files import; unknown versions are rejected with a clear error rather than mis-imported; existing data is never overwritten (id collisions skip). The JSON file is the only sharing mechanism — no backend, no accounts, no cloud.
- **ADR-008:** **visual generation failures are real, never masked.** `generateVisual` returns a `none` block only when a model actually answered and chose none; provider/network failures and unparseable output throw actionable errors (route → 502 with the reason, pipeline → `visual_status failed` without failing the completed answer). Model output is shape-repaired before validation (lenient JSON extraction + one level of unwrapping + the flattened-spec quirk, e.g. `{"type":"flowchart","mermaid":"…"}`, observed live from gemma3:4b). A node with no usable visual persists an honest `failed` block after a failed attempt; a previously good visual is never destroyed by a failed regeneration.
- **Local model defaults** (`llama3.2:3b` fast / `gemma3:4b` quality) are chat-verified on this CPU-only machine — `qwen2.5:7b`/`14b` hang indefinitely on Ollama's chat path here (diagnosed 2026-10-03). Override with `CANVAS_FAST_MODEL` / `CANVAS_QUALITY_MODEL` env vars; at ~3 tok/s a full answer streams in about 1–2 minutes, and the local hard cap (10 min) is sized for that.
- Everything runs on localhost; the API binds `127.0.0.1` only, and the OpenRouter key never leaves your machine except to OpenRouter.

## Contributing

Issues and PRs welcome. Before a large PR, open an issue describing the thinking-surface or learning capability you want to add — the best contributions deepen the core loop rather than adding disconnected features.

Run locally with `npm run dev`; make sure `npm run typecheck` and `npm test` pass. Screenshots in `docs/screenshots/` can be regenerated with `node scripts/capture-screenshots.mjs` while the app is running.

---

<div align="center">

**Ponder** — not just the answer, but what to do next with it.

</div>
#   P o n d e r  
 #   P o n d e r  
 