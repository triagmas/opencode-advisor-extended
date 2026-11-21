/**
 * Next-message suggestion, mirroring OpenChamber's own Session Assist: the
 * model gets the last turns and returns one message the person could send to
 * continue work they asked for — or nothing when the request is satisfied.
 * The suggestion is never sent by itself; the panel offers it as input text.
 */
export const NEXT_PROMPT_MAX_CHARS = 120;
export const NEXT_PROMPT_LIMITS = { min: 50, max: 2000 };

const SYSTEM = [
  'Верни ровно один JSON-объект с единственным строковым полем: {"suggestion": "..."}.',
  "suggestion — одно короткое сообщение от лица человека, которое можно отправить агенту без правок, чтобы продолжить конкретную незавершённую работу, которую человек уже попросил.",
  'suggestion пустая (""), если: последний запрос выполнен; следующий шаг требует решения человека (выбрать вариант, одобрить, проверить руками); в контексте нет незавершённой запрошенной работы. Завершённая работа — нормальный исход.',
  "Просьба проанализировать, объяснить или порекомендовать выполнена самим анализом, если человек не просил ещё и сделать. Предложение, план или оговорка — не разрешение на новую задачу.",
  "Не возвращайся к старым просьбам, если человек сменил тему.",
  "Пиши на языке последнего сообщения человека; код, пути и технические имена не переводи.",
  "Предлагай только то, что агент может сделать в этой сессии; если действие за человеком — пустая строка.",
].join("\n");

/** Prompt for one prediction call over the given transcript. */
export function buildNextPromptPrompt(transcript) {
  const body = String(transcript ?? "").slice(0, 24_000);
  return `${SYSTEM}\n\nНедавние ходы, от старых к новым:\n\n${body}\n\n--- Конец переписки ---\n\nВерни JSON с полем suggestion.`;
}

function fromJson(text) {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start !== -1 && end > start) {
    try {
      const parsed = JSON.parse(text.slice(start, end + 1))
      if (parsed && typeof parsed.suggestion === 'string') return parsed.suggestion
    } catch {
      // A truncated answer still names its field: take the value, not the braces.
    }
  }
  const match = text.match(/"suggestion"\s*:\s*"([^"]*)/)
  if (match) return match[1]
  return undefined
}

/**
 * Clean one model answer into a suggestion. Returns null when the model had
 * nothing to add: `{"suggestion": ""}`, NONE, empty text, or punctuation only.
 */
export function parseSuggestion(text, maxChars = NEXT_PROMPT_MAX_CHARS) {
  const raw = String(text ?? "");
  if (raw.trim() === "") return null;

  const fromObject = fromJson(raw);
  const candidate = fromObject !== undefined ? fromObject : raw;
  if (candidate.trim() === "") return null;

  let line = candidate
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
