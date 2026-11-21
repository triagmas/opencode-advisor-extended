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
    if (size > 0) lines = countJournalLines(await fsOps.readFile(path, 'utf8'))
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }

  if (size > 0 && (size + bytes > ROTATE_BYTES || lines >= ROTATE_LINES)) {
    await fsOps.rename(path, `${path}.1`)
  }

  await fsOps.appendFile(path, line)
}
