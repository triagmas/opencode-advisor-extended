import test from 'node:test'
import assert from 'node:assert/strict'
import { shouldReview, canReview, markReviewed } from '../../src/core/scope.js'

test('сабагенты и архив не ревьюим', () => {
  assert.equal(shouldReview({}), true)
  assert.equal(shouldReview({ parentID: 'p' }), false)
  assert.equal(shouldReview({ archived: true }), false)
})

test('cooldown держит immuneTurns шагов', () => {
  const state = { cooldownUntil: 0, turns: 0 }
  markReviewed(state, 1000, 3)
  assert.equal(state.turns, 0)
  assert.equal(canReview(state, { enabled: true }, 1000), false)
  state.turns = 3
  assert.equal(canReview(state, { enabled: true }, 1000), true)
  assert.equal(canReview(state, { enabled: false }, 1000), false)
})

test('busy не ревьюим', () => {
  assert.equal(canReview({ turns: 0, inFlight: true }, { enabled: true }, 0), false)
})
