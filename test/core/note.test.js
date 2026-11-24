import test from 'node:test'
import assert from 'node:assert/strict'
import { formatNote } from '../../src/core/note.js'

test('совет — одна строка с уровнем', () => {
  assert.equal(
    formatNote('concern', 'проверь граничный случай'),
    'Advisor · concern: проверь граничный случай',
  )
})

test('все три уровня дают одинаковый префикс', () => {
  for (const severity of ['nit', 'concern', 'blocker']) {
    assert.match(
      formatNote(severity, 'x'),
      /^Advisor · (nit|concern|blocker): x$/,
    )
  }
})
