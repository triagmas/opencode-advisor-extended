import { createHash } from 'node:crypto'
import { countJournalLines, parseJournal } from './journal-parse.js'

export { countJournalLines, parseJournal }

export const ROTATE_BYTES = 1_000_000
export const ROTATE_LINES = 5000

/** Journal file for a project location: different worktrees never share one file. */
export function journalFileName(locationDir) {
  const digest = createHash('sha256')
    .update(String(locationDir ?? ''))
    .digest('hex')
  return `journal-${digest.slice(0, 8)}.jsonl`
}

/**
 * Next-prompt suggestion of one session. Two sessions in the same folder each
 * keep their own file, so one never hides the other's card.
 */
export function suggestionFileName(locationDir, sessionID = '') {
  const base = journalFileName(locationDir)
    .replace('journal-', 'suggestion-')
    .replace('.jsonl', '')
  const safe = String(sessionID ?? '').replace(/[^A-Za-z0-9_-]/g, '')
  return safe ? `${base}-${safe}.json` : `${base}.json`
}
