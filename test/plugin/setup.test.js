import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import plugin from '../../src/plugin/index.js'

function fakeCtx(options = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'adv-plugin-'))
  const commands = []
  const subs = []
  return {
    app: { version: '2.3.2' },
    options: { configDir: join(dir, 'config'), stateDir: join(dir, 'state'), ...options },
    location: { directory: '/proj' },
    event: { subscribe: (o) => { subs.push(o); return () => {} } },
    command: { transform: async (fn) => { fn({ add: (c) => commands.push(c) }) } },
    session: { context: async () => [], prompt: async () => {}, synthetic: async () => {}, get: async () => ({}) },
    experimental: { generate: { text: async () => ({ text: '' }) } },
    _commands: commands,
    _subs: subs,
  }
}

test('регистрирует /advisor и подписку на шаги', async () => {
  const ctx = fakeCtx()
  const dispose = await plugin.setup(ctx)
  assert.equal(plugin.id, 'advisor')
  assert.deepEqual(ctx._commands.map(c => c.name), ['advisor'])
  assert.deepEqual(ctx._subs[0].types.includes('session.step.ended'), true)
  assert.equal(typeof dispose, 'function')
  await dispose()
})

test('без модели команда status сообщает причину', async () => {
  const ctx = fakeCtx()
  const dispose = await plugin.setup(ctx)
  const status = ctx._commands[0]
  let said = ''
  ctx.session.synthetic = async ({ text }) => { said = text }
  await status.execute({ sessionID: 's1', prompt: { text: '' }, delivery: 'steer' })
  assert.match(said, /model-missing|модель/i)
  await dispose()
})
