import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { journalFileName, appendRecord, parseJournal, ROTATE_LINES } from '../../src/core/journal.js'

test('имя файла стабильно и различается по локации', () => {
  assert.equal(journalFileName('/a/b'), journalFileName('/a/b'))
  assert.notEqual(journalFileName('/a/b'), journalFileName('/a/c'))
  assert.match(journalFileName('/a/b'), /^journal-[0-9a-f]{8}\.jsonl$/)
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
  assert.deepEqual(recs.map(r => r.at), [1, 2])
})

test('ротация по числу строк оставляет бэкап .1', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'adv-'))
  const p = join(dir, 'journal-x.jsonl')
  writeFileSync(p, Array.from({ length: ROTATE_LINES }, () => '{"at":0}').join('\n') + '\n')
  await appendRecord(p, { at: 1 })
  assert.ok(readFileSync(p + '.1', 'utf8').length > 0)
  assert.equal(parseJournal(readFileSync(p, 'utf8')).length, 1)
})
