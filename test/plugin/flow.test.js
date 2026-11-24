import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import plugin from '../../src/plugin/index.js'

/**
 * A finite event stream that resolves `finished` once its last event has been
 * handled: a generator only resumes past `yield` after the consumer's body for
 * that value is done, so this waits for the work without a fixed sleep.
 */
function streamOf(events) {
  let markDone
  const finished = new Promise((resolve) => {
    markDone = resolve
  })
  return {
    finished,
    subscribe: () => ({
      async *[Symbol.asyncIterator]() {
        for (const event of events) yield event
        markDone()
      },
    }),
  }
}

function ctxFor(dir, reply) {
  const entries = []
  const synthetics = []
  const commands = []
  const stream = streamOf([
    { type: 'session.step.started', data: { sessionID: 's1' } },
    { type: 'session.step.ended', data: { sessionID: 's1' } },
  ])
  return {
    entries,
    synthetics,
    _commands: commands,
    _finished: stream.finished,
    app: { version: '2.3.2' },
    options: { homeDir: dir, configDir: join(dir, 'config'), stateDir: join(dir, 'state') },
    location: { directory: '/proj' },
    event: { subscribe: stream.subscribe },
    command: { transform: async (fn) => { fn({ add: (c) => commands.push(c) }); return { dispose() {} } } },
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
  await ctx._finished

  const stateDir = join(dir, 'state')
  const journal = readdirSync(stateDir).find((name) => name.endsWith('.jsonl'))
  assert.ok(journal, 'journal file written')

  const [record] = readFileSync(join(stateDir, journal), 'utf8').trim().split('\n').map((line) => JSON.parse(line))
  assert.equal(record.kind, 'advice')
  assert.equal(record.sessionID, 's1')
  assert.equal(record.severity, 'concern')
  assert.equal(ctx.synthetics.length, 1)
  assert.equal(ctx.entries.length, 1)
  assert.deepEqual(
    readdirSync(stateDir).filter((name) => !name.endsWith('.jsonl')),
    [],
    'nothing but the journal is written',
  )

  await dispose()
})

test('шаг сессии из другого location не ревьюится', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'adv-flow-'))
  mkdirSync(join(dir, 'config'), { recursive: true })
  writeFileSync(join(dir, 'config', 'config.json'), JSON.stringify({ enabled: true, provider: 'p', model: 'm', immuneTurns: 0 }))

  const ctx = ctxFor(dir, '{"severity":"concern","guidance":"чужой совет"}')
  ctx.session.get = async () => ({ time: { created: 1 }, location: { directory: '/other' } })
  const dispose = await plugin.setup(ctx)
  await ctx._finished

  const stateDir = join(dir, 'state')
  const journals = readdirSync(stateDir).filter((name) => name.endsWith('.jsonl'))
  assert.deepEqual(journals, [], 'no journal entries for a foreign session')
  assert.equal(ctx.synthetics.length, 0)
  assert.equal(ctx.entries.length, 0)

  await dispose()
})

test('две сессии в одном потоке: ревьюится только своя', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'adv-flow-'))
  mkdirSync(join(dir, 'config'), { recursive: true })
  writeFileSync(join(dir, 'config', 'config.json'), JSON.stringify({ enabled: true, provider: 'p', model: 'm', immuneTurns: 0 }))

  const ctx = ctxFor(dir, '{"severity":"concern","guidance":"совет"}')
  const stream = streamOf([
    { type: 'session.step.ended', data: { sessionID: 'own' } },
    { type: 'session.step.ended', data: { sessionID: 'foreign' } },
  ])
  ctx.event = { subscribe: stream.subscribe }
  const dirs = { own: '/proj', foreign: '/other' }
  ctx.session.get = async ({ sessionID }) => ({ time: { created: 1 }, location: { directory: dirs[sessionID] } })

  const dispose = await plugin.setup(ctx)
  await stream.finished

  const stateDir = join(dir, 'state')
  const journal = readdirSync(stateDir).find((name) => name.endsWith('.jsonl'))
  const rows = readFileSync(join(stateDir, journal), 'utf8').trim().split('\n').map((line) => JSON.parse(line))
  assert.deepEqual(rows.map((row) => row.sessionID), ['own'])
  assert.equal(ctx.synthetics.length, 1)

  await dispose()
})

test('две сессии одной папки: совет каждой сессии свой', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'adv-flow-'))
  mkdirSync(join(dir, 'config'), { recursive: true })
  writeFileSync(join(dir, 'config', 'config.json'), JSON.stringify({ enabled: true, provider: 'p', model: 'm', immuneTurns: 0 }))

  const ctx = ctxFor(dir, '')
  // Both steps end in one stream, as on a server that serves one folder with
  // two open sessions.
  const stream = streamOf([
    { type: 'session.step.ended', data: { sessionID: 'a' } },
    { type: 'session.step.ended', data: { sessionID: 'b' } },
  ])
  ctx.event = { subscribe: stream.subscribe }
  const contexts = {
    a: [{ id: 'a1', type: 'user', text: 'сессия МАРКЕР-А' }],
    b: [{ id: 'b1', type: 'user', text: 'сессия МАРКЕР-Б' }],
  }
  ctx.session.get = async () => ({ time: { created: 1 }, location: { directory: '/proj' } })
  ctx.session.context = async ({ sessionID }) => contexts[sessionID]
  ctx.experimental.generate.text = async ({ prompt }) => {
    const seen = prompt.includes('МАРКЕР-Б') ? 'Б' : 'А'
    return { text: `{"severity":"concern","guidance":"совет для ${seen}"}` }
  }

  const dispose = await plugin.setup(ctx)
  await stream.finished

  const stateDir = join(dir, 'state')
  const journal = readdirSync(stateDir).find((name) => name.endsWith('.jsonl'))
  const rows = readFileSync(join(stateDir, journal), 'utf8').trim().split('\n').map((line) => JSON.parse(line))
  assert.deepEqual(rows.map((row) => row.sessionID), ['a', 'b'])
  assert.match(rows[0].note, /для А/)
  assert.match(rows[1].note, /для Б/)
  assert.deepEqual(ctx.synthetics.map((x) => x.sessionID), ['a', 'b'])
  assert.match(ctx.synthetics[0].text, /для А/)
  assert.match(ctx.synthetics[1].text, /для Б/)
  assert.deepEqual(ctx.entries.map((x) => x.sessionID), ['a', 'b'])

  await dispose()
})

test('закрытый гейт оставляет причину пропуска в /advisor status', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'adv-flow-'))
  mkdirSync(join(dir, 'config'), { recursive: true })
  writeFileSync(join(dir, 'config', 'config.json'), JSON.stringify({ enabled: true, provider: 'p', model: 'm', immuneTurns: 3 }))

  const ctx = ctxFor(dir, '{"severity":"concern","guidance":"совет"}')
  const dispose = await plugin.setup(ctx)
  await ctx._finished

  let said = ''
  ctx.session.synthetic = async ({ text }) => {
    said = text
  }
  const status = ctx._commands.find((c) => c.name === 'advisor')
  await status.execute({ sessionID: 's1', prompt: { text: 'status' } })

  assert.match(said, /вызовов: 0/)
  assert.match(said, /пропуск: gate/)

  await dispose()
})
