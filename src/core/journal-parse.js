/** Records from journal text; blank and half-written lines are skipped. */
export function parseJournal(text) {
  const records = []
  for (const line of String(text ?? '').split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '') continue
    try {
      const record = JSON.parse(trimmed)
      if (record && typeof record === 'object' && !Array.isArray(record)) records.push(record)
    } catch {
      // A line cut by a crash must not cost the rest of the file.
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
