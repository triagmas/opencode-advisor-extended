import test from 'node:test'
import assert from 'node:assert/strict'
import { collectDelta } from '../../src/core/delta.js'

const m = (id, role, text = 't', description) => ({ id, role, text, description })

test('берёт только новые сообщения после lastSeenID', () => {
  const msgs = [m('1', 'user'), m('2', 'assistant'), m('3', 'user')]
  const out = collectDelta(msgs, '1', 10)
  assert.deepEqual(out.messages.map(x => x.id), ['2', '3'])
  assert.equal(out.lastSeenID, '3')
})

test('свои сообщения и synthetic компакции выпадают', () => {
  const msgs = [m('1', 'user'), m('2', 'synthetic', 'advisor: [advisor:concern] x', 'advisor:concern'), m('3', 'synthetic', 'compact', 'compaction'), m('4', 'assistant')]
  const out = collectDelta(msgs, '1', 10)
  assert.deepEqual(out.messages.map(x => x.id), ['4'])
})

test('maxMessages оставляет хвост и не теряет lastSeenID', () => {
  const msgs = [m('1', 'user'), m('2', 'assistant'), m('3', 'user'), m('4', 'assistant')]
  const out = collectDelta(msgs, '1', 1)
  assert.deepEqual(out.messages.map(x => x.id), ['4'])
  assert.equal(out.lastSeenID, '4')
})
