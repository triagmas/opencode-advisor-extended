export const SEVERITIES = ['nit', 'concern', 'blocker']

/**
 * Reads the reviewer's JSON frame from a model reply. The reply may wrap the
 * object in prose or a code fence; anything that is not a valid frame is null.
 */
export function parseAdviceFrame(text) {
  const value = typeof text === 'string' ? text : ''
  const start = value.indexOf('{')
  const end = value.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) return null

  let frame
  try {
    frame = JSON.parse(value.slice(start, end + 1))
  } catch {
    return null
  }
  if (!frame || typeof frame !== 'object') return null
  if (!SEVERITIES.includes(frame.severity)) return null
  if (typeof frame.guidance !== 'string' || frame.guidance.trim() === '') return null
  return { severity: frame.severity, guidance: frame.guidance.trim() }
}
