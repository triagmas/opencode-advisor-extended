/**
 * How the plugin shows its work in the chat.
 *
 * `card` is the OpenChamber way: the agent asks for a guest UI block and the app
 * draws it. Clients without that block renderer (T3 Code) get the same
 * instruction as raw text, so they use `line` instead: the note is delivered as
 * one ready-made line the agent repeats at the end of its reply. `off` adds
 * nothing and keeps the note in the context only.
 */
export const NEXT_DISPLAYS = ['card', 'line', 'off']

export const NEXT_BLOCK_NAME = 'AdvisorNext'

export const NEXT_BLOCK_INSTRUCTION = [
  'Advisor next-step card: end every reply with one fenced openui-lang block',
  'that draws only the card, exactly like this:',
  '```openui-lang',
  'root = Stack([AdvisorNext()])',
  '```',
  'Put it last and do not describe it in text.',
].join('\n')

export const NEXT_LINE_INSTRUCTION = [
  'Advisor line: when this request carries an advisor note, end every reply',
  'with that note repeated on its own line, unchanged. It already starts with',
  '"Advisor · ". Add nothing when there is no note, and never invent one.',
].join('\n')

/** The instruction to inject into a request, or an empty string when off. */
export function nextBlockInstruction(enabled) {
  return enabled ? NEXT_BLOCK_INSTRUCTION : ''
}

/** The same request for clients that draw no blocks. */
export function nextLineInstruction(enabled) {
  return enabled ? NEXT_LINE_INSTRUCTION : ''
}

/** Per-server display mode; anything unknown is the OpenChamber card. */
export function normalizeNextDisplay(value) {
  return NEXT_DISPLAYS.includes(value) ? value : 'card'
}

/** The text the agent repeats (line) or that a block reads (card). */
export function formatNote(severity, note, display = 'card') {
  return display === 'line'
    ? `Advisor · ${severity}: ${note}`
    : `[advisor:${severity}] ${note}`
}
