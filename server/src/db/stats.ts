import type { LearningStats, AppStats } from "@canvas-learn/shared";
import type { Db } from "./client.js";
import { appState, nodes } from "./schema.js";
import { eq, sql } from "drizzle-orm";
import { PracticeRepo, CardRepo } from "./learningRepos.js";

/**
 * App-global stats (ADR-001) plus real learning metrics (spec §19).
 * Every number is computed from stored data; accuracy stays null until
 * at least one graded practice attempt exists — nothing is fabricated.
 */
export class StatsRepo {
  private appStateTable = appState;

  constructor(
    private db: Db,
    private practice: PracticeRepo,
    private cards: CardRepo,
    private dueNodes: () => number,
  ) {}

  /** Legacy/global counters shown in the sidebar (real values only). */
  getStats(): AppStats {
    return {
      streak_count: Number(this.get("streak_count")?.value ?? 0),
      stars_count: Number(this.get("stars_count")?.value ?? 0),
      last_active_date: this.get("last_active_date")?.value ?? "",
      due_count: this.dueNodes(),
    };
  }

  registerActivity() {
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const last = this.get("last_active_date")?.value;
    if (last === today) return;
    const streak = last === yesterday ? Number(this.get("streak_count")?.value ?? 0) + 1 : 1;
    this.set("last_active_date", today);
    this.set("streak_count", String(streak));
  }

  addStars(n: number) {
    const current = Number(this.get("stars_count")?.value ?? 0);
    this.set("stars_count", String(current + n));
  }

  private get(key: string): { value: string } | undefined {
    return this.db.select().from(this.appStateTable).where(eq(this.appStateTable.key, key)).get();
  }

  private set(key: string, value: string) {
    this.db
      .insert(this.appStateTable)
      .values({ key, value })
      .onConflictDoUpdate({ target: this.appStateTable.key, set: { value } })
      .run();
  }

  learning(): LearningStats {
    const completed = this.db
      .select({ n: sql<number>`COUNT(*)` })
      .from(nodes)
      .where(eq(nodes.status, "complete"))
      .get();
    const { attempts, correct } = this.practice.stats();
    return {
      concepts_explored: completed?.n ?? 0,
      cards_count: this.cards.list().length,
      due_count: this.cards.due(Date.now()).length,
      attempts_count: attempts,
      correct_count: correct,
      accuracy: attempts > 0 ? Math.round((correct / attempts) * 100) : null,
      weak_concepts: this.practice.weakConcepts(),
    };
  }
}
