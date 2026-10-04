import { describe, it, expect } from "vitest";
import { Exercise } from "@canvas-learn/shared";
import { PracticeRepo, CardRepo } from "../src/db/learningRepos.js";
import { StatsRepo } from "../src/db/stats.js";
import { createDb } from "../src/db/client.js";
import { runMigrations } from "../src/db/migrate.js";
import type { PracticeAttempt, KnowledgeCard } from "@canvas-learn/shared";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function makeDeps() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "canvas-learn-"));
  const { sqlite, db, close } = createDb(path.join(dir, "t.db"));
  runMigrations(sqlite);
  const practice = new PracticeRepo(db);
  const cards = new CardRepo(db);
  const stats = new StatsRepo(db, practice, cards, () => 0);
  return { practice, cards, stats, dir, close };
}

const mcExercise = {
  type: "multiple_choice" as const,
  question: "Which process turns water into vapor?",
  options: ["Condensation", "Evaporation", "Precipitation"],
  correct_index: 1,
  explanation: "Evaporation is liquid → vapor.",
};

const freeExercise = {
  type: "short_answer" as const,
  question: "Explain condensation in your own words.",
  answer: "Vapor cools and turns back into liquid, forming droplets.",
  explanation: "Should mention cooling and liquid formation.",
};

describe("exercise schema", () => {
  it("accepts a valid multiple-choice exercise and rejects a bad index", () => {
    expect(Exercise.safeParse(mcExercise).success).toBe(true);
    expect(Exercise.safeParse({ ...mcExercise, correct_index: 9 }).success).toBe(false);
  });

  it("requires steps in order_steps to have at least 2 entries", () => {
    expect(
      Exercise.safeParse({ type: "order_steps", question: "q", steps: ["a"], explanation: "e" }).success,
    ).toBe(false);
    expect(
      Exercise.safeParse({ type: "order_steps", question: "q", steps: ["a", "b"], explanation: "e" }).success,
    ).toBe(true);
  });
});

describe("practice attempts + weak concepts", () => {
  it("stores attempts and aggregates misses by concept", () => {
    const { practice, dir, close } = makeDeps();
    const base = { canvas_id: null, node_id: null, exercise: freeExercise as unknown as PracticeAttempt["exercise"] };
    const mk = (concept: string, correct: boolean): PracticeAttempt => ({
      ...base,
      id: crypto.randomUUID(),
      response: "vapor cools",
      correct,
      graded: { correct, partial: false, feedback: "", concept },
      created_at: Date.now(),
    });
    practice.insert(mk("condensation", false));
    practice.insert(mk("condensation", false));
    practice.insert(mk("evaporation", false));
    practice.insert(mk("evaporation", true));
    const weak = practice.weakConcepts();
    expect(weak[0]).toEqual({ concept: "condensation", misses: 2 });
    close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("stats expose accuracy only after graded attempts exist", () => {
    const { practice, stats, dir, close } = makeDeps();
    expect(stats.learning().accuracy).toBeNull();
    const attempt: PracticeAttempt = {
      id: crypto.randomUUID(),
      node_id: null,
      canvas_id: null,
      exercise: mcExercise,
      response: 1,
      correct: true,
      graded: { correct: true, partial: false, feedback: "", concept: "evaporation" },
      created_at: Date.now(),
    };
    practice.insert(attempt);
    const s = stats.learning();
    expect(s.accuracy).toBe(100);
    expect(s.attempts_count).toBe(1);
    close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe("knowledge cards", () => {
  it("review spacing grows after correct answers and resets after misses", () => {
    const { cards, dir, close } = makeDeps();
    const card: KnowledgeCard = {
      id: crypto.randomUUID(),
      node_id: null,
      canvas_id: null,
      concept: "Condensation",
      explanation: "Vapor becomes liquid when it cools.",
      example: "Dew on morning grass.",
      source: "Test",
      notes: "",
      due_at: Date.now() - 1000,
      times_reviewed: 0,
      last_reviewed_at: null,
      created_at: Date.now(),
    };
    cards.insert(card);
    const afterGood = cards.review(card.id, true)!;
    const afterGreat = cards.review(card.id, true)!;
    expect(afterGreat.due_at).toBeGreaterThan(afterGood.due_at);
    expect(afterGreat.times_reviewed).toBe(2);
    const afterMiss = cards.review(card.id, false)!;
    expect(afterMiss.due_at).toBeLessThan(afterGreat.due_at);
    expect(afterMiss.times_reviewed).toBe(3);
    close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
