import test from 'node:test'
import assert from 'node:assert/strict'
import {
  formatNote,
  nextBlockInstruction,
  nextLineInstruction,
  normalizeNextDisplay,
} from '../../src/core/next-block.js'

test('неизвестный режим вывода становится карточкой', () => {
  assert.equal(normalizeNextDisplay('line'), 'line')
  assert.equal(normalizeNextDisplay('off'), 'off')
  assert.equal(normalizeNextDisplay(undefined), 'card')
  assert.equal(normalizeNextDisplay('LINE'), 'card')
  assert.equal(normalizeNextDisplay(42), 'card')
})

test('карточка и строка — разные инструкции', () => {
  assert.match(nextBlockInstruction(true), /openui-lang/)
  assert.doesNotMatch(nextLineInstruction(true), /openui-lang/)
  assert.match(nextLineInstruction(true), /Advisor · /)
  assert.equal(nextLineInstruction(false), '')
})

test('заметка печатается строкой только в режиме line', () => {
  assert.equal(
    formatNote('concern', 'проверь границу', 'line'),
    'Advisor · concern: проверь границу',
  )
  assert.equal(formatNote('nit', 'мелочь', 'card'), '[advisor:nit] мелочь')
  assert.equal(formatNote('blocker', 'стой', 'off'), '[advisor:blocker] стой')
})
