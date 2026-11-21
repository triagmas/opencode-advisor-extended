import { createHash } from 'node:crypto'
import {
  buildStatus,
  emptyCounters,
  isStale,
  STALE_AFTER_MS,
} from './status-format.js'

export { buildStatus, emptyCounters, isStale, STALE_AFTER_MS }

/** Heartbeat file for one project location. */
export function statusFileName(locationDir) {
  const digest = createHash('sha256')
    .update(String(locationDir ?? ''))
    .digest('hex')
  return `status-${digest.slice(0, 8)}.json`
}
