import test from 'node:test'
import assert from 'node:assert/strict'
import { buildNextPromptPrompt, parseSuggestion } from '../../src/core/next-prompt.js'

test('NONE и пустота не дают предложения', () => {
  assert.equal(parseSuggestion('NONE'), null)
  assert.equal(parseSuggestion('   '), null)
  assert.equal(parseSuggestion('...'), null)
})

test('кавычки снимаются, берётся первая непустая строка', () => {
  assert.equal(parseSuggestion('\n"Проверь сборку"\nвторая строка'), 'Проверь сборку')
  assert.equal(parseSuggestion('«Запусти тесты»'), 'Запусти тесты')
})

test('длина ограничена конфигом и краями диапазона', () => {
  const long = 'а'.repeat(300)
  assert.equal([...parseSuggestion(long, 60)].length, 60)
  assert.equal([...parseSuggestion(long, 1)].length, 50)
  assert.equal([...parseSuggestion(long, 5000)].length, 300)
})

test('промпт содержит ходы', () => {
  assert.match(buildNextPromptPrompt('человек: привет'), /человек: привет/)
})
