import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import plugin from '../../src/plugin/index.js'

function ctxFor(dir, reply) {
  const events = [
    { type: 'session.step.started', data: { sessionID: 's1' } },
    { type: 'session.step.ended', data: { sessionID: 's1' } },
  ]
  const entries = []
  const synthetics = []
  return {
    entries,
    synthetics,
    app: { version: '2.3.2' },
    options: { configDir: join(dir, 'config'), stateDir: join(dir, 'state') },
    location: { directory: '/proj' },
    event: {
      subscribe: () => ({
        async *[Symbol.asyncIterator]() {
          for (const event of events) yield event
        },
      }),
    },
    command: { transform: async (fn) => { fn({ add() {} }); return { dispose() {} } } },
    session: {
      get: async () => ({ time: { created: 1 } }),
      context: async () => [
        { id: 'm1', type: 'user', text: 'сделай фикс' },
        { id: 'm2', type: 'assistant', content: [{ type: 'text', text: 'готово' }] },
      ],
      synthetic: async (x) => synthetics.push(x),
      instructions: { entry: { put: async (x) => entries.push(x), remove: async () => {} } },
    },
    experimental: { generate: { text: async () => ({ text: reply }) } },
  }
}

test('шаг с советом попадает в журнал и счётчики', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'adv-flow-'))
  mkdirSync(join(dir, 'config'), { recursive: true })
  writeFileSync(join(dir, 'config', 'config.json'), JSON.stringify({ enabled: true, provider: 'p', model: 'm', immuneTurns: 0 }))

  const ctx = ctxFor(dir, '{"severity":"concern","guidance":"проверь граничный случай"}')
  const dispose = await plugin.setup(ctx)
  await new Promise((resolve) => setTimeout(resolve, 120))

  const stateDir = join(dir, 'state')
  const journal = readdirSync(stateDir).find((name) => name.endsWith('.jsonl'))
  assert.ok(journal, 'journal file written')

  const [record] = readFileSync(join(stateDir, journal), 'utf8').trim().split('\n').map((line) => JSON.parse(line))
  assert.equal(record.kind, 'advice')
  assert.equal(record.sessionID, 's1')
  assert.equal(record.severity, 'concern')

  const statusFile = readdirSync(stateDir).find((name) => name.startsWith('status-'))
  const status = JSON.parse(readFileSync(join(stateDir, statusFile), 'utf8'))
  assert.equal(status.calls, 1)
  assert.equal(status.lastAdviceAt, record.at)
  assert.equal(ctx.synthetics.length, 1)
  assert.equal(ctx.entries.length, 1)

  await dispose()
})

test('шаг сессии из другого location не ревьюится', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'adv-flow-'))
  mkdirSync(join(dir, 'config'), { recursive: true })
  writeFileSync(join(dir, 'config', 'config.json'), JSON.stringify({ enabled: true, provider: 'p', model: 'm', immuneTurns: 0 }))

  const ctx = ctxFor(dir, '{"severity":"concern","guidance":"чужой совет"}')
  ctx.session.get = async () => ({ time: { created: 1 }, location: { directory: '/other' } })
  const dispose = await plugin.setup(ctx)
  await new Promise((resolve) => setTimeout(resolve, 120))

  const stateDir = join(dir, 'state')
  const journals = readdirSync(stateDir).filter((name) => name.endsWith('.jsonl'))
  assert.deepEqual(journals, [], 'no journal entries for a foreign session')
  assert.equal(ctx.synthetics.length, 0)
  assert.equal(ctx.entries.length, 0)

  await dispose()
})
