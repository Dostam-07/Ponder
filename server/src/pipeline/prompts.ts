import type { NodeEntity, LearningProfile, ThinkingMode } from "@canvas-learn/shared";

/**
 * Stage 1 — streamed answer with inline [[term]] markup (PRD §6.2).
 * Substantive answer; ancestor-chain context; 2–4 key terms in [[double brackets]].
 * Ponder GENERATES explanations — prior lesson/source/canvas content is optional
 * context, never a prerequisite (spec §1, §5–§7).
 */
export const STAGE1_SYSTEM = `You are a friendly, precise learning tutor. Give a substantive explanation in roughly 180-280 words of plain prose unless a mode or learner profile below asks for a different length. Do not use headings or bullet lists. Never show your reasoning or thinking steps — output only the final answer text. Always answer from your own knowledge and any context provided — never say an explanation cannot be provided or that more source material is needed.

For a normal explain request, cover the core definition, how or why it works, one concrete example or analogy, and an important consequence, limitation, or distinction when those details fit the question. Prefer useful detail over a one-paragraph dictionary definition, but do not pad a genuinely simple answer.

While writing, naturally wrap the 2 to 4 most important key terms from YOUR answer in double square brackets — for example the word evaporation would be written as evaporation wrapped in double square brackets. The brackets mark clickable key terms — wrap real terms only (no punctuation inside), and use each marker at most once. Do not wrap ordinary words or whole sentences, and never use the literal placeholder word "term".

If context from earlier in the conversation is provided, build on it and stay consistent with it.`;

export function stage1Prompt(question: string, contextBlurb: string): string {
  const ctx = contextBlurb.trim();
  return [
    ctx ? `Context from earlier in this conversation so far:\n"""\n${ctx}\n"""` : "",
    `Question: ${question}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/**
 * Stage 2 — one small JSON call producing title + follow-ups + tags (PRD FR12, tags per PRD §10).
 */
export const STAGE2_SYSTEM = `You output ONLY a JSON object, no other text. Shape:
{"title": "<short title, max 5 words, no trailing punctuation>", "followups": ["<question 1>", "<question 2>", "<question 3>"], "tags": ["<topic tag>", "..."], "key_terms": ["<important concept quoted from the answer>", "..."]}

Rules:
- title: a concise name for the Q&A topic (like an encyclopedia section heading, max 5 words).
- followups: 3 natural follow-up questions a curious learner might ask next about THIS answer. Each under 12 words. No numbering.
- tags: 0-3 lowercase single-word-or-hyphenated topic tags.
- key_terms: 2-4 important technical words or short concept phrases that actually occur in the answer. Quote their wording exactly, without brackets or formatting. Prefer concepts worth explaining, not ordinary words, headings, or whole sentences.`;

export function stage2Prompt(question: string, answer: string): string {
  return `Question: ${question}\n\nAnswer:\n"""\n${answer.slice(0, 4000)}\n"""`;
}

/**
 * Stage 3 — async visual decision + structured spec (PRD §6.2 stage 3).
 * choose type + emit spec matching the shared zod schemas; validated server-side with retry + none-fallback.
 */
export const STAGE3_SYSTEM = `You output ONLY a JSON object, no other text. Decide whether a visual aid would help explain this Q&A, and emit its spec.

 Choose "type" from: "cycle_diagram", "flowchart", "timeline", "chart", "comparison_table", "interactive_sim", "none".
 NOTE: the illustration type is intentionally NOT offered — its renderer is deferred by product decision; spatial/structural scenes use cycle_diagram or flowchart instead. (Guarded by tests.)

- "cycle_diagram": for repeating cycles/processes. spec: {"mermaid": "flowchart LR\\nA[Step 1] --> B[Step 2] --> ... --> A"} — the LAST node must connect back to the FIRST.
- "flowchart": for one-directional processes/decisions. spec: {"mermaid": "flowchart TD\\nA[Step] --> B[Step]"}.
- "timeline": for sequences of dated/ordered events. spec: {"mermaid": "flowchart LR\\nA[1900: event] --> B[1950: event]"}.
- "chart": for quantities/proportions. spec: {"chart_type": "donut"|"bar"|"line", "labels": ["..."], "values": [numbers]} — values must be numbers, labels same length as values, max 8 entries. Use real, well-known figures; if unsure of exact numbers, use widely accepted approximations.
- "comparison_table": for X-vs-Y contrasts. spec: {"headers": ["Aspect", "A", "B"], "rows": [["aspect", "a fact", "b fact"], ...]} — 2-5 columns, 1-8 rows.
 - "interactive_sim": for an idea that is best felt by MOVING a knob — a physics/economics/probability/biology relationship the learner can experiment with. spec: {"sim": "projectile"|"compound_interest"|"binomial"|"pendulum"|"rc_circuit"|"logistic_growth"|"sir_model", "params": [{"key","label","min","max","step","value"}], "title": "...", "caption": "..."}. Choose the sim that fits: "projectile" (speed/angle → range & arc), "compound_interest" (rate/time/contributions → growth), "binomial" (trials/probability → outcome distribution), "pendulum" (length/gravity/damping → period & amplitude decay; use for oscillation, timing, gravity on other worlds), "rc_circuit" (voltage/resistance/capacitance → charge & discharge curves, time constant), "logistic_growth" (initial population/carrying capacity/growth rate → S-curve), "sir_model" (population/contact rate β/recovery rate γ → epidemic peak & final size, R0). Use ONLY the documented param keys for the chosen sim, sensible min/max/step, and realistic starting values.
  - "none": only for greetings, purely personal requests, or content where a diagram, chart, comparison, timeline, or interactive model would genuinely communicate nothing. Prefer a useful visual for an explanatory question whenever one can be made from the answer. spec: null.

Mermaid rules: node labels may contain letters, numbers, spaces, commas, hyphens and percent signs only. Never use parentheses or quotes inside labels. Every arrow is --> and each statement is on its own line.`;

export function stage3Prompt(question: string, answer: string): string {
  return `Question: ${question}\n\nAnswer:\n"""\n${answer.slice(0, 4000)}\n"""\n\nDecide the visual and emit ONLY the JSON object.`;
}

/** Stage "summary" — used to compress long ancestor chains (PRD §6.3). */
export const SUMMARY_SYSTEM = `You output ONLY a JSON object, no other text. Shape: {"summary": "<max 80 words>"}
Summarize the key facts and direction of this Q&A exchange so a tutor can later answer follow-ups with this context alone.`;

export function summaryPrompt(q: string, a: string): string {
  return `Question: ${q}\nAnswer: ${a.slice(0, 2500)}`;
}

/**
 * Personalization directives (spec §3) — these genuinely modify stage-1 behavior.
 * Each dimension maps to concrete writing instructions, not decorative labels.
 */
export function profileDirectives(profile: LearningProfile | undefined): string {
  if (!profile) return "";
  const parts: string[] = [];
  switch (profile.goal) {
    case "basics":
      parts.push("The learner wants to understand the basics — prioritize foundational intuition over completeness.");
      break;
    case "exam":
      parts.push("The learner is preparing for an exam — include the precise definitions and distinctions they are likely to be tested on.");
      break;
    case "deep":
      parts.push("The learner wants to go deep — include mechanism and nuance, and name the ideas worth pursuing next.");
      break;
    case "practical":
      parts.push("The learner wants practical application — connect the explanation to real situations where it is used.");
      break;
    case "build":
      parts.push("The learner wants to build something — orient the explanation toward implementation choices and gotchas.");
      break;
    case "review":
      parts.push("The learner is reviewing material they already know — be concise, focus on refreshing key distinctions rather than re-teaching.");
      break;
  }
  switch (profile.level) {
    case "beginner":
      parts.push("Assume no prior knowledge of the topic; define any specialized word you use.");
      break;
    case "intermediate":
      parts.push("Assume familiarity with fundamentals; skip introductory definitions and go straight to substance.");
      break;
    case "advanced":
      parts.push("Assume strong background; be precise and technical, skip simplifications.");
      break;
  }
  switch (profile.style) {
    case "analogy":
      parts.push("Lead with a vivid everyday analogy, then map each part of the analogy to the real concept.");
      break;
    case "visual":
      parts.push("Describe the idea spatially — as a picture, layout, or motion — so a diagram could be drawn from your words.");
      break;
    case "mathematical":
      parts.push("Express the core relationship precisely, using notation or a formula when it clarifies.");
      break;
    case "practical":
      parts.push("Use a concrete real-world example as the spine of the explanation.");
      break;
    case "socratic":
      parts.push("End by asking one guiding question that leads the learner to the next insight.");
      break;
    case "simple":
    default:
      break;
  }
  switch (profile.time) {
    case "5":
      parts.push("Keep the whole answer tight — around 80 words.");
      break;
    case "15":
      break;
    case "30":
      parts.push("You have room to teach — up to roughly 220 words is fine.");
      break;
    case "deep":
      parts.push("This is a deep dive — teach thoroughly, up to roughly 350 words, structured into sections.");
      break;
  }
  return parts.length ? `How to tailor this answer for THIS learner:\n- ${parts.join("\n- ")}` : "";
}

/** Explain-it-like override (spec §17) — applies to this ask only. */
export function explainLikeDirective(explainLike: string | undefined): string {
  const t = explainLike?.trim();
  return t ? `Reframe the explanation for this request: ${t}.` : "";
}

/**
 * Thinking-mode directives (thinking-spec §2) — each mode changes HOW the answer
 * is produced, not just its label. These are real behavioral instructions.
 */
export function modeDirective(mode: ThinkingMode | undefined): string {
  if (!mode || mode === "explain" || mode === "socratic") return "";
  switch (mode) {
    case "explore":
      return (
        `THINKING MODE: EXPLORE. Map the territory around this question rather than answering narrowly. ` +
        `Name 3-4 related ideas or sub-questions worth pulling on, woven into the prose (not a list), and say in one clause why each matters.`
      );
    case "challenge":
      return (
        `THINKING MODE: CHALLENGE. Treat the given statement/question as a claim under examination. ` +
        `Name its hidden assumptions, give one concrete counterexample or missing-evidence point, and one alternative explanation. ` +
        `Be rigorous, not argumentative — the goal is better reasoning.`
      );
    case "compare":
      return (
        `THINKING MODE: COMPARE. Lay out 2-3 competing explanations, approaches, or schools of thought side by side. ` +
        `For each: its core claim, what evidence supports it, and where it breaks down. Do not declare a winner unless the evidence clearly establishes one.`
      );
    case "debate":
      return (
        `THINKING MODE: DEBATE. Present the strongest case FOR, then the strongest case AGAINST, in clearly marked short passages. ` +
        `End with the single question the learner should resolve to judge between them.`
      );
    case "apply":
      return (
        `THINKING MODE: APPLY. Show the concept working in a concrete real situation: set up the situation, walk the concept through it, and name one thing that would change if conditions differed.`
      );
    case "create":
      return (
        `THINKING MODE: CREATE. Help the learner make something with what they just explored: propose one specific thing to create, the 2-3 steps to start, and the first decision they'd face.`
      );
    case "practice":
      return (
        `THINKING MODE: PRACTICE. Teach in one line, then pose 2 questions of escalating difficulty that test whether the learner truly understands — a recall question and an application question. Do not answer them yet.`
      );
    case "research":
      return (
        `THINKING MODE: RESEARCH. Report what the evidence says. Distinguish clearly: what is well-established, what is inferred, what is disputed among experts, and what remains uncertain. ` +
        `When sources are provided below, attribute claims to them ("According to <source title>..."). Never invent sources.`
      );
  }
}

/** Why-chain directive (thinking-spec §5): answers the NEXT why in the trail. */
export function whyDirective(depth: number): string {
  return (
    `This is step ${depth} of a "why?" chain — the learner keeps drilling into why. ` +
    `Answer the immediately preceding question at the mechanism level one step below, in at most 80 words. ` +
    `End with the natural next "why?" the learner would ask, phrased as a question.`
  );
}

/**
 * Socratic directive (research-spec §6): guide, don't tell. The learner chose
 * "Think with me" — so the answer asks one good question and waits.
 */
export function socraticDirective(step: number): string {
  if (step <= 1) {
    return (
      `THINKING MODE: SOCRATIC — guide the learner to the answer instead of giving it. ` +
      `Briefly frame the problem in at most 2 sentences, then ask ONE opening question that starts from what the learner likely already knows. ` +
      `Do NOT reveal the answer. End with your question.`
    );
  }
  return (
    `THINKING MODE: SOCRATIC, step ${step}. The learner has offered their thinking below. ` +
    `Affirm what is right in one clause, gently redirect what is off, then ask the NEXT guiding question that moves one step closer to the answer. ` +
    `Never give the final answer outright. End with your question.`
  );
}

/**
 * Source-labeling directive (research-spec §2): make the answer auditable.
 * Used in research mode so the model structures claims by evidential status.
 */
export function sourceLabelingDirective(hasSources: boolean): string {
  const base =
    `Structure the answer so its evidence status is auditable. Mark which parts come from the provided sources ("From your sources"), ` +
    `which are general background knowledge ("Additional context"), and which remain uncertain ("Uncertain"). ` +
    `Use those exact phrases as inline lead-ins. Never attribute a claim to a source that does not support it.`;
  if (hasSources) {
    return base + ` When a claim comes from a source, name the source title in parentheses right after the claim.`;
  }
  return (
    base +
    ` No sources were retrieved for this question, so do NOT invent any: mark everything as "Additional context" or "Uncertain" as appropriate.`
  );
}

/** Stage "recall" — active recall / explain-back grading (research-spec §15). */
export const RECALL_SYSTEM = `You output ONLY a JSON object, no other text. Shape:
{"understanding": "strong" | "partial" | "weak", "missing": ["<key element the learner left out, under 10 words>"], "misconception": "<the specific misunderstanding, or empty>", "feedback": "<2-4 sentences: what they got right, what to fill in, one thing to re-check>"}

Grade the learner's explain-back against the source material. Reward correct reasoning even if incomplete — "partial" is common and fine. Never invent elements the source does not contain.`;

export function recallPrompt(sourceText: string, learnerAnswer: string): string {
  return `Source material the learner studied:\n"""\n${sourceText.slice(0, 3000)}\n"""\n\nThe learner's explanation, without looking:\n"""\n${learnerAnswer.slice(0, 1500)}\n"""`;
}

/** Stage "provenance" — audit where the answer's claims actually come from (research-spec §1). */
export const PROVENANCE_SYSTEM = `You are auditing the provenance of a tutor's answer against the learner's own source material. Output ONLY a JSON object. Shape:
{"status": "sourced" | "context" | "uncertain", "quote": "<a short VERBATIM quote from the material that supports the answer, max 120 chars; empty when status is not 'sourced'>"}
Rules:
- "sourced" — the answer's main claims are supported by the material, and you can quote that support.
- "context" — the answer adds reliable general knowledge the material does not itself contain.
- "uncertain" — the answer asserts things the material does not support (or that it only hints at), so the learner should treat them with care.
Never put words in the quote that are not verbatim in the material. If you cannot quote support, do not use "sourced".`;

export function provenancePrompt(question: string, answer: string, materialTitle: string, materialContent: string): string {
  return `Question: ${question}\n\nAnswer given:\n"""\n${answer.slice(0, 2500)}\n"""\n\nSource material: "${materialTitle}"\n"""\n${materialContent.slice(0, 6000)}\n"""\n\nAudit the answer against the material.`;
}

/** Stage "gaps" — missing prerequisites (thinking-spec §19). */
export const GAPS_SYSTEM = `You output ONLY a JSON object, no other text. Shape:
{"gaps": [{"label": "<1-3 word concept name>", "question": "<a question that would teach this prerequisite, under 14 words>"}]}

Look at the learner's question and identify the 1-3 prerequisite ideas which, if not yet understood, would make the question much harder. Only include ideas a learner at this level plausibly has NOT already covered (the conversation context shows what they HAVE covered — do not list those). If nothing is missing, return an empty list.`;

export function gapsPrompt(question: string, chainSummary: string): string {
  return `Learner's question: ${question}\n\nWhat the learner has already explored:\n"""\n${chainSummary.slice(0, 2500)}\n"""`;
}

/** Stage "connections" — cross-canvas conceptual links (thinking-spec §6). */
export const CONNECTIONS_SYSTEM = `You output ONLY a JSON object, no other text. Shape:
{"connections": [{"a_title": "<topic the learner explored>", "b_title": "<other topic>", "why": "<one sentence on the genuine conceptual bridge, under 30 words>", "question": "<a question that would let the learner explore the connection, under 18 words>"}]}

Find at most 2 GENUINE conceptual bridges between the learner's current question and topics they explored before. A real bridge shares a mechanism, principle, or structure — not a vague similarity. If none exist, return an empty list. Never invent topics the learner did not explore.`;

export function connectionsPrompt(currentTopic: string, pastTopics: string): string {
  return `Current question/topic: ${currentTopic}\n\nTopics the learner explored before:\n${pastTopics.slice(0, 2000)}`;
}

/* ---------------- Artifacts (roadmap) — generated STRICTLY from real canvas Q&A ---------------- */

export const ARTIFACT_SYSTEMS: Record<
  "study_guide" | "research_brief" | "timeline" | "flashcard_deck",
  string
> = {
  study_guide: `You output ONLY a JSON object, no other text. Shape:
{"kind": "study_guide", "title": "<3-6 word title for the guide>", "sections": [{"heading": "<2-5 word heading>", "body": "<2-4 sentences>"}]}
Build a study guide with 4-7 sections that teach the explored material as a coherent unit: start with the core idea, then mechanisms/reasons, then applications or consequences, and end with "Common pitfalls" when the Q&A support it. Use ONLY the provided Q&A content — do not add facts the learner never explored. Vary section headings to fit the topic (not rigid templates).`,
  research_brief: `You output ONLY a JSON object, no other text. Shape:
{"kind": "research_brief", "title": "<3-6 word title>", "summary": "<3-5 sentence executive summary of what was explored>", "findings": [{"claim": "<one key finding, <=20 words>", "support": "<what from the Q&A supports it, <=30 words>"}], "open_questions": ["<a question the exploration surfaced but did not answer, <=15 words>"]}
Write a research brief with 3-8 findings. Every claim must be traceable to the provided Q&A — no invented facts. Open questions are genuine gaps the conversation revealed (max 4; empty array if none).`,
  timeline: `You output ONLY a JSON object, no other text. Shape:
{"kind": "timeline", "title": "<3-6 word title>", "entries": [{"when": "<date, era, or phase label>", "what": "<what happened / which stage, <=20 words>"}]}
Build a timeline with 3-12 entries from the explored material, in the correct order. "when" may be a concrete date, a period, or a process phase (e.g. "Phase 2") — whichever the Q&A actually supports. Use ONLY the provided content; never invent dates the Q&A does not contain.`,
  flashcard_deck: `You output ONLY a JSON object, no other text. Shape:
{"kind": "flashcard_deck", "title": "<3-6 word deck title>", "cards": [{"concept": "<1-4 word concept>", "explanation": "<1-3 sentence answer/definition>", "example": "<one concrete example or analogy, <=20 words>"}]}
Turn the explored material into 5-15 flashcards. Each card must be answerable from the provided Q&A alone — no new facts. Prioritize the concepts the learner actually engaged with (questions they asked, terms the answer highlighted).`,
};

export function artifactPrompt(kind: string, qaContent: string): string {
  return `Canvas Q&A the learner actually explored (the ONLY source of facts):\n"""\n${qaContent.slice(0, 14000)}\n""\"\n\nGenerate the artifact for kind "${kind}".`;
}

/* ---------------- Audio recap (roadmap 5) — a short spoken summary of a lesson ---------------- */

/**
 * A recap is SPOKEN, so it must be plain conversational prose: no Markdown, no
 * wikilinks, no lists, no headings — just sentences a text-to-speech voice can
 * deliver naturally. Capped short so a single listen finishes in ~30-60s.
 */
export const RECAP_SYSTEM = `You write a SHORT audio recap of a study session — plain spoken prose that will be read aloud by a text-to-speech voice.
Rules: 3-6 sentences, roughly 70-130 words. Start with "Here's what you learned:" then recap the core ideas the learner actually explored, in plain language, then one sentence pointing at what's still open or worth going deeper.
Do NOT use any Markdown, asterisks, brackets, bullets, numbers as list markers, headings, or emoji. Do NOT invent facts the Q&A does not contain. Write exactly what should be spoken.`;

export function recapPrompt(qaContent: string): string {
  return `Canvas Q&A the learner actually explored (the ONLY source of facts):\n"""\n${qaContent.slice(0, 10000)}\n""\"\n\nWrite the audio recap.`;
}

/** Stage "map" — thinking map generation (thinking-spec §3). */
export const MAP_SYSTEM = `You output ONLY a JSON object, no other text. Shape:
{"title": "<2-6 word name for the whole question space>", "rationale": "<one sentence on why mapping this helps thinking, under 25 words>", "branches": [{"label": "<2-4 word facet name>", "question": "<the concrete question this facet asks, under 16 words>"}]}

Build a thinking map: 4 to 7 branches that decompose the topic into the facets a careful thinker would examine (causes, mechanisms, evidence, counterpoints, applications, open questions...). Branches must be specific to THIS topic — no generic filler. Questions must be genuinely askable.`;

export function mapPrompt(topic: string, context: string): string {
  return `Topic/question to map: ${topic}\n\nWhat the learner has already explored on this canvas:\n"""\n${context.slice(0, 3000)}\n"""`;
}

/** Material grounding (spec §12) — answers stay faithful to the user's content without refusing to teach. */
export function materialGrounding(content: string, title: string): string {
  const clipped = content.slice(0, 9000);
  return [
    `The user is studying from their own material: "${title}".`,
    `When their question is about the material, answer from it and say which parts come from it.`,
    `If the material does not cover what they asked, say plainly that it is not covered in this material — then still teach the concept itself from your own knowledge.`,
    `MATERIAL:\n"""\n${clipped}\n"""`,
  ].join("\n");
}

/**
 * Stage 1.5 — restructure the streamed answer into bite-sized sections (spec §4).
 * One small JSON call; sections adapt to the topic (not rigidly identical).
 * The explanation is ALWAYS provided by the pipeline — sections are a reshaping of
 * real content, never a place to comment on missing content (spec §4, §15/16).
 */
export const SECTIONS_SYSTEM = `You output ONLY a JSON object, no other text. Shape:
{"sections": [{"heading": "<2-5 word heading>", "body": "<1-3 sentences>"}]}

Break the given explanation into 2-4 short sections that best fit THIS topic. Use these headings when they fit, and vary which you include:
- "The concept" — the concise explanation itself
- "Why it matters" — why the concept exists or matters
- "Example" — one concrete instance
- "Mental model" — a simple way to remember it
- "Go deeper" — an optional deeper layer or nuance

Every body must carry forward the important facts from the given explanation — it is a reshaping of real teaching content, never a comment about the task. Preserve the answer's [[key term]] markers when they appear. If the explanation somehow seems thin, extract and present whatever it does contain as the sections; NEVER write sections about missing, absent, or insufficient content. Keep each body under 80 words.`;

export function sectionsPrompt(question: string, answer: string): string {
  return `Question: ${question}\n\nExplanation:\n"""\n${answer.slice(0, 4000)}\n"""`;
}

/** Stage "practice" — exercises generated from real learning material (spec §8). */
export const PRACTICE_SYSTEM = `You output ONLY a JSON object, no other text. Shape:
{"exercises": [<1 to 5 exercise objects>]}

Each exercise is one of:
{"type": "multiple_choice", "question": "...", "options": ["...", "...", "..."], "correct_index": 0, "explanation": "..."}
{"type": "fill_blank", "question": "Sentence with a ___ in it", "answer": "the missing word", "explanation": "..."}
{"type": "order_steps", "question": "Put the steps in order", "steps": ["first", "second", "third"], "explanation": "..."} — steps in CORRECT order, 2-5 steps
{"type": "short_answer", "question": "...", "answer": "a strong model answer", "explanation": "..."}
{"type": "scenario", "question": "A realistic situation requiring the concept...", "answer": "what a good response recognizes or does", "explanation": "..."}

Generate exercises ONLY from the material given. Mix exercise types. Make wrong options plausible.`;

export function practicePrompt(contextText: string, count: number): string {
  return `Generate ${count} practice exercises from this learning material:\n"""\n${contextText.slice(0, 5000)}\n"""`;
}

/** Stage "grade" — adaptive grading (spec §9): mistakes are learning signals. */
export const GRADE_SYSTEM = `You output ONLY a JSON object, no other text. Shape:
{"correct": true|false, "partial": true|false, "feedback": "<2-3 sentences>", "concept": "<short concept label, 1-4 words>"}

Grade the learner's answer against the model answer. Feedback should teach: if wrong, explain the misunderstanding and give a hint or simpler example; if right, reinforce briefly. "partial" is true for partly-correct free-text answers. "concept" labels the idea being tested so weak spots can be tracked.`;

export function gradePrompt(
  exercise: unknown,
  response: unknown,
  sourceContext: string,
): string {
  return `Exercise:\n${JSON.stringify(exercise).slice(0, 2000)}\n\nLearner's response:\n${JSON.stringify(response).slice(0, 1000)}\n\nSource material the exercise came from:\n"""\n${sourceContext.slice(0, 3000)}\n"""`;
}

/** Stage "card" — knowledge card extraction (spec §10). */
export const CARD_SYSTEM = `You output ONLY a JSON object, no other text. Shape:
{"concept": "<short concept name>", "explanation": "<1-3 sentences>", "example": "<one concrete example>"}

Extract THE single most important concept from the material into a reviewable knowledge card. Be faithful to the material.`;

export function cardPrompt(nodeTitle: string, contextText: string): string {
  return `Conversation node: "${nodeTitle}"\n\nMaterial:\n"""\n${contextText.slice(0, 4000)}\n"""`;
}

/** Stage "path" — learning path generation (spec §2, §18). */
export const PATH_SYSTEM = `You output ONLY a JSON object, no other text. Shape:
{"title": "<2-6 word topic name>", "goal": "<one sentence describing where the learner is heading>", "sections": [{"title": "<2-6 word section name>", "points": ["<what this section covers>", "..."]}]}

Build a learning path with 3 to 6 sections ordered from foundations toward the learner's goal. Each section has 2-4 short points. Every point must be specific to THIS topic — no generic study advice.`;

export function pathPrompt(topic: string, profile: LearningProfile | undefined, material: string | null): string {
  const prof = profile
    ? `Learner goal: ${profile.goal}; level: ${profile.level}; time available: ${profile.time} minutes per session.`
    : "";
  const src = material ? `Base the path on this material:\n"""\n${material.slice(0, 6000)}\n"""` : "";
  return [`Topic: ${topic}`, prof, src].filter(Boolean).join("\n\n");
}

/** Builds the ancestor-chain context blurb (verbatim for recent, summaries for old; PRD §6.3). */
export function buildContextBlurb(
  chain: Pick<NodeEntity, "id" | "question" | "answer_text" | "context_summary">[],
): string {
  const recent = chain.slice(-5);
  const older = chain.slice(0, -5);
  const parts: string[] = [];
  const olderSummaries = older
    .map((n) => n.context_summary || "")
    .filter(Boolean)
    .map((s) => `- ${s}`);
  if (olderSummaries.length) {
    parts.push(`Earlier topics (summarized):\n${olderSummaries.join("\n")}`);
  }
  for (const n of recent) {
    parts.push(`Q: ${n.question}\nA: ${n.answer_text.slice(0, 700)}`);
  }
  return parts.join("\n\n");
}
