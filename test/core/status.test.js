import test from 'node:test'
import assert from 'node:assert/strict'
import { buildStatus, isStale, emptyCounters } from '../../src/core/status.js'

test('патч не теряет счётчики и ставит время', () => {
  const s = buildStatus({ ...emptyCounters(), at: 0 }, { calls: 2 }, 1000)
  assert.equal(s.calls, 2)
  assert.equal(s.at, 1000)
  assert.deepEqual(s.drops, { empty: 0, unparsed: 0, error: 0 })
})

test('устаревание по TTL', () => {
  assert.equal(isStale({ at: 0 }, 29_999), false)
  assert.equal(isStale({ at: 0 }, 30_001), true)
  assert.equal(isStale(undefined, 1), true)
})
