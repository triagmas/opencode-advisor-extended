import test from 'node:test'
import assert from 'node:assert/strict'
import { limitText } from '../../src/core/limits.js'

test('короткий текст не меняется', () => {
  assert.equal(limitText('коротко', 20), 'коротко')
})

test('режет по границе слова и ставит многоточие в лимит', () => {
  const out = limitText('один два три четыре', 12)
  assert.ok(out.length <= 12)
  assert.ok(out.endsWith('…'))
  assert.ok(!out.includes('четыр'))
})

test('одно длинное слово режется жёстко', () => {
  assert.equal(limitText('abcdefghij', 4), 'abc…')
})
