import { appendFile, mkdir, readFile, rename, stat } from 'node:fs/promises'
import { dirname } from 'node:path'
import {
  countJournalLines,
  journalFileName,
  parseJournal,
  ROTATE_BYTES,
  ROTATE_LINES,
} from './journal-format.js'

export { journalFileName, parseJournal, ROTATE_BYTES, ROTATE_LINES }

const nodeFs = { appendFile, mkdir, readFile, rename, stat }

/**
 * Line count of the file as this process last left it. Counting means reading
 * the whole journal, and the journal is read on every advice: without this the
 * price of one note grows with the history it already holds. A `stat` size that
 * no longer matches the entry (another instance appended, the file rotated)
 * makes the next append recount once and store the new value.
 */
const known = new Map()

/** Appends one JSON line, rotating to `.1` first when the file is at its cap. */
export async function appendRecord(path, record, fsOps = nodeFs) {
  const line = JSON.stringify(record) + '\n'
  const bytes = Buffer.byteLength(line, 'utf8')

  await fsOps.mkdir(dirname(path), { recursive: true })

  let size = 0
  let lines = 0
  try {
    const info = await fsOps.stat(path)
    size = info.size
    if (size > 0) {
      const cached = known.get(path)
      lines =
        cached && cached.size === size
          ? cached.lines
          : countJournalLines(await fsOps.readFile(path, 'utf8'))
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }

  if (size > 0 && (size + bytes > ROTATE_BYTES || lines >= ROTATE_LINES)) {
    // Another process may have rotated between our stat and this rename; the
    // record still belongs in a fresh file, so a lost race is not an error.
    await fsOps.rename(path, `${path}.1`).catch((error) => {
      if (error?.code !== 'ENOENT') throw error
    })
    size = 0
    lines = 0
  }

  await fsOps.appendFile(path, line)
  known.set(path, { size: size + bytes, lines: lines + 1 })
}
