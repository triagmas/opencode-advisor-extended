import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { settingsFormValues } from '../../src/panel/view.js'
import { buildJournalView, mergeRecords, connectionState } from '../../src/panel/view.js'

const rec = (sessionID, at, severity = 'nit') => ({ kind: 'advice', sessionID, at, severity, note: `${severity} @${at}` })

test('журнал фильтруется по сессии и сортируется новыми вверх', () => {
  const v = buildJournalView({ records: [rec('a', 1), rec('b', 2), rec('a', 3)], sessionID: 'a', allProjects: false })
  assert.deepEqual(v.rows.map(r => r.at), [3, 1])
  assert.equal(v.empty, false)
})

test('пустой журнал помечается отдельно', () => {
  assert.equal(buildJournalView({ records: [], sessionID: 'a', allProjects: false }).empty, true)
})

test('склейка файлов разных локаций', () => {
  const merged = mergeRecords([[rec('a', 1)], [rec('a', 2), rec('a', 2)]])
  assert.deepEqual(merged.map(r => r.at), [1, 2])
})

test('состояние связи по heartbeat', () => {
  assert.equal(connectionState(undefined, 10), 'missing')
  assert.equal(connectionState({ at: 0 }, 29_000), 'live')
  assert.equal(connectionState({ at: 0 }, 31_000), 'stale')
})

test('поля настроек показывают дефолты и сохраняют явный ноль', () => {
  const defaults = { provider: '', model: '', immuneTurns: 3, maxDeltaMessages: 60, noteMaxChars: 768 }
  assert.deepEqual(settingsFormValues({ provider: 'p', model: 'm' }, null, defaults), {
    provider: 'p',
    model: 'm',
    immuneTurns: '3',
    maxDeltaMessages: '60',
    noteMaxChars: '768',
  })
  assert.equal(settingsFormValues({ immuneTurns: 0 }, null, defaults).immuneTurns, '0')
  assert.equal(settingsFormValues({}, { maxDeltaMessages: 5 }, defaults).maxDeltaMessages, '5')
})

test('варианты кнопок панели есть в SDK', () => {
  const source = readFileSync(new URL('../../src/panel/main.js', import.meta.url), 'utf8')
  const allowed = new Set(['default', 'secondary', 'outline', 'ghost', 'destructive'])
  const used = [...source.matchAll(/variant:\s*'([a-z]+)'/g)].map((match) => match[1])
  assert.ok(used.length > 0, 'panel mounts buttons')
  for (const variant of used) {
    assert.ok(allowed.has(variant), `unknown ButtonVariant: ${variant}`)
  }
})
