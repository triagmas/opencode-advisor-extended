/** Root, non-archived sessions only: subagents neither get advice nor pay twice. */
export function shouldReview(session) {
  if (!session) return false
  if (session.parentID) return false
  if (session.archived) return false
  return true
}

/**
 * A review may run when the reviewer is on, no call is in flight, the session
 * is not switched off, and the cooldown from the last advice has run out.
 */
export function canReview(state, config, _now = Date.now()) {
  if (!config?.enabled) return false
  if (!state || state.disabled) return false
  if (state.inFlight) return false
  return (state.turns ?? 0) >= (state.immuneTurns ?? 0)
}

/** Starts the cooldown: the next `immuneTurns` steps are not reviewed. */
export function markReviewed(state, now, immuneTurns) {
  state.turns = 0
  state.immuneTurns = immuneTurns
  state.inFlight = false
  state.cooldownUntil = now
}
