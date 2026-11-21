/**
 * Per-session note filter in front of delivery, ported from dsh-advisor's
 * emission guard: a repeat at the same or lower severity never reaches the
 * agent twice, while a real escalation (nit → concern → blocker) still does.
 * Content-free notes are dropped too — they tell the agent nothing to do.
 */
const SEVERITY_RANK = { nit: 0, concern: 1, blocker: 2 };

const CONTENT_FREE_PHRASES = new Set([
  "stop",
  "done",
  "complete",
  "no issue continue",
  "lgtm",
  "nothing to add",
  "ok",
  "okay",
  "good",
  "fine",
  "looks good",
  "looks fine",
  "all good",
  "all clear",
  "no issue",
  "no issues",
  "nothing",
  "ок",
  "окей",
  "хорошо",
  "все хорошо",
  "нет замечаний",
  "замечаний нет",
  "все в порядке",
]);

const MAX_HISTORY = 4096;

/** Identity key of a note: case, punctuation and spacing do not matter. */
export function normalizeNote(text) {
  return String(text ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** Accepts a note for delivery; returns false for repeats and empty ones. */
export function createEmissionGuard() {
  const history = new Map();
  return {
    accept(note) {
      const key = normalizeNote(note?.note);
      if (key === "") return false;
      if (CONTENT_FREE_PHRASES.has(key)) return false;
      const rank = SEVERITY_RANK[note?.severity] ?? 1;
      const prior = history.get(key);
      if (prior !== undefined && rank <= prior) return false;
      history.set(key, rank);
      if (history.size > MAX_HISTORY) {
        const oldest = history.keys().next().value;
        if (oldest !== undefined) history.delete(oldest);
      }
      return true;
    },
    reset() {
      history.clear();
    },
  };
}
