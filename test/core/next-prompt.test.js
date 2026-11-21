import test from 'node:test'
import assert from 'node:assert/strict'
import { buildNextPromptPrompt, parseSuggestion } from '../../src/core/next-prompt.js'

test('пустой suggestion и NONE не дают предложения', () => {
  assert.equal(parseSuggestion('{"suggestion": ""}'), null)
  assert.equal(parseSuggestion('NONE'), null)
  assert.equal(parseSuggestion('   '), null)
  assert.equal(parseSuggestion('...'), null)
})

test('JSON-ответ разбирается, кавычки снимаются', () => {
  assert.equal(parseSuggestion('{"suggestion": "Проверь сборку"}'), 'Проверь сборку')
  assert.equal(parseSuggestion('{"suggestion": "Запусти тесты", "recap": "x"}'), 'Запусти тесты')
  assert.equal(parseSuggestion('«Запусти тесты»'), 'Запусти тесты')
})

test('сломанный JSON откатывается к первой строке', () => {
  assert.equal(parseSuggestion('{"suggestion": "Проверь сборку"'), 'Проверь сборку')
})

test('длина ограничена конфигом и краями диапазона', () => {
  const long = 'а'.repeat(300)
  assert.equal([...parseSuggestion(long, 60)].length, 60)
  assert.equal([...parseSuggestion(long, 1)].length, 50)
  assert.equal([...parseSuggestion(long, 5000)].length, 300)
})

test('промпт требует JSON и содержит ходы', () => {
  const prompt = buildNextPromptPrompt('человек: привет')
  assert.match(prompt, /suggestion/)
  assert.match(prompt, /человек: привет/)
})
