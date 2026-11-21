import test from 'node:test'
import assert from 'node:assert/strict'
import { createEmissionGuard, normalizeNote } from '../../src/core/guard.js'

test('normalizeNote сводит регистр и пунктуацию', () => {
  assert.equal(normalizeNote('  *STOP.*  '), 'stop')
  assert.equal(normalizeNote('Проверь тест!'), 'проверь тест')
})

test('пустые и ничего не значащие советы отбрасываются', () => {
  const guard = createEmissionGuard()
  assert.equal(guard.accept({ severity: 'nit', note: '...' }), false)
  assert.equal(guard.accept({ severity: 'nit', note: 'LGTM' }), false)
  assert.equal(guard.accept({ severity: 'nit', note: 'нет замечаний' }), false)
})

test('повтор той же советы не проходит, эскалация проходит', () => {
  const guard = createEmissionGuard()
  assert.equal(guard.accept({ severity: 'concern', note: 'проверь край' }), true)
  assert.equal(guard.accept({ severity: 'concern', note: 'Проверь  край!' }), false)
  assert.equal(guard.accept({ severity: 'nit', note: 'проверь край' }), false)
  assert.equal(guard.accept({ severity: 'blocker', note: 'проверь край' }), true)
})

test('разные советы проходят независимо', () => {
  const guard = createEmissionGuard()
  assert.equal(guard.accept({ severity: 'concern', note: 'первое' }), true)
  assert.equal(guard.accept({ severity: 'concern', note: 'второе' }), true)
  guard.reset()
  assert.equal(guard.accept({ severity: 'concern', note: 'первое' }), true)
})
