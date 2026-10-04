import {
  fsrs,
  generatorParameters,
  createEmptyCard,
  type Card,
  type Grade,
  type RecordLogItem,
} from "ts-fsrs";
import type { ReviewState } from "@canvas-learn/shared";

/**
 * FSRS scheduling (PRD FR17–FR19) built on ts-fsrs.
 * Maps the shared ReviewState (PRD §4.1) to/from the ts-fsrs Card, and keeps
 * the PRD's interval_days/ease fields populated for display/back-compat.
 */
export class FsrsScheduler {
  private f;

  constructor(params = {}) {
    // enable_short_term=false → grades schedule in days, not intraday minutes
    // (the PRD's daily-review loop has no intraday steps).
    this.f = fsrs(generatorParameters({ enable_short_term: false, ...params }));
  }

  /** Initial review_state for a brand-new node (due in ~1 day per PRD FR17). */
  initial(): ReviewState {
    const card = createEmptyCard(new Date());
    const due = Date.now() + 1 * 86400_000;
    return {
      due_at: due,
      interval_days: 1,
      ease: 2.5,
      stability: card.stability ?? 0,
      difficulty: card.difficulty ?? 0,
      last_reviewed_at: null,
      times_reviewed: 0,
    };
  }

  private toCard(rs: ReviewState): Card {
    // FSRS expects New-state cards to be due now; the node-level +1 day queue
    // (PRD FR17) is tracked separately in review_state.due_at.
    const due = rs.times_reviewed === 0 ? new Date() : new Date(rs.due_at);
    return {
      due,
      stability: rs.stability || undefined as unknown as number,
      difficulty: rs.difficulty || undefined as unknown as number,
      elapsed_days: 0,
      scheduled_days: Math.max(0, Math.round(rs.interval_days)),
      reps: rs.times_reviewed,
      lapses: 0,
      state: rs.times_reviewed === 0 ? 0 : 2, // New : Review
      last_review: rs.last_reviewed_at ? new Date(rs.last_reviewed_at) : undefined,
    } as Card;
  }

  private fromCard(card: Card, prev: ReviewState): ReviewState {
    return {
      due_at: card.due.getTime(),
      interval_days: Math.max(0, card.scheduled_days),
      ease: prev.ease,
      stability: card.stability ?? 0,
      difficulty: card.difficulty ?? 0,
      last_reviewed_at: card.last_review ? card.last_review.getTime() : Date.now(),
      times_reviewed: prev.times_reviewed + 1,
    };
  }

  /** Apply a self-rating (Again/Hard/Good/Easy → FR19) and return the updated review state. */
  grade(rs: ReviewState, grade: "again" | "hard" | "good" | "easy"): ReviewState {
    const grades: Record<string, Grade> = { again: 1, hard: 2, good: 3, easy: 4 };
    // First review: use the library's canonical empty New card; later reviews: restore state.
    const card = rs.times_reviewed === 0 ? createEmptyCard(new Date()) : this.toCard(rs);
    const now = new Date();
    const log: RecordLogItem = this.f.repeat(card, now)[grades[grade]!] as RecordLogItem;
    return this.fromCard(log.card, rs);
  }
}
