import test from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULTS, normalizeConfig, modelRef } from '../../src/core/config.js'

test('пустой конфиг даёт дефолты и ошибку про модель', () => {
  const { config, errors } = normalizeConfig({})
  assert.equal(config.immuneTurns, 3)
  assert.equal(config.noteMaxChars, 768)
  assert.equal(config.enabled, true)
  assert.deepEqual(errors, ['model-missing'])
  assert.equal(modelRef(config), null)
})

test('полная пара моделей проходит, лишние ключи отбрасываются', () => {
  const { config, errors } = normalizeConfig({ provider: 'opencode-go', model: 'x', junk: 1 })
  assert.deepEqual(errors, [])
  assert.equal(config.junk, undefined)
  assert.deepEqual(modelRef(config), { providerID: 'opencode-go', modelID: 'x' })
})

test('границы значений зажимаются', () => {
  const { config } = normalizeConfig({ immuneTurns: -5, noteMaxChars: 99999, maxDeltaMessages: 'нет' })
  assert.equal(config.immuneTurns, 0)
  assert.equal(config.noteMaxChars, 4096)
  assert.equal(config.maxDeltaMessages, DEFAULTS.maxDeltaMessages)
})
