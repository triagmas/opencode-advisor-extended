import { copyFile, mkdir, readdir } from 'node:fs/promises'
import { join } from 'node:path'

const nodeFs = { copyFile, mkdir, readdir }

/** Where the extension kept its data before it became a plain OpenCode plugin. */
export function legacyPaths(homeDir) {
  const home = String(homeDir ?? '')
  return {
    configDir: join(home, '.config', 'openchamber-advisor'),
    stateDir: join(home, '.local', 'state', 'openchamber-advisor'),
  }
}

/**
 * Copies the config and the journals out of the old directories. Existing files
 * win: a second start never undoes an edit made after the move, and a missing
 * legacy directory is simply nothing to move.
 */
export async function migrateLegacyData({
  homeDir,
  configDir,
  stateDir,
  fsOps = nodeFs,
}) {
  const legacy = legacyPaths(homeDir)
  let config = false
  let journals = 0

  const copy = async (from, to) => {
    try {
      await fsOps.copyFile(from, to, 1 /* COPYFILE_EXCL */)
      return true
    } catch {
      // EEXIST (already moved) and ENOENT (nothing to move) are both fine.
      return false
    }
  }

  const names = async (dir, matches) => {
    try {
      return (await fsOps.readdir(dir)).filter(matches)
    } catch {
      return []
    }
  }

  const configName = 'config.json'
  if (
    (await names(legacy.configDir, (name) => name === configName)).length > 0
  ) {
    await fsOps.mkdir(configDir, { recursive: true })
    config = await copy(
      join(legacy.configDir, configName),
      join(configDir, configName),
    )
  }

  const journalNames = await names(legacy.stateDir, (name) =>
    name.startsWith('journal-'),
  )
  if (journalNames.length > 0) {
    await fsOps.mkdir(stateDir, { recursive: true })
    for (const name of journalNames) {
      if (await copy(join(legacy.stateDir, name), join(stateDir, name)))
        journals += 1
    }
  }

  return { config, journals }
}
