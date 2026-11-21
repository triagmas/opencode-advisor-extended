import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { parseManifest } from '@openchamber/sdk/schemas'

const pkg = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
)
const oc = pkg.openchamber

test('манифест объявляет расширение и поверхности', () => {
  assert.equal(oc.apiVersion, 1)
  assert.equal(oc.id, 'advisor')
  assert.equal(oc.contributes.panel.entry, 'panel/index.html')
  assert.equal(oc.contributes.statusSection.entry, 'status/index.html')
  assert.equal(oc.contributes.opencodePlugin, 'plugin')
})

test('права ограничены двумя каталогами', () => {
  assert.deepEqual(oc.contributes.filesystem, [
    '~/.local/state/openchamber-advisor/**',
    '~/.config/openchamber-advisor/**',
  ])
  assert.equal(oc.contributes.capabilities, undefined)
})

test('файлы расширения на месте', () => {
  for (const p of [
    'panel/index.html',
    'panel/main.js',
    'status/index.html',
    'block/index.html',
    'block/main.js',
    'plugin/index.js',
  ]) {
    assert.ok(existsSync(new URL(`../${p}`, import.meta.url)), p)
  }
})

test('карточка подсказки объявлена как UI-блок', () => {
  const block = oc.contributes.blocks?.[0]
  assert.equal(block?.name, 'AdvisorNext')
  assert.deepEqual(block?.args, [])
  assert.equal(block?.entry, 'block/index.html')
})

test('манифест проходит собственную проверку SDK', () => {
  const result = parseManifest(pkg)
  assert.equal(
    result.ok,
    true,
    result.ok ? '' : `${result.code}: ${result.message}`,
  )
})
