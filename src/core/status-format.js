export const STALE_AFTER_MS = 30_000

export function emptyCounters() {
  return { calls: 0, drops: { empty: 0, unparsed: 0, error: 0 } }
}

/** New heartbeat state from the previous one and a patch, stamped with `now`. */
export function buildStatus(prev = {}, patch = {}, now = Date.now()) {
  const base = { ...emptyCounters(), ...prev }
  return {
    ...base,
    ...patch,
    drops: { ...base.drops, ...(patch.drops ?? {}) },
    at: now,
  }
}

/** A heartbeat older than the TTL means the plugin is not running. */
export function isStale(status, now, ttlMs = STALE_AFTER_MS) {
  if (!status || typeof status.at !== 'number') return true
  return now - status.at > ttlMs
}
