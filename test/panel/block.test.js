import test from 'node:test'
import assert from 'node:assert/strict'
import { pickBlockSuggestion } from '../../src/block/main.js'
import {
  NEXT_BLOCK_INSTRUCTION,
  nextBlockInstruction,
} from '../../src/core/next-block.js'

test('карточка берёт последнюю подсказку своей сессии', () => {
  const items = [
    { at: 1, text: 'старое', sessionID: 'a' },
    { at: 5, text: 'новое', sessionID: 'a' },
    { at: 9, text: 'чужое', sessionID: 'b' },
    { at: 7, text: '   ', sessionID: 'a' },
  ]
  assert.equal(pickBlockSuggestion(items, 'a')?.text, 'новое')
  assert.equal(pickBlockSuggestion(items, 'b')?.text, 'чужое')
  assert.equal(pickBlockSuggestion(items, 'c'), null)
})

test('скрытая подсказка не возвращается', () => {
  const items = [{ at: 5, text: 'новое', sessionID: 'a' }]
  assert.equal(pickBlockSuggestion(items, 'a', 5), null)
  assert.equal(pickBlockSuggestion(items, 'a', 4)?.text, 'новое')
})

test('инструкция выключена вместе с подсказкой', () => {
  assert.equal(nextBlockInstruction(false), '')
  assert.equal(nextBlockInstruction(true), NEXT_BLOCK_INSTRUCTION)
  assert.match(NEXT_BLOCK_INSTRUCTION, /AdvisorNext\(\)/)
})
