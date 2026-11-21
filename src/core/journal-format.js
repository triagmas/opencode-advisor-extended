import { createHash } from 'node:crypto'

export const ROTATE_BYTES = 1_000_000
export const ROTATE_LINES = 5000

/** Journal file for a project location: different worktrees never share one file. */
export function journalFileName(locationDir) {
  const digest = createHash('sha256').update(String(locationDir ?? '')).digest('hex')
  return `journal-${digest.slice(0, 8)}.jsonl`
}

/** Records from a journal text; broken or half-written lines are skipped. */
export function parseJournal(text) {
  const records = []
  for (const line of String(text ?? '').split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '') continue
    try {
      const record = JSON.parse(trimmed)
      if (record && typeof record === 'object') records.push(record)
    } catch {
      // A half-written line from a crash: the rest of the file is still good.
    }
  }
  return records
}

export function countJournalLines(text) {
  let lines = 0
  for (const line of String(text ?? '').split('\n')) {
    if (line.trim() !== '') lines += 1
  }
  return lines
}
