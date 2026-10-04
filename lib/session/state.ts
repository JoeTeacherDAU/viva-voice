import type { SessionEvent, SessionRecord } from "@/lib/analysis/types";

export const SCORE_MIN = 1;
export const SCORE_MAX = 5;

export type SessionAction =
  | { type: "start"; atMs: number }
  | { type: "stop"; atMs: number }
  | { type: "score"; value: number; atMs: number }
  | { type: "event"; event: SessionEvent }
  | { type: "done" };

/**
 * Session state machine: setup -> live -> closing -> done. Every action that
 * changes the record also appends an event, so the record keeps an audit
 * trail. An action that does not fit the current state returns the record
 * unchanged.
 */
export function reduce(rec: SessionRecord, action: SessionAction): SessionRecord {
  const state = rec.state ?? "setup";
  const withEvent = (r: SessionRecord, e: SessionEvent): SessionRecord => ({
    ...r,
    events: [...r.events, e],
  });

  switch (action.type) {
    case "start":
      if (state !== "setup") return rec;
      return withEvent(
        { ...rec, state: "live", markers: { startMs: action.atMs, stopMs: null } },
        { type: "start", atMs: action.atMs },
      );
    case "stop":
      if (state !== "live") return rec;
      return withEvent(
        { ...rec, state: "closing", markers: { ...rec.markers, stopMs: action.atMs } },
        { type: "stop", atMs: action.atMs },
      );
    case "score": {
      // docs/rulings.md R4: five buttons, 1 to 5. A later tap changes the
      // value and keeps the first timestamp.
      if (state !== "live") return rec;
      if (!Number.isInteger(action.value) || action.value < SCORE_MIN || action.value > SCORE_MAX)
        return rec;
      const atMs = rec.instructorLiveScore?.atMs ?? action.atMs;
      return withEvent(
        { ...rec, instructorLiveScore: { value: action.value, atMs } },
        { type: "score", atMs: action.atMs, detail: { value: action.value } },
      );
    }
    case "event":
      return withEvent(rec, action.event);
    case "done":
      if (state !== "closing") return rec;
      return { ...rec, state: "done" };
  }
}
