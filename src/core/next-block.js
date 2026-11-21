/**
 * The chat card that carries the next-message suggestion.
 *
 * OpenChamber draws a guest UI block only when the agent asks for it, so the
 * instruction below is what makes the card appear at the end of a reply. The
 * card itself reads the suggestion file, so the agent never repeats the text.
 */
export const NEXT_BLOCK_NAME = 'AdvisorNext'

export const NEXT_BLOCK_INSTRUCTION = [
  'Advisor next-step card: end every reply with one fenced openui-lang block',
  'that draws only the card, exactly like this:',
  '```openui-lang',
  'root = Stack([AdvisorNext()])',
  '```',
  'Put it last and do not describe it in text.',
].join('\n')

/** The instruction to inject into a request, or an empty string when off. */
export function nextBlockInstruction(enabled) {
  return enabled ? NEXT_BLOCK_INSTRUCTION : ''
}
