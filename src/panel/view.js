import { isStale } from '../core/status-format.js'

const SEVERITY_RANK = { blocker: 3, concern: 2, nit: 1 }

export const SEVERITIES = Object.keys(SEVERITY_RANK)

/** Advices for one session, or the whole project, newest first. */
export function buildJournalView({ records = [], sessionID = null, allProjects = false } = {}) {
  const rows = (Array.isArray(records) ? records : [])
    .filter((record) => record && record.kind === 'advice')
    .filter((record) => allProjects || sessionID === null || record.sessionID === sessionID)
    .sort((left, right) => (right.at ?? 0) - (left.at ?? 0))

  return { rows, empty: rows.length === 0 }
}

/** Journals of several locations, without the same record twice. */
export function mergeRecords(files = []) {
  const seen = new Set()
  const merged = []

  for (const file of files) {
    for (const record of Array.isArray(file) ? file : []) {
      if (!record || typeof record !== 'object') continue
      const key = `${record.at}|${record.note ?? ''}|${record.sessionID ?? ''}`
      if (seen.has(key)) continue
      seen.add(key)
      merged.push(record)
    }
  }

  return merged.sort((left, right) => (left.at ?? 0) - (right.at ?? 0))
}

/** Whether the plugin's heartbeat is current. */
export function connectionState(status, now = Date.now()) {
  if (!status) return 'missing'
  return isStale(status, now) ? 'stale' : 'live'
}

export function severityTone(severity) {
  if (severity === 'blocker') return 'error'
  if (severity === 'concern') return 'warning'
  return 'neutral'
}

/**
 * Text shown in the settings form. A key the config has never written shows the
 * plugin's default, and an explicit 0 stays "0" — it is a value, not absence.
 */
export function settingsFormValues(config, draft, defaults) {
  const effective = { ...config, ...(draft ?? {}) }
  const values = {}
  for (const key of Object.keys(defaults ?? {})) {
    const value = effective[key]
    values[key] = String(value ?? defaults[key] ?? '')
  }
  return values
}
