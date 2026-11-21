/**
 * Next-prompt suggestion: after a step, ask the configured model what the
 * person is most likely to write next. The answer is a single line stored for
 * the panel, which offers it as input text — it is never sent on its own.
 */
export const NEXT_PROMPT_MAX_CHARS = 120;
export const NEXT_PROMPT_LIMITS = { min: 50, max: 2000 };

const SYSTEM = `Ты предсказываешь следующее сообщение человека в чате с ИИ-агентом.
Прочитай последние ходы и напиши ОДНУ короткую фразу от лица человека: что он,
скорее всего, попросит или уточнит дальше. Без кавычек, без пояснений, без
вступления. Если продолжения не видно, ответь ровно NONE.`;

/** Prompt for one prediction call over the given transcript. */
export function buildNextPromptPrompt(transcript) {
  return `${SYSTEM}\n\nХоды:\n${String(transcript ?? "").slice(0, 12_000)}\n\nСледующее сообщение человека:`;
}

/**
 * Clean one model answer into a suggestion. Returns null when the model had
 * nothing to add: NONE, an empty line, or only punctuation.
 */
export function parseSuggestion(text, maxChars = NEXT_PROMPT_MAX_CHARS) {
  let line = String(text ?? "")
    .split("\n")
    .map((part) => part.trim())
    .find((part) => part !== "");
  if (!line) return null;
  line = line.replace(/^["'«»“”\s]+|["'«»“”\s]+$/g, "");
  if (/^none$/i.test(line)) return null;
  if (!/[\p{L}\p{N}]/u.test(line)) return null;
  const limit = Math.min(
    NEXT_PROMPT_LIMITS.max,
    Math.max(NEXT_PROMPT_LIMITS.min, Number(maxChars) || NEXT_PROMPT_MAX_CHARS),
  );
  const chars = [...line];
  return chars.length > limit ? chars.slice(0, limit).join("") : line;
}
