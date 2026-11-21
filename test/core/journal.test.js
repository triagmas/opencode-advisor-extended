import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  journalFileName,
  appendRecord,
  parseJournal,
  ROTATE_LINES,
} from '../../src/core/journal.js'
import { suggestionFileName } from '../../src/core/journal-format.js'

test('имя файла стабильно и различается по локации', () => {
  assert.equal(journalFileName('/a/b'), journalFileName('/a/b'))
  assert.notEqual(journalFileName('/a/b'), journalFileName('/a/c'))
  assert.match(journalFileName('/a/b'), /^journal-[0-9a-f]{8}\.jsonl$/)
})

test('у каждого сеанса свой файл подсказки', () => {
  assert.match(
    suggestionFileName('/a/b', 'ses_1'),
    /^suggestion-[0-9a-f]{8}-ses_1\.json$/,
  )
  assert.notEqual(
    suggestionFileName('/a/b', 'ses_1'),
    suggestionFileName('/a/b', 'ses_2'),
  )
  assert.equal(
    suggestionFileName('/a/b', '../x'),
    suggestionFileName('/a/b', 'x'),
  )
})

test('дозапись добавляет строку', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'adv-'))
  const p = join(dir, 'journal-x.jsonl')
  await appendRecord(p, { at: 1, note: 'a' })
  await appendRecord(p, { at: 2, note: 'b' })
  const lines = readFileSync(p, 'utf8').trim().split('\n')
  assert.equal(lines.length, 2)
  assert.equal(JSON.parse(lines[1]).note, 'b')
})

test('битая строка не ломает разбор остальных', () => {
  const recs = parseJournal('{"at":1}\n{битая\n{"at":2}\n')
  assert.deepEqual(
    recs.map((r) => r.at),
    [1, 2],
  )
})

test('ротация по числу строк оставляет бэкап .1', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'adv-'))
  const p = join(dir, 'journal-x.jsonl')
  writeFileSync(
    p,
    Array.from({ length: ROTATE_LINES }, () => '{"at":0}').join('\n') + '\n',
  )
  await appendRecord(p, { at: 1 })
  assert.ok(readFileSync(p + '.1', 'utf8').length > 0)
  assert.equal(parseJournal(readFileSync(p, 'utf8')).length, 1)
})

test('журнал не перечитывается, пока файл не изменился извне', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'adv-'))
  const p = join(dir, 'journal-cache.jsonl')
  let reads = 0
  const fsOps = {
    mkdir: async (...args) => (await import('node:fs/promises')).mkdir(...args),
    stat: async (...args) => (await import('node:fs/promises')).stat(...args),
    readFile: async (...args) => {
      reads += 1
      return (await import('node:fs/promises')).readFile(...args)
    },
    rename: async (...args) => (await import('node:fs/promises')).rename(...args),
    appendFile: async (...args) =>
      (await import('node:fs/promises')).appendFile(...args),
  }

  await appendRecord(p, { at: 1 }, fsOps)
  await appendRecord(p, { at: 2 }, fsOps)
  assert.equal(reads, 0, 'ни одного чтения: файл создаётся этим процессом')

  writeFileSync(p, readFileSync(p, 'utf8') + '{"at":3}\n')
  await appendRecord(p, { at: 4 }, fsOps)
  assert.equal(reads, 1, 'внешняя дозапись заставляет пересчитать строки один раз')

  const rows = readFileSync(p, 'utf8').trim().split('\n')
  assert.deepEqual(
    rows.map((line) => JSON.parse(line).at),
    [1, 2, 3, 4],
  )
})

test('замена файла тем же размером не даёт взять старый счётчик строк', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'adv-'))
  const p = join(dir, 'journal-swap.jsonl')
  let reads = 0
  const fsp = await import('node:fs/promises')
  const fsOps = {
    mkdir: async (...args) => fsp.mkdir(...args),
    stat: async (...args) => fsp.stat(...args),
    readFile: async (...args) => {
      reads += 1
      return fsp.readFile(...args)
    },
    rename: async (...args) => fsp.rename(...args),
    appendFile: async (...args) => fsp.appendFile(...args),
  }

  await appendRecord(p, { at: 1 }, fsOps)
  const first = readFileSync(p, 'utf8')

  // Same bytes, different file: a rotation by another instance, or a journal
  // replaced wholesale. The rename gives a new inode, so the count must come
  // from the new file; the timestamp is pushed forward for filesystems that
  // report whole seconds only.
  const swapped = join(dir, 'journal-swap.tmp')
  writeFileSync(swapped, first.replace('{"at":1}', '{"at":9}'))
  const later = new Date(Date.now() + 2000)
  await fsp.utimes(swapped, later, later)
  await fsp.rename(swapped, p)
  await appendRecord(p, { at: 2 }, fsOps)

  assert.equal(reads, 1)
  const rows = readFileSync(p, 'utf8').trim().split('\n')
  assert.deepEqual(
    rows.map((line) => JSON.parse(line).at),
    [9, 2],
  )
})
