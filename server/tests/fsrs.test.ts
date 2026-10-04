import { describe, it, expect } from "vitest";
import { FsrsScheduler } from "../src/review/fsrs.js";
import { StatsRepo } from "../src/db/stats.js";
import { PracticeRepo } from "../src/db/learningRepos.js";
import { createDb } from "../src/db/client.js";
import { runMigrations } from "../src/db/migrate.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

describe("FsrsScheduler", () => {
  it("initial state is due in ~1 day and never reviewed", () => {
    const s = new FsrsScheduler().initial();
    expect(s.times_reviewed).toBe(0);
    expect(s.due_at).toBeGreaterThan(Date.now());
    expect(s.due_at - Date.now()).toBeLessThan(2 * 86400_000);
  });

  it("a Good grade pushes the due date further out and counts the review", () => {
    const f = new FsrsScheduler();
    const initial = f.initial();
    const graded = f.grade(initial, "good");
    expect(graded.times_reviewed).toBe(1);
    expect(graded.due_at).toBeGreaterThan(initial.due_at);
    expect(graded.interval_days).toBeGreaterThan(initial.interval_days);
  });

  it("Again reschedules sooner than Good", () => {
    const f = new FsrsScheduler();
    const initial = f.initial();
    const again = f.grade(initial, "again");
    const good = f.grade(initial, "good");
    expect(again.due_at).toBeLessThan(good.due_at);
  });
});

describe("StatsRepo streak logic", () => {
  function makeStats() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "canvas-stats-"));
    const { sqlite, db, close } = createDb(path.join(dir, "t.db"));
    runMigrations(sqlite);
    const practice = new PracticeRepo(db);
    const stats = new StatsRepo(db, practice, { list: () => [], due: () => [] } as any, () => 0);
    return { stats, dir, close };
  }

  it("first activity starts a streak of 1", () => {
    const { stats, dir, close } = makeStats();
    stats.registerActivity();
    expect(stats.getStats().streak_count).toBe(1);
    close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("same-day activity does not double-count", () => {
    const { stats, dir, close } = makeStats();
    stats.registerActivity();
    stats.registerActivity();
    expect(stats.getStats().streak_count).toBe(1);
    close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("stars accumulate", () => {
    const { stats, dir, close } = makeStats();
    stats.addStars(1);
    stats.addStars(2);
    expect(stats.getStats().stars_count).toBe(3);
    close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
