import test from 'node:test'
import assert from 'node:assert/strict'
import { latestForSession } from '../../src/panel/status.js'

test('берёт последний совет сессии', () => {
  const recs = [{ kind: 'advice', sessionID: 'a', at: 1 }, { kind: 'advice', sessionID: 'a', at: 5 }, { kind: 'suggestion', sessionID: 'a', at: 9 }]
  assert.equal(latestForSession(recs, 'a').at, 5)
  assert.equal(latestForSession(recs, 'b'), null)
})
