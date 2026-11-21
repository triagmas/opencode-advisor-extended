import test from 'node:test'
import assert from 'node:assert/strict'
import { parseAdviceFrame } from '../../src/core/frame.js'

test('разбирает JSON в тексте и в заборе', () => {
  const a = parseAdviceFrame('{"severity":"concern","guidance":"проверь ветку"}')
  assert.deepEqual(a, { severity: 'concern', guidance: 'проверь ветку' })
  const b = parseAdviceFrame('```json\n{"severity":"nit","guidance":"x"}\n```')
  assert.equal(b.severity, 'nit')
})

test('неизвестный уровень и мусор дают null', () => {
  assert.equal(parseAdviceFrame('{"severity":"warn","guidance":"x"}'), null)
  assert.equal(parseAdviceFrame('просто проза'), null)
  assert.equal(parseAdviceFrame('{"severity":"nit"}'), null)
})
