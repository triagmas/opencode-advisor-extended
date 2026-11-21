const ELLIPSIS = '…'

/**
 * Cuts text to `max` characters, keeping whole words when the cut lands inside
 * a word. The ellipsis counts toward the limit.
 */
export function limitText(text, max) {
  const value = typeof text === 'string' ? text : String(text ?? '')
  if (!Number.isFinite(max) || max <= 0) return ''
  if (value.length <= max) return value

  const hard = value.slice(0, Math.max(0, max - 1))
  const space = hard.lastIndexOf(' ')
  const cut = space > hard.length / 2 ? hard.slice(0, space) : hard
  return cut.replace(/\s+$/, '') + ELLIPSIS
}
