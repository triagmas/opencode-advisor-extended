import { createHash } from 'node:crypto'
import { countJournalLines, parseJournal } from './journal-parse.js'

export { countJournalLines, parseJournal }

export const ROTATE_BYTES = 1_000_000
export const ROTATE_LINES = 5000

/** Journal file for a project location: different worktrees never share one file. */
export function journalFileName(locationDir) {
  const digest = createHash('sha256').update(String(locationDir ?? '')).digest('hex')
  return `journal-${digest.slice(0, 8)}.jsonl`
}

/** Next-prompt suggestion for the same location, written for the panel. */
export function suggestionFileName(locationDir) {
  return journalFileName(locationDir).replace('journal-', 'suggestion-').replace('.jsonl', '.json')
}
