import { createHash } from 'node:crypto'
import { appendFile, mkdir, readFile, rename, rm, stat } from 'node:fs/promises'
import { dirname } from 'node:path'

export const ROTATE_BYTES = 1_000_000
export const ROTATE_LINES = 5000

const defaultFs = { appendFile, mkdir, readFile, rename, rm, stat }

/** Journal file for one project location: `journal-<8 hex>.jsonl`. */
export function journalFileName(locationDir) {
  const hash = createHash('sha256').update(String(locationDir ?? '')).digest('hex').slice(0, 8)
  return `journal-${hash}.jsonl`
}

function countLines(text) {
  let lines = 0
  for (const line of text.split('\n')) {
    if (line.trim() !== '') lines += 1
  }
  return lines
}

/**
 * Appends one JSON line. Rotates the file to `.1` first when the next write
 * would pass the byte cap or the line cap. Only appends: a reader never sees a
 * rewritten file.
 */
export async function appendRecord(path, record, fsOps = defaultFs) {
  const line = JSON.stringify(record) + '\n'
  const bytes = Buffer.byteLength(line, 'utf8')

  await fsOps.mkdir(dirname(path), { recursive: true })

  let size = 0
  let lines = 0
  try {
    const info = await fsOps.stat(path)
    size = info.size
    if (size > 0) lines = countLines(await fsOps.readFile(path, 'utf8'))
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }

  if (size > 0 && (size + bytes > ROTATE_BYTES || lines >= ROTATE_LINES)) {
    try {
      await fsOps.rename(path, `${path}.1`)
    } catch (error) {
      if (error?.code !== 'EEXIST' && error?.code !== 'EPERM') throw error
      await fsOps.rm(`${path}.1`, { force: true })
      await fsOps.rename(path, `${path}.1`)
    }
  }

  await fsOps.appendFile(path, line)
}

/** Reads a journal tail, skipping blank and broken lines. */
export function parseJournal(text) {
  const records = []
  for (const line of String(text ?? '').split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '') continue
    try {
      const value = JSON.parse(trimmed)
      if (value && typeof value === 'object' && !Array.isArray(value)) records.push(value)
    } catch {
      // A half-written line from a crash: skip it, keep the rest.
    }
  }
  return records
}
