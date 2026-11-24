import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'

const pkg = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
)

test('пакет — плагин OpenCode, а не расширение панели', () => {
  assert.equal(pkg.openchamber, undefined)
  assert.equal(pkg.exports['.'], './plugin/index.js')
})

test('зависимостей OpenChamber нет', () => {
  const all = Object.keys(pkg.dependencies ?? {}).concat(
    Object.keys(pkg.devDependencies ?? {}),
  )
  assert.deepEqual(
    all.filter((name) => name.includes('openchamber')),
    [],
  )
})

test('собранный плагин на месте', () => {
  assert.ok(existsSync(new URL('../plugin/index.js', import.meta.url)))
})

test('плагин экспортирует id и setup для загрузчика OpenCode', async () => {
  const mod = await import('../plugin/index.js')
  assert.equal(mod.default.id, 'advisor')
  assert.equal(typeof mod.default.setup, 'function')
})

test('OpenChamber в бандле остаётся только как старый путь миграции', () => {
  const bundle = readFileSync(
    new URL('../plugin/index.js', import.meta.url),
    'utf8',
  )
  const mentions = bundle.match(/openchamber/gi) ?? []
  // Two: the legacy config and state directories the journal is moved out of.
  assert.equal(mentions.length, 2)
  for (const line of bundle.split('\n')) {
    if (!/openchamber/i.test(line)) continue
    assert.match(line, /"openchamber-advisor"/)
  }
})
