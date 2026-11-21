export const DEFAULTS = Object.freeze({
  enabled: true,
  provider: '',
  model: '',
  immuneTurns: 3,
  maxDeltaMessages: 60,
  noteMaxChars: 768,
  proseFallback: false,
})

const LIMITS = {
  immuneTurns: { min: 0, max: 50 },
  maxDeltaMessages: { min: 0, max: 500 },
  noteMaxChars: { min: 128, max: 4096 },
}

function text(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function bool(value, fallback) {
  if (typeof value === 'boolean') return value
  if (value === 'true') return true
  if (value === 'false') return false
  return fallback
}

function number(value, fallback, { min, max }) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.round(value)))
}

/**
 * Keeps only known keys, clamps numbers, coerces booleans. An incomplete model
 * pair is an error, not a crash: the reviewer stays silent for that reason.
 */
export function normalizeConfig(raw) {
  const input = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}

  const config = {
    enabled: bool(input.enabled, DEFAULTS.enabled),
    provider: text(input.provider),
    model: text(input.model),
    immuneTurns: number(input.immuneTurns, DEFAULTS.immuneTurns, LIMITS.immuneTurns),
    maxDeltaMessages: number(input.maxDeltaMessages, DEFAULTS.maxDeltaMessages, LIMITS.maxDeltaMessages),
    noteMaxChars: number(input.noteMaxChars, DEFAULTS.noteMaxChars, LIMITS.noteMaxChars),
    proseFallback: bool(input.proseFallback, DEFAULTS.proseFallback),
  }

  const errors = []
  if (config.provider === '' || config.model === '') errors.push('model-missing')

  return { config, errors }
}

/** The model pair to call, or null when the config is incomplete. */
export function modelRef(config) {
  const providerID = text(config?.provider)
  const modelID = text(config?.model)
  if (providerID === '' || modelID === '') return null
  return { providerID, modelID }
}
