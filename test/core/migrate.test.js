import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { copyFile, mkdir, mkdtemp, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { legacyPaths, migrateLegacyData } from '../../src/core/migrate.js'

const fsOps = { copyFile, mkdir, readdir }

async function workspace() {
  const home = await mkdtemp(join(tmpdir(), 'adv-migrate-'))
  const configDir = join(home, '.config', 'opencode-advisor')
  const stateDir = join(home, '.local', 'state', 'opencode-advisor')
  return { home, configDir, stateDir }
}

test('старые каталоги названы по OpenChamber', () => {
  assert.deepEqual(legacyPaths('/home/me'), {
    configDir: '/home/me/.config/openchamber-advisor',
    stateDir: '/home/me/.local/state/openchamber-advisor',
  })
})

test('конфиг и журнал переносятся в новые каталоги', async () => {
  const { home, configDir, stateDir } = await workspace()
  const legacy = legacyPaths(home)
  await mkdir(legacy.configDir, { recursive: true })
  await mkdir(legacy.stateDir, { recursive: true })
  await writeFile(join(legacy.configDir, 'config.json'), '{"provider":"p"}')
  await writeFile(join(legacy.stateDir, 'journal-abc.jsonl'), '{"at":1}\n')
  await writeFile(join(legacy.stateDir, 'journal-abc.jsonl.1'), '{"at":0}\n')
  await writeFile(join(legacy.stateDir, 'status-abc.json'), '{"at":1}')

  const result = await migrateLegacyData({
    homeDir: home,
    configDir,
    stateDir,
    fsOps,
  })

  assert.deepEqual(result, { config: true, journals: 2 })
  assert.equal(
    readFileSync(join(configDir, 'config.json'), 'utf8'),
    '{"provider":"p"}',
  )
  assert.equal(
    readFileSync(join(stateDir, 'journal-abc.jsonl'), 'utf8'),
    '{"at":1}\n',
  )
  assert.equal(
    readFileSync(join(stateDir, 'journal-abc.jsonl.1'), 'utf8'),
    '{"at":0}\n',
  )
})

test('существующие файлы не перезаписываются', async () => {
  const { home, configDir, stateDir } = await workspace()
  const legacy = legacyPaths(home)
  await mkdir(legacy.configDir, { recursive: true })
  await mkdir(legacy.stateDir, { recursive: true })
  await mkdir(configDir, { recursive: true })
  await mkdir(stateDir, { recursive: true })
  await writeFile(join(legacy.configDir, 'config.json'), '{"provider":"old"}')
  await writeFile(join(legacy.stateDir, 'journal-abc.jsonl'), '{"at":1}\n')
  await writeFile(join(configDir, 'config.json'), '{"provider":"new"}')
  await writeFile(join(stateDir, 'journal-abc.jsonl'), '{"at":9}\n')

  const result = await migrateLegacyData({
    homeDir: home,
    configDir,
    stateDir,
    fsOps,
  })

  assert.deepEqual(result, { config: false, journals: 0 })
  assert.equal(
    readFileSync(join(configDir, 'config.json'), 'utf8'),
    '{"provider":"new"}',
  )
  assert.equal(
    readFileSync(join(stateDir, 'journal-abc.jsonl'), 'utf8'),
    '{"at":9}\n',
  )
})

test('без старых каталогов миграция молчит', async () => {
  const { home, configDir, stateDir } = await workspace()
  const result = await migrateLegacyData({
    homeDir: home,
    configDir,
    stateDir,
    fsOps,
  })
  assert.deepEqual(result, { config: false, journals: 0 })
})

test('старый конфиг упоминает панель — переносится только config.json', async () => {
  const { home, configDir, stateDir } = await workspace()
  const legacy = legacyPaths(home)
  await mkdir(legacy.configDir, { recursive: true })
  await writeFile(join(legacy.configDir, 'config.json'), '{"enabled":true}')
  await writeFile(join(legacy.configDir, 'providers.json'), '{}')

  const result = await migrateLegacyData({
    homeDir: home,
    configDir,
    stateDir,
    fsOps,
  })

  assert.deepEqual(result, { config: true, journals: 0 })
  assert.deepEqual((await readdir(configDir)).sort(), ['config.json'])
})
