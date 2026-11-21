import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildNextPromptPrompt,
  parseSuggestion,
  agentOfferSuggestion,
} from '../../src/core/next-prompt.js'

test('пустой suggestion и NONE не дают предложения', () => {
  assert.equal(parseSuggestion('{"suggestion": ""}'), null)
  assert.equal(parseSuggestion('NONE'), null)
  assert.equal(parseSuggestion('   '), null)
  assert.equal(parseSuggestion('...'), null)
})

test('JSON-ответ разбирается, кавычки снимаются', () => {
  assert.equal(
    parseSuggestion('{"suggestion": "Проверь сборку"}'),
    'Проверь сборку',
  )
  assert.equal(
    parseSuggestion('{"suggestion": "Запусти тесты", "recap": "x"}'),
    'Запусти тесты',
  )
  assert.equal(parseSuggestion('«Запусти тесты»'), 'Запусти тесты')
})

test('сломанный JSON откатывается к первой строке', () => {
  assert.equal(
    parseSuggestion('{"suggestion": "Проверь сборку"'),
    'Проверь сборку',
  )
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

test('обрезка по границе слова, а не посреди', () => {
  const text =
    'Проверь сборку и запусти все тесты в проекте, затем покажи отчёт по покрытию'
  const cut = parseSuggestion(text, 20)
  assert.ok(!/\s$/.test(cut))
  assert.ok(cut.length <= 50, 'нижняя граница диапазона — 50')
  assert.ok(text.startsWith(cut), 'cut keeps the beginning')
  assert.ok(
    text[cut.length] === undefined || text[cut.length] === ' ',
    'граница по пробелу',
  )
})

test('названный агентом следующий шаг становится подсказкой', () => {
  const reply = [
    'Готово: карточка собирается.',
    '',
    'Следующий шаг: перезагрузи вкладку и проверь крестик.',
  ].join('\n')
  assert.equal(
    agentOfferSuggestion(reply),
    'перезагрузи вкладку и проверь крестик.',
  )
  assert.equal(
    agentOfferSuggestion('**Следующий шаг** — запусти тесты после правки'),
    'запусти тесты после правки',
  )
  assert.equal(agentOfferSuggestion('Следующий шаг: `npm test`'), '`npm test`')
})

test('без названного шага подсказки нет', () => {
  assert.equal(agentOfferSuggestion('Всё готово, вопросов нет.'), null)
  assert.equal(agentOfferSuggestion('Следующий шаг:'), null)
  assert.equal(agentOfferSuggestion(''), null)
})

test('берётся последний названный шаг', () => {
  const reply = 'Следующий шаг: старый вариант\n…\nСледующий шаг: новый вариант'
  assert.equal(agentOfferSuggestion(reply), 'новый вариант')
})
