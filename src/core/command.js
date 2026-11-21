const USAGE = { kind: 'usage' }

/**
 * Parses the text typed after `/advisor`. An empty argument toggles the
 * session, because the bare command is the one people type most.
 */
export function parseCommand(input) {
  const words = String(input ?? '')
    .trim()
    .split(/\s+/)
    .filter((word) => word !== '')

  if (words.length === 0) return { kind: 'toggle' }

  if (words.length === 1) {
    const kind = words[0].toLowerCase()
    if (kind === 'on' || kind === 'off' || kind === 'status') return { kind }
    return USAGE
  }

  if (words[0].toLowerCase() !== 'model') return USAGE
  const action = words[1].toLowerCase()

  if (action === 'reset' && words.length === 2) return { kind: 'model-reset' }
  if (action !== 'set' || words.length !== 3) return USAGE

  const slash = words[2].indexOf('/')
  if (slash <= 0 || slash === words[2].length - 1) return USAGE
  return {
    kind: 'model-set',
    providerID: words[2].slice(0, slash),
    modelID: words[2].slice(slash + 1),
  }
}
