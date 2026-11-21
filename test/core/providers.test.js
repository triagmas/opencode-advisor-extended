import test from 'node:test'
import assert from 'node:assert/strict'
import { buildProvidersSnapshot } from '../../src/core/providers.js'

const models = [
  { modelID: 'b-model', providerID: 'p2', name: 'B', type: 'chat' },
  { modelID: 'a-model', providerID: 'p1', name: 'A', type: 'chat' },
  { modelID: 'embed', providerID: 'p1', name: 'Embed', type: 'embedding' },
  { modelID: 'orphan', name: 'No provider' },
]
const providers = [
  { id: 'p1', name: 'Первый' },
  { id: 'p2', name: 'Второй' },
  { id: 'p3', name: 'Пустой' },
]

test('в снимок попадают только chat-модели провайдеров с моделями', () => {
  const snap = buildProvidersSnapshot(models, providers, 1)
  assert.equal(snap.at, 1)
  assert.deepEqual(snap.providers.map((p) => p.id), ['p2', 'p1'])
  assert.deepEqual(snap.providers.map((p) => p.name), ['Второй', 'Первый'])
  assert.deepEqual(snap.providers[1].models.map((m) => m.id), ['a-model'])
})

test('без списка провайдеров имя берётся из идентификатора', () => {
  const snap = buildProvidersSnapshot([{ modelID: 'm', providerID: 'px' }], [])
  assert.deepEqual(snap.providers, [{ id: 'px', name: 'px', models: [{ id: 'm', name: 'm' }] }])
})

test('пустой вход даёт пустой список, а не ошибку', () => {
  assert.deepEqual(buildProvidersSnapshot(undefined, undefined).providers, [])
})
