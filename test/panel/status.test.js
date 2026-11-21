import test from 'node:test'
import assert from 'node:assert/strict'
import { latestForSession, pickSuggestion } from '../../src/panel/status.js'

test('берёт последний совет сессии', () => {
  const recs = [{ kind: 'advice', sessionID: 'a', at: 1 }, { kind: 'advice', sessionID: 'a', at: 5 }, { kind: 'suggestion', sessionID: 'a', at: 9 }]
  assert.equal(latestForSession(recs, 'a').at, 5)
  assert.equal(latestForSession(recs, 'b'), null)
})

test('предложение берётся последнее и не возвращается после «Скрыть»', () => {
  const items = [{ at: 1, text: 'старое' }, { at: 5, text: 'новое' }, { at: 6, text: '' }]
  assert.equal(pickSuggestion(items)?.text, 'новое')
  assert.equal(pickSuggestion(items, 5), null)
  assert.equal(pickSuggestion(items, 4)?.text, 'новое')
})

test('предложение чужой сессии не показывается', () => {
  const items = [{ at: 9, text: 'чужое', sessionID: 'other' }, { at: 5, text: 'своё', sessionID: 'mine' }]
  assert.equal(pickSuggestion(items, 0, 'mine')?.text, 'своё')
  assert.equal(pickSuggestion(items, 0, 'none'), null)
})
