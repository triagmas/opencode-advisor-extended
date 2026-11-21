import test from 'node:test'
import assert from 'node:assert/strict'
import { parseCommand } from '../../src/core/command.js'

test('пустой ввод — переключатель', () => {
  assert.deepEqual(parseCommand(''), { kind: 'toggle' })
  assert.deepEqual(parseCommand('   '), { kind: 'toggle' })
})

test('on, off и status', () => {
  assert.deepEqual(parseCommand('on'), { kind: 'on' })
  assert.deepEqual(parseCommand(' OFF '), { kind: 'off' })
  assert.deepEqual(parseCommand('status'), { kind: 'status' })
})

test('model set и model reset', () => {
  assert.deepEqual(parseCommand('model set opencode-go/x'), { kind: 'model-set', providerID: 'opencode-go', modelID: 'x' })
  assert.deepEqual(parseCommand('model set a/b/c'), { kind: 'model-set', providerID: 'a', modelID: 'b/c' })
  assert.deepEqual(parseCommand('model reset'), { kind: 'model-reset' })
})

test('мусор — usage', () => {
  assert.deepEqual(parseCommand('model'), { kind: 'usage' })
  assert.deepEqual(parseCommand('model set foo'), { kind: 'usage' })
  assert.deepEqual(parseCommand('model set /x'), { kind: 'usage' })
  assert.deepEqual(parseCommand('model set p/'), { kind: 'usage' })
  assert.deepEqual(parseCommand('model set p/m extra'), { kind: 'usage' })
  assert.deepEqual(parseCommand('junk'), { kind: 'usage' })
})
