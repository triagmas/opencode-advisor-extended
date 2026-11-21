// src/plugin/index.js
import { watch } from "node:fs";
import { mkdir as mkdir2, readFile as readFile2, rename as rename2, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname as dirname2, basename, join, resolve } from "node:path";

// src/core/command.js
var USAGE = { kind: "usage" };
function parseCommand(input) {
  const words = String(input ?? "").trim().split(/\s+/).filter((word) => word !== "");
  if (words.length === 0) return { kind: "toggle" };
  if (words.length === 1) {
    const kind = words[0].toLowerCase();
    if (kind === "on" || kind === "off" || kind === "status") return { kind };
    return USAGE;
  }
  if (words[0].toLowerCase() !== "model") return USAGE;
  const action = words[1].toLowerCase();
  if (action === "reset" && words.length === 2) return { kind: "model-reset" };
  if (action !== "set" || words.length !== 3) return USAGE;
  const slash = words[2].indexOf("/");
  if (slash <= 0 || slash === words[2].length - 1) return USAGE;
  return {
    kind: "model-set",
    providerID: words[2].slice(0, slash),
    modelID: words[2].slice(slash + 1)
  };
}

// src/core/config.js
var DEFAULTS = Object.freeze({
  enabled: true,
  provider: "",
  model: "",
  immuneTurns: 3,
  maxDeltaMessages: 60,
  noteMaxChars: 768,
  proseFallback: false,
  nextPrompt: true,
  nextPromptMaxChars: 120
});
var LIMITS = {
  immuneTurns: { min: 0, max: 50 },
  maxDeltaMessages: { min: 0, max: 500 },
  noteMaxChars: { min: 128, max: 4096 },
  nextPromptMaxChars: { min: 50, max: 2e3 }
};
function text(value) {
  return typeof value === "string" ? value.trim() : "";
}
function bool(value, fallback) {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
}
function number(value, fallback, { min, max }) {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}
function normalizeConfig(raw) {
  const input = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const config = {
    enabled: bool(input.enabled, DEFAULTS.enabled),
    provider: text(input.provider),
    model: text(input.model),
    immuneTurns: number(input.immuneTurns, DEFAULTS.immuneTurns, LIMITS.immuneTurns),
    maxDeltaMessages: number(input.maxDeltaMessages, DEFAULTS.maxDeltaMessages, LIMITS.maxDeltaMessages),
    noteMaxChars: number(input.noteMaxChars, DEFAULTS.noteMaxChars, LIMITS.noteMaxChars),
    proseFallback: bool(input.proseFallback, DEFAULTS.proseFallback),
    nextPrompt: bool(input.nextPrompt, DEFAULTS.nextPrompt),
    nextPromptMaxChars: number(input.nextPromptMaxChars, DEFAULTS.nextPromptMaxChars, LIMITS.nextPromptMaxChars)
  };
  const errors = [];
  if (config.provider === "" || config.model === "") errors.push("model-missing");
  return { config, errors };
}
function modelRef(config) {
  const providerID = text(config?.provider);
  const modelID = text(config?.model);
  if (providerID === "" || modelID === "") return null;
  return { providerID, modelID };
}

// src/core/journal.js
import { appendFile, mkdir, readFile, rename, stat } from "node:fs/promises";
import { dirname } from "node:path";

// src/core/journal-format.js
import { createHash } from "node:crypto";

// src/core/journal-parse.js
function countJournalLines(text2) {
  let lines = 0;
  for (const line of String(text2 ?? "").split("\n")) {
    if (line.trim() !== "") lines += 1;
  }
  return lines;
}

// src/core/journal-format.js
var ROTATE_BYTES = 1e6;
var ROTATE_LINES = 5e3;
function journalFileName(locationDir) {
  const digest = createHash("sha256").update(String(locationDir ?? "")).digest("hex");
  return `journal-${digest.slice(0, 8)}.jsonl`;
}
function suggestionFileName(locationDir) {
  return journalFileName(locationDir).replace("journal-", "suggestion-").replace(".jsonl", ".json");
}

// src/core/journal.js
var nodeFs = { appendFile, mkdir, readFile, rename, stat };
async function appendRecord(path, record, fsOps = nodeFs) {
  const line = JSON.stringify(record) + "\n";
  const bytes = Buffer.byteLength(line, "utf8");
  await fsOps.mkdir(dirname(path), { recursive: true });
  let size = 0;
  let lines = 0;
  try {
    const info = await fsOps.stat(path);
    size = info.size;
    if (size > 0) lines = countJournalLines(await fsOps.readFile(path, "utf8"));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  if (size > 0 && (size + bytes > ROTATE_BYTES || lines >= ROTATE_LINES)) {
    await fsOps.rename(path, `${path}.1`);
  }
  await fsOps.appendFile(path, line);
}

// src/core/providers.js
function buildProvidersSnapshot(models, providers, now = Date.now()) {
  const byId = /* @__PURE__ */ new Map();
  const ensure = (id) => {
    let provider = byId.get(id);
    if (!provider) {
      provider = { id, name: id, models: [] };
      byId.set(id, provider);
    }
    return provider;
  };
  for (const provider of Array.isArray(providers) ? providers : []) {
    if (!provider?.id) continue;
    const target = ensure(provider.id);
    if (typeof provider.name === "string" && provider.name !== "")
      target.name = provider.name;
  }
  for (const model of Array.isArray(models) ? models : []) {
    const modelID = model?.modelID ?? model?.id;
    const providerID = model?.providerID;
    if (!modelID || !providerID) continue;
    if (model?.type && model.type !== "chat") continue;
    const provider = ensure(providerID);
    if (provider.models.some((item) => item.id === modelID)) continue;
    provider.models.push({ id: modelID, name: model?.name || modelID });
  }
  const list = [...byId.values()].filter((provider) => provider.models.length > 0).sort((left, right) => left.name.localeCompare(right.name, "ru"));
  for (const provider of list) {
    provider.models.sort(
      (left, right) => left.name.localeCompare(right.name, "ru")
    );
  }
  return { at: now, providers: list };
}

// src/core/next-prompt.js
var NEXT_PROMPT_MAX_CHARS = 120;
var NEXT_PROMPT_LIMITS = { min: 50, max: 2e3 };
var SYSTEM = [
  '\u0412\u0435\u0440\u043D\u0438 \u0440\u043E\u0432\u043D\u043E \u043E\u0434\u0438\u043D JSON-\u043E\u0431\u044A\u0435\u043A\u0442 \u0441 \u0435\u0434\u0438\u043D\u0441\u0442\u0432\u0435\u043D\u043D\u044B\u043C \u0441\u0442\u0440\u043E\u043A\u043E\u0432\u044B\u043C \u043F\u043E\u043B\u0435\u043C: {"suggestion": "..."}.',
  "suggestion \u2014 \u043E\u0434\u043D\u043E \u043A\u043E\u0440\u043E\u0442\u043A\u043E\u0435 \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u0435 \u043E\u0442 \u043B\u0438\u0446\u0430 \u0447\u0435\u043B\u043E\u0432\u0435\u043A\u0430, \u043A\u043E\u0442\u043E\u0440\u043E\u0435 \u043C\u043E\u0436\u043D\u043E \u043E\u0442\u043F\u0440\u0430\u0432\u0438\u0442\u044C \u0430\u0433\u0435\u043D\u0442\u0443 \u0431\u0435\u0437 \u043F\u0440\u0430\u0432\u043E\u043A, \u0447\u0442\u043E\u0431\u044B \u043F\u0440\u043E\u0434\u043E\u043B\u0436\u0438\u0442\u044C \u043A\u043E\u043D\u043A\u0440\u0435\u0442\u043D\u0443\u044E \u043D\u0435\u0437\u0430\u0432\u0435\u0440\u0448\u0451\u043D\u043D\u0443\u044E \u0440\u0430\u0431\u043E\u0442\u0443, \u043A\u043E\u0442\u043E\u0440\u0443\u044E \u0447\u0435\u043B\u043E\u0432\u0435\u043A \u0443\u0436\u0435 \u043F\u043E\u043F\u0440\u043E\u0441\u0438\u043B.",
  'suggestion \u043F\u0443\u0441\u0442\u0430\u044F (""), \u0435\u0441\u043B\u0438: \u043F\u043E\u0441\u043B\u0435\u0434\u043D\u0438\u0439 \u0437\u0430\u043F\u0440\u043E\u0441 \u0432\u044B\u043F\u043E\u043B\u043D\u0435\u043D; \u0441\u043B\u0435\u0434\u0443\u044E\u0449\u0438\u0439 \u0448\u0430\u0433 \u0442\u0440\u0435\u0431\u0443\u0435\u0442 \u0440\u0435\u0448\u0435\u043D\u0438\u044F \u0447\u0435\u043B\u043E\u0432\u0435\u043A\u0430 (\u0432\u044B\u0431\u0440\u0430\u0442\u044C \u0432\u0430\u0440\u0438\u0430\u043D\u0442, \u043E\u0434\u043E\u0431\u0440\u0438\u0442\u044C, \u043F\u0440\u043E\u0432\u0435\u0440\u0438\u0442\u044C \u0440\u0443\u043A\u0430\u043C\u0438); \u0432 \u043A\u043E\u043D\u0442\u0435\u043A\u0441\u0442\u0435 \u043D\u0435\u0442 \u043D\u0435\u0437\u0430\u0432\u0435\u0440\u0448\u0451\u043D\u043D\u043E\u0439 \u0437\u0430\u043F\u0440\u043E\u0448\u0435\u043D\u043D\u043E\u0439 \u0440\u0430\u0431\u043E\u0442\u044B. \u0417\u0430\u0432\u0435\u0440\u0448\u0451\u043D\u043D\u0430\u044F \u0440\u0430\u0431\u043E\u0442\u0430 \u2014 \u043D\u043E\u0440\u043C\u0430\u043B\u044C\u043D\u044B\u0439 \u0438\u0441\u0445\u043E\u0434.',
  "\u041F\u0440\u043E\u0441\u044C\u0431\u0430 \u043F\u0440\u043E\u0430\u043D\u0430\u043B\u0438\u0437\u0438\u0440\u043E\u0432\u0430\u0442\u044C, \u043E\u0431\u044A\u044F\u0441\u043D\u0438\u0442\u044C \u0438\u043B\u0438 \u043F\u043E\u0440\u0435\u043A\u043E\u043C\u0435\u043D\u0434\u043E\u0432\u0430\u0442\u044C \u0432\u044B\u043F\u043E\u043B\u043D\u0435\u043D\u0430 \u0441\u0430\u043C\u0438\u043C \u0430\u043D\u0430\u043B\u0438\u0437\u043E\u043C, \u0435\u0441\u043B\u0438 \u0447\u0435\u043B\u043E\u0432\u0435\u043A \u043D\u0435 \u043F\u0440\u043E\u0441\u0438\u043B \u0435\u0449\u0451 \u0438 \u0441\u0434\u0435\u043B\u0430\u0442\u044C. \u041F\u0440\u0435\u0434\u043B\u043E\u0436\u0435\u043D\u0438\u0435, \u043F\u043B\u0430\u043D \u0438\u043B\u0438 \u043E\u0433\u043E\u0432\u043E\u0440\u043A\u0430 \u2014 \u043D\u0435 \u0440\u0430\u0437\u0440\u0435\u0448\u0435\u043D\u0438\u0435 \u043D\u0430 \u043D\u043E\u0432\u0443\u044E \u0437\u0430\u0434\u0430\u0447\u0443.",
  "\u041D\u0435 \u0432\u043E\u0437\u0432\u0440\u0430\u0449\u0430\u0439\u0441\u044F \u043A \u0441\u0442\u0430\u0440\u044B\u043C \u043F\u0440\u043E\u0441\u044C\u0431\u0430\u043C, \u0435\u0441\u043B\u0438 \u0447\u0435\u043B\u043E\u0432\u0435\u043A \u0441\u043C\u0435\u043D\u0438\u043B \u0442\u0435\u043C\u0443.",
  "\u041F\u0438\u0448\u0438 \u043D\u0430 \u044F\u0437\u044B\u043A\u0435 \u043F\u043E\u0441\u043B\u0435\u0434\u043D\u0435\u0433\u043E \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u044F \u0447\u0435\u043B\u043E\u0432\u0435\u043A\u0430; \u043A\u043E\u0434, \u043F\u0443\u0442\u0438 \u0438 \u0442\u0435\u0445\u043D\u0438\u0447\u0435\u0441\u043A\u0438\u0435 \u0438\u043C\u0435\u043D\u0430 \u043D\u0435 \u043F\u0435\u0440\u0435\u0432\u043E\u0434\u0438.",
  "\u041F\u0440\u0435\u0434\u043B\u0430\u0433\u0430\u0439 \u0442\u043E\u043B\u044C\u043A\u043E \u0442\u043E, \u0447\u0442\u043E \u0430\u0433\u0435\u043D\u0442 \u043C\u043E\u0436\u0435\u0442 \u0441\u0434\u0435\u043B\u0430\u0442\u044C \u0432 \u044D\u0442\u043E\u0439 \u0441\u0435\u0441\u0441\u0438\u0438; \u0435\u0441\u043B\u0438 \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u0435 \u0437\u0430 \u0447\u0435\u043B\u043E\u0432\u0435\u043A\u043E\u043C \u2014 \u043F\u0443\u0441\u0442\u0430\u044F \u0441\u0442\u0440\u043E\u043A\u0430."
].join("\n");
function buildNextPromptPrompt(transcript) {
  const body = String(transcript ?? "").slice(0, 24e3);
  return `${SYSTEM}

\u041D\u0435\u0434\u0430\u0432\u043D\u0438\u0435 \u0445\u043E\u0434\u044B, \u043E\u0442 \u0441\u0442\u0430\u0440\u044B\u0445 \u043A \u043D\u043E\u0432\u044B\u043C:

${body}

--- \u041A\u043E\u043D\u0435\u0446 \u043F\u0435\u0440\u0435\u043F\u0438\u0441\u043A\u0438 ---

\u0412\u0435\u0440\u043D\u0438 JSON \u0441 \u043F\u043E\u043B\u0435\u043C suggestion.`;
}
function fromJson(text2) {
  const start = text2.indexOf("{");
  const end = text2.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try {
      const parsed = JSON.parse(text2.slice(start, end + 1));
      if (parsed && typeof parsed.suggestion === "string") return parsed.suggestion;
    } catch {
    }
  }
  const match = text2.match(/"suggestion"\s*:\s*"([^"]*)/);
  if (match) return match[1];
  return void 0;
}
function parseSuggestion(text2, maxChars = NEXT_PROMPT_MAX_CHARS) {
  const raw = String(text2 ?? "");
  if (raw.trim() === "") return null;
  const fromObject = fromJson(raw);
  const candidate = fromObject !== void 0 ? fromObject : raw;
  if (candidate.trim() === "") return null;
  let line = candidate.split("\n").map((part) => part.trim()).find((part) => part !== "");
  if (!line) return null;
  line = line.replace(/^["'«»“”\s]+|["'«»“”\s]+$/g, "");
  if (/^none$/i.test(line)) return null;
  if (!/[\p{L}\p{N}]/u.test(line)) return null;
  const limit = Math.min(
    NEXT_PROMPT_LIMITS.max,
    Math.max(NEXT_PROMPT_LIMITS.min, Number(maxChars) || NEXT_PROMPT_MAX_CHARS)
  );
  const chars = [...line];
  return chars.length > limit ? chars.slice(0, limit).join("") : line;
}

// src/core/limits.js
var ELLIPSIS = "\u2026";
function limitText(text2, max) {
  const value = typeof text2 === "string" ? text2 : String(text2 ?? "");
  if (!Number.isFinite(max) || max <= 0) return "";
  if (value.length <= max) return value;
  const hard = value.slice(0, Math.max(0, max - 1));
  const space = hard.lastIndexOf(" ");
  const cut = space > hard.length / 2 ? hard.slice(0, space) : hard;
  return cut.replace(/\s+$/, "") + ELLIPSIS;
}

// src/core/scope.js
function shouldReview(session) {
  if (!session) return false;
  if (session.parentID) return false;
  if (session.archived) return false;
  return true;
}
function canReview(state, config, _now = Date.now()) {
  if (!config?.enabled) return false;
  if (!state || state.disabled || state.muted) return false;
  if (state.inFlight) return false;
  return (state.turns ?? 0) >= (state.immuneTurns ?? 0);
}
function markReviewed(state, now, immuneTurns) {
  state.turns = 0;
  state.immuneTurns = immuneTurns;
  state.inFlight = false;
  state.cooldownUntil = now;
}

// src/core/status.js
import { createHash as createHash2 } from "node:crypto";

// src/core/status-format.js
function emptyCounters() {
  return { calls: 0, drops: { empty: 0, unparsed: 0, error: 0 } };
}
function buildStatus(prev = {}, patch = {}, now = Date.now()) {
  const base = { ...emptyCounters(), ...prev };
  return {
    ...base,
    ...patch,
    drops: { ...base.drops, ...patch.drops ?? {} },
    at: now
  };
}

// src/core/status.js
function statusFileName(locationDir) {
  const digest = createHash2("sha256").update(String(locationDir ?? "")).digest("hex");
  return `status-${digest.slice(0, 8)}.json`;
}

// src/core/delta.js
function isOwnRecord(message) {
  const description = typeof message?.description === "string" ? message.description : "";
  return description.startsWith("advisor:");
}
function isCompaction(message) {
  if (message?.role === "compaction" || message?.type === "compaction")
    return true;
  const description = typeof message?.description === "string" ? message.description : "";
  return description === "compaction" || description.startsWith("compaction:");
}
function collectDelta(messages, lastSeenID, maxMessages) {
  const list = Array.isArray(messages) ? messages : [];
  let start = 0;
  if (lastSeenID != null) {
    const index = list.findIndex((message) => message?.id === lastSeenID);
    start = index === -1 ? 0 : index + 1;
  }
  const fresh = list.slice(start).filter((message) => !isOwnRecord(message) && !isCompaction(message));
  const lastID = fresh.length > 0 ? fresh[fresh.length - 1].id : lastSeenID ?? null;
  const window = typeof maxMessages === "number" && maxMessages > 0 ? fresh.slice(-maxMessages) : fresh;
  return { messages: window, lastSeenID: lastID };
}

// src/core/frame.js
var SEVERITIES = ["nit", "concern", "blocker"];
function parseAdviceFrame(text2) {
  const value = typeof text2 === "string" ? text2 : "";
  const start = value.indexOf("{");
  const end = value.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  let frame;
  try {
    frame = JSON.parse(value.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!frame || typeof frame !== "object") return null;
  if (!SEVERITIES.includes(frame.severity)) return null;
  if (typeof frame.guidance !== "string" || frame.guidance.trim() === "") return null;
  return { severity: frame.severity, guidance: frame.guidance.trim() };
}

// src/core/guard.js
var SEVERITY_RANK = { nit: 0, concern: 1, blocker: 2 };
var CONTENT_FREE_PHRASES = /* @__PURE__ */ new Set([
  "stop",
  "done",
  "complete",
  "no issue continue",
  "lgtm",
  "nothing to add",
  "ok",
  "okay",
  "good",
  "fine",
  "looks good",
  "looks fine",
  "all good",
  "all clear",
  "no issue",
  "no issues",
  "nothing",
  "\u043E\u043A",
  "\u043E\u043A\u0435\u0439",
  "\u0445\u043E\u0440\u043E\u0448\u043E",
  "\u0432\u0441\u0435 \u0445\u043E\u0440\u043E\u0448\u043E",
  "\u043D\u0435\u0442 \u0437\u0430\u043C\u0435\u0447\u0430\u043D\u0438\u0439",
  "\u0437\u0430\u043C\u0435\u0447\u0430\u043D\u0438\u0439 \u043D\u0435\u0442",
  "\u0432\u0441\u0435 \u0432 \u043F\u043E\u0440\u044F\u0434\u043A\u0435"
]);
var MAX_HISTORY = 4096;
function normalizeNote(text2) {
  return String(text2 ?? "").normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}
function createEmissionGuard() {
  const history = /* @__PURE__ */ new Map();
  return {
    accept(note) {
      const key = normalizeNote(note?.note);
      if (key === "") return false;
      if (CONTENT_FREE_PHRASES.has(key)) return false;
      const rank = SEVERITY_RANK[note?.severity] ?? 1;
      const prior = history.get(key);
      if (prior !== void 0 && rank <= prior) return false;
      history.set(key, rank);
      if (history.size > MAX_HISTORY) {
        const oldest = history.keys().next().value;
        if (oldest !== void 0) history.delete(oldest);
      }
      return true;
    },
    reset() {
      history.clear();
    }
  };
}

// src/plugin/prompts.js
var REVIEWER_SYSTEM = `\u0422\u044B \u2014 \u0440\u0435\u0432\u044C\u044E\u0435\u0440 \u0445\u043E\u0434\u0430 \u0430\u0433\u0435\u043D\u0442\u0430 \u0432 \u0440\u0435\u0434\u0430\u043A\u0442\u043E\u0440\u0435 \u043A\u043E\u0434\u0430. \u0422\u0435\u0431\u0435 \u0434\u0430\u044E\u0442 \u043F\u043E\u0441\u043B\u0435\u0434\u043D\u0438\u0435 \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u044F \u0441\u0435\u0441\u0441\u0438\u0438: \u0447\u0442\u043E \u043F\u0440\u043E\u0441\u0438\u043B \u0447\u0435\u043B\u043E\u0432\u0435\u043A, \u0447\u0442\u043E \u043E\u0442\u0432\u0435\u0442\u0438\u043B \u0430\u0433\u0435\u043D\u0442 \u0438 \u043A\u0430\u043A\u0438\u0435 \u0432\u044B\u0437\u043E\u0432\u044B \u0438\u043D\u0441\u0442\u0440\u0443\u043C\u0435\u043D\u0442\u043E\u0432 \u043E\u043D \u0441\u0434\u0435\u043B\u0430\u043B.

\u0414\u0430\u0439 \u043E\u0434\u0438\u043D \u043A\u043E\u0440\u043E\u0442\u043A\u0438\u0439 \u0441\u043E\u0432\u0435\u0442 \u0430\u0433\u0435\u043D\u0442\u0443 \u2014 \u043D\u0435 \u0447\u0435\u043B\u043E\u0432\u0435\u043A\u0443. \u041D\u0435 \u043F\u0435\u0440\u0435\u0441\u043A\u0430\u0437\u044B\u0432\u0430\u0439 \u0441\u0434\u0435\u043B\u0430\u043D\u043D\u043E\u0435, \u043D\u0435 \u0445\u0432\u0430\u043B\u0438, \u043D\u0435 \u043A\u043E\u043C\u0430\u043D\u0434\u0443\u0439 \u0438 \u043D\u0435 \u043F\u0440\u043E\u0441\u0438 \u0438\u043D\u0441\u0442\u0440\u0443\u043C\u0435\u043D\u0442\u043E\u0432.

\u0423\u0440\u043E\u0432\u043D\u0438 \u0432\u0430\u0436\u043D\u043E\u0441\u0442\u0438:
- "nit" \u2014 \u043C\u0435\u043B\u043E\u0447\u044C \u0438\u043B\u0438 \u0443\u043B\u0443\u0447\u0448\u0435\u043D\u0438\u0435, \u0430\u0433\u0435\u043D\u0442 \u043C\u043E\u0436\u0435\u0442 \u043F\u0440\u043E\u0434\u043E\u043B\u0436\u0430\u0442\u044C;
- "concern" \u2014 \u0432\u0435\u0440\u043E\u044F\u0442\u043D\u0430\u044F \u043E\u0448\u0438\u0431\u043A\u0430 \u0438\u043B\u0438 \u043F\u0440\u043E\u043F\u0443\u0449\u0435\u043D\u043D\u043E\u0435 \u0442\u0440\u0435\u0431\u043E\u0432\u0430\u043D\u0438\u0435, \u0441\u0442\u043E\u0438\u0442 \u043F\u0440\u043E\u0432\u0435\u0440\u0438\u0442\u044C \u0441\u0435\u0439\u0447\u0430\u0441;
- "blocker" \u2014 \u0430\u0433\u0435\u043D\u0442 \u0434\u0432\u0438\u0436\u0435\u0442\u0441\u044F \u043D\u0435 \u0442\u0443\u0434\u0430 \u0438\u043B\u0438 \u0441\u043B\u043E\u043C\u0430\u0435\u0442 \u0440\u0430\u0431\u043E\u0442\u0443, \u043E\u0441\u0442\u0430\u043D\u043E\u0432\u0438\u0441\u044C \u0438 \u0438\u0441\u043F\u0440\u0430\u0432\u044C.

\u041E\u0442\u0432\u0435\u0442 \u2014 \u0440\u043E\u0432\u043D\u043E \u043E\u0434\u0438\u043D JSON-\u043E\u0431\u044A\u0435\u043A\u0442 \u0431\u0435\u0437 \u043F\u043E\u044F\u0441\u043D\u0435\u043D\u0438\u0439 \u0438 \u0431\u0435\u0437 markdown:
{"severity":"nit|concern|blocker","guidance":"\u043E\u0434\u043D\u043E-\u0434\u0432\u0430 \u043F\u0440\u0435\u0434\u043B\u043E\u0436\u0435\u043D\u0438\u044F \u043F\u043E-\u0440\u0443\u0441\u0441\u043A\u0438"}

\u0415\u0441\u043B\u0438 \u0441\u043E\u0432\u0435\u0442\u043E\u0432\u0430\u0442\u044C \u043D\u0435\u0447\u0435\u0433\u043E, \u043E\u0442\u0432\u0435\u0442\u044C \u0440\u043E\u0432\u043D\u043E: NO_ADVICE`;
function buildReviewPrompt(transcript) {
  return `\u0421\u0435\u0441\u0441\u0438\u044F, \u043F\u043E\u0441\u043B\u0435\u0434\u043D\u0438\u0435 \u0445\u043E\u0434\u044B:

${transcript}

\u041E\u0446\u0435\u043D\u0438 \u0445\u043E\u0434 \u0430\u0433\u0435\u043D\u0442\u0430 \u0438 \u0432\u0435\u0440\u043D\u0438 JSON-\u043A\u0430\u0434\u0440 \u0441\u043E\u0432\u0435\u0442\u0430.`;
}

// src/plugin/review.js
var DELTA_MAX = 16e3;
var NOTE_KEY = "advisor-note";
var NO_ADVICE = "NO_ADVICE";
function messageText(message) {
  if (Array.isArray(message?.content)) {
    return message.content.filter((part) => part?.type === "text" && typeof part.text === "string").map((part) => part.text).join("\n");
  }
  return typeof message?.text === "string" ? message.text : "";
}
function toDeltaMessage(message) {
  return {
    id: message?.id,
    role: message?.type ?? message?.role ?? "user",
    text: messageText(message),
    description: message?.description
  };
}
function triggeredByAdvisor(messages) {
  let userAt = -1;
  let advisorAt = -1;
  messages.forEach((message, index) => {
    if (isOwnRecord(message)) advisorAt = index;
    else if (message.role === "user") userAt = index;
  });
  return advisorAt > -1 && advisorAt > userAt;
}
function transcriptOf(messages) {
  return messages.map((message) => `${message.role}: ${message.text}`).join("\n\n");
}
async function runReview({
  ctx,
  config,
  sessionID,
  state,
  now = Date.now()
}) {
  const model = modelRef(config);
  if (!model) return { kind: "skipped", reason: "model-missing" };
  if (state.inFlight) return { kind: "skipped", reason: "busy" };
  state.inFlight = true;
  const started = Date.now();
  try {
    let rawMessages;
    try {
      rawMessages = await ctx.session.context({ sessionID });
    } catch {
      return { kind: "dropped", reason: "error", ms: Date.now() - started };
    }
    const messages = (Array.isArray(rawMessages) ? rawMessages : []).map(
      toDeltaMessage
    );
    if (triggeredByAdvisor(messages))
      return { kind: "skipped", reason: "advisor-triggered" };
    const delta = collectDelta(
      messages,
      state.lastSeenID,
      config.maxDeltaMessages
    );
    state.lastSeenID = delta.lastSeenID;
    if (delta.messages.length === 0)
      return { kind: "skipped", reason: "no-delta" };
    const hasText = delta.messages.some(
      (message) => typeof message.text === "string" && message.text.trim() !== ""
    );
    if (!hasText) return { kind: "skipped", reason: "no-text" };
    const transcript = limitText(transcriptOf(delta.messages), DELTA_MAX);
    const prompt = `${REVIEWER_SYSTEM}

${buildReviewPrompt(transcript)}`;
    let text2;
    try {
      const answer = await ctx.experimental.generate.text({
        model: { providerID: model.providerID, id: model.modelID },
        prompt
      });
      text2 = typeof answer?.text === "string" ? answer.text.trim() : "";
    } catch {
      return { kind: "dropped", reason: "error", ms: Date.now() - started };
    }
    const ms = Date.now() - started;
    if (state.disabled || !config.enabled)
      return { kind: "skipped", reason: "disabled", ms };
    if (text2 === "" || text2 === NO_ADVICE)
      return { kind: "dropped", reason: "empty", ms };
    let frame = parseAdviceFrame(text2);
    if (!frame && config.proseFallback)
      frame = { severity: "nit", guidance: text2 };
    if (!frame) return { kind: "dropped", reason: "unparsed", ms };
    const note = limitText(frame.guidance, config.noteMaxChars);
    if (note === "") return { kind: "dropped", reason: "empty", ms };
    const guard = state.guard ??= createEmissionGuard();
    if (!guard.accept({ severity: frame.severity, note }))
      return { kind: "skipped", reason: "duplicate", ms };
    const delivered = `[advisor:${frame.severity}] ${note}`;
    try {
      if (frame.severity !== "nit") {
        await ctx.session.synthetic({
          sessionID,
          text: delivered,
          description: `advisor:${frame.severity}`,
          delivery: "steer"
        });
      }
      await ctx.session.instructions?.entry?.put({
        sessionID,
        key: NOTE_KEY,
        value: delivered
      });
    } catch {
      return { kind: "dropped", reason: "error", ms };
    }
    if (frame.severity !== "nit") markReviewed(state, now, config.immuneTurns);
    return { kind: "delivered", severity: frame.severity, note, ms };
  } finally {
    state.inFlight = false;
  }
}

// src/plugin/index.js
var PLUGIN_VERSION = "0.1.0";
var HEARTBEAT_MS = 1e4;
var ANSWER_MAX = 500;
var NOTE_KEY2 = "advisor-note";
var EVENT_TYPES = [
  "session.step.started",
  "session.step.ended",
  "session.execution.succeeded",
  "session.execution.failed"
];
var USAGE_TEXT = "advisor: on | off | status | model set <provider>/<model> | model reset";
function modelLabel(config) {
  const ref = modelRef(config);
  return ref ? `${ref.providerID}/${ref.modelID}` : null;
}
async function readJson(path) {
  try {
    return JSON.parse(await readFile2(path, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    return {};
  }
}
async function writeJsonAtomic(path, value) {
  await mkdir2(dirname2(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  await writeFile(temp, JSON.stringify(value, null, 2) + "\n");
  await rename2(temp, path);
}
async function setup(ctx) {
  const options = ctx.options ?? {};
  const home = options.homeDir ?? homedir();
  const configDir = options.configDir ?? join(home, ".config", "openchamber-advisor");
  const stateDir = options.stateDir ?? join(home, ".local", "state", "openchamber-advisor");
  const locationDir = resolve(String(ctx.location?.directory ?? process.cwd()));
  const configPath = join(configDir, "config.json");
  const statusPath = join(stateDir, statusFileName(locationDir));
  const journalPath = join(stateDir, journalFileName(locationDir));
  const suggestionPath = join(stateDir, suggestionFileName(locationDir));
  await mkdir2(configDir, { recursive: true });
  await mkdir2(stateDir, { recursive: true });
  let raw = await readJson(configPath);
  if (raw === null) {
    raw = { ...DEFAULTS };
    await writeJsonAtomic(configPath, raw);
  }
  let applied = normalizeConfig(raw);
  let config = applied.config;
  let errors = applied.errors;
  const sessions = /* @__PURE__ */ new Map();
  const stateOf = (sessionID) => {
    let state = sessions.get(sessionID);
    if (!state) {
      state = {
        lastSeenID: null,
        lastSuggestAt: 0,
        suggesting: false,
        turns: 0,
        immuneTurns: config.immuneTurns,
        inFlight: false,
        disabled: false,
        muted: false,
        cooldownUntil: 0
      };
      sessions.set(sessionID, state);
    }
    return state;
  };
  const counters = emptyCounters();
  let lastAdviceAt = null;
  let lastMs = null;
  let cooldownUntil = null;
  let status = buildStatus(
    {
      ...emptyCounters(),
      startedAt: Date.now(),
      pluginVersion: PLUGIN_VERSION
    },
    {},
    Date.now()
  );
  let queue = Promise.resolve();
  const flush = (patch = {}) => {
    status = buildStatus(status, patch, Date.now());
    const snapshot = { ...status, at: Date.now() };
    queue = queue.then(() => writeJsonAtomic(statusPath, snapshot)).catch(() => {
    });
    return queue;
  };
  await flush({
    enabled: config.enabled,
    model: modelLabel(config),
    reason: errors[0] ?? null,
    appVersion: ctx.app?.version ?? null,
    lastAdviceAt: null,
    lastMs: null,
    cooldownUntil: null
  });
  const providersPath = join(stateDir, "providers.json");
  let snapshotTick = 0;
  async function writeProviders() {
    try {
      const [models, providers] = await Promise.all([
        ctx.model?.list?.({ location: { directory: locationDir } }),
        ctx.provider?.list?.({ location: { directory: locationDir } })
      ]);
      const snapshot = buildProvidersSnapshot(
        models?.data ?? models,
        providers?.data ?? providers
      );
      if (snapshot.providers.length > 0)
        await writeJsonAtomic(providersPath, snapshot);
    } catch {
    }
  }
  void writeProviders();
  const heartbeat = setInterval(() => {
    void flush();
    if (++snapshotTick % 6 === 0) void writeProviders();
  }, HEARTBEAT_MS);
  heartbeat.unref?.();
  async function reloadConfig() {
    const fresh = await readJson(configPath);
    if (fresh === null) return;
    applied = normalizeConfig(fresh);
    config = applied.config;
    errors = applied.errors;
    for (const state of sessions.values()) {
      state.immuneTurns = config.immuneTurns;
      state.muted = false;
    }
    await flush({
      enabled: config.enabled,
      model: modelLabel(config),
      reason: errors[0] ?? null
    });
  }
  let watcher;
  try {
    const configName = basename(configPath);
    watcher = watch(
      dirname2(configPath),
      { persistent: false },
      (_event, filename) => {
        if (filename && String(filename) !== configName) return;
        void reloadConfig().catch(() => {
        });
      }
    );
    watcher.unref?.();
  } catch {
  }
  async function patchConfig(patch) {
    const current = await readJson(configPath) ?? { ...config };
    await writeJsonAtomic(configPath, { ...current, ...patch });
    await reloadConfig();
  }
  const reply = (body) => {
    const missing = errors.includes("model-missing") ? " \u041C\u043E\u0434\u0435\u043B\u044C \u043D\u0435 \u0437\u0430\u0434\u0430\u043D\u0430 (model-missing): \u0443\u043A\u0430\u0436\u0438\u0442\u0435 provider/model \u0432 \u043F\u0430\u043D\u0435\u043B\u0438 \u0438\u043B\u0438 /advisor model set <provider>/<model>." : "";
    return limitText(`Advisor: ${body}${missing}`, ANSWER_MAX);
  };
  function statusLine(session) {
    const state = config.enabled ? "\u0432\u043A\u043B\u044E\u0447\u0451\u043D" : "\u0432\u044B\u043A\u043B\u044E\u0447\u0435\u043D";
    const model = modelLabel(config) ?? "\u043D\u0435\u0442 (model-missing)";
    const last = status.lastAdviceAt ? new Date(status.lastAdviceAt).toLocaleTimeString() : "\u0441\u043E\u0432\u0435\u0442\u043E\u0432 \u0435\u0449\u0451 \u043D\u0435 \u0431\u044B\u043B\u043E";
    const latency = typeof status.lastMs === "number" ? `${status.lastMs} \u043C\u0441` : "\u2014";
    const mute = session?.disabled ? "\u0441\u0435\u0441\u0441\u0438\u044F \u0432\u044B\u043A\u043B\u044E\u0447\u0435\u043D\u0430" : session?.muted ? "\u043C\u043E\u043B\u0447\u0438\u0442 \u043F\u043E\u0441\u043B\u0435 \u043E\u0448\u0438\u0431\u043A\u0438 \u043C\u043E\u0434\u0435\u043B\u0438" : "\u0441\u0435\u0441\u0441\u0438\u044F \u0432\u043A\u043B\u044E\u0447\u0435\u043D\u0430";
    return `\u0441\u043E\u0441\u0442\u043E\u044F\u043D\u0438\u0435: ${state}, ${mute}; \u043C\u043E\u0434\u0435\u043B\u044C: ${model}; \u0432\u044B\u0437\u043E\u0432\u043E\u0432: ${status.calls}; \u0434\u0440\u043E\u043F\u043E\u0432: ${status.drops.empty + status.drops.unparsed + status.drops.error}; \u0437\u0430\u0434\u0435\u0440\u0436\u043A\u0430: ${latency}; ${last}`;
  }
  async function runCommand({ sessionID, prompt }) {
    const parsed = parseCommand(prompt?.text ?? "");
    const state = stateOf(sessionID);
    let text2;
    switch (parsed.kind) {
      case "toggle":
        state.disabled = !state.disabled;
        text2 = reply(`\u0441\u0435\u0441\u0441\u0438\u044F ${state.disabled ? "\u0432\u044B\u043A\u043B\u044E\u0447\u0435\u043D\u0430" : "\u0432\u043A\u043B\u044E\u0447\u0435\u043D\u0430"}`);
        break;
      case "on":
        state.disabled = false;
        state.muted = false;
        text2 = reply("\u0441\u0435\u0441\u0441\u0438\u044F \u0432\u043A\u043B\u044E\u0447\u0435\u043D\u0430");
        break;
      case "off":
        state.disabled = true;
        text2 = reply("\u0441\u0435\u0441\u0441\u0438\u044F \u0432\u044B\u043A\u043B\u044E\u0447\u0435\u043D\u0430");
        break;
      case "status":
        text2 = reply(statusLine(state));
        break;
      case "model-set":
        await patchConfig({
          provider: parsed.providerID,
          model: parsed.modelID
        });
        text2 = reply(`\u043C\u043E\u0434\u0435\u043B\u044C: ${parsed.providerID}/${parsed.modelID}`);
        break;
      case "model-reset":
        await patchConfig({
          provider: DEFAULTS.provider,
          model: DEFAULTS.model
        });
        text2 = reply("\u043C\u043E\u0434\u0435\u043B\u044C \u0441\u0431\u0440\u043E\u0448\u0435\u043D\u0430, \u0437\u0430\u0434\u0430\u0439\u0442\u0435 provider/model \u0437\u0430\u043D\u043E\u0432\u043E");
        break;
      default:
        text2 = reply(USAGE_TEXT);
    }
    await ctx.session.synthetic({
      sessionID,
      text: text2,
      description: "advisor:status",
      delivery: "steer"
    });
  }
  const registration = await ctx.command.transform((editor) => {
    editor.add({
      name: "advisor",
      description: "Advisor: on | off | status | model set|reset",
      execute: runCommand
    });
  });
  async function clearNote(sessionID) {
    try {
      await ctx.session.instructions?.entry?.remove({
        sessionID,
        key: NOTE_KEY2
      });
    } catch {
    }
  }
  async function handleEvent(event) {
    switch (event?.type) {
      case "session.step.started": {
        const sessionID = event.data?.sessionID;
        if (!sessionID) return;
        stateOf(sessionID).turns += 1;
        await clearNote(sessionID);
        return;
      }
      case "session.step.ended": {
        const sessionID = event.data?.sessionID;
        if (!sessionID) return;
        await onStepEnded(sessionID);
        await suggestNext(sessionID);
        return;
      }
      default:
    }
  }
  async function onStepEnded(sessionID) {
    const state = stateOf(sessionID);
    if (state.inFlight) return;
    if (!canReview(state, config, Date.now())) return;
    let info = null;
    try {
      info = await ctx.session.get({ sessionID });
    } catch {
      info = null;
    }
    const sessionDir = info?.location?.directory;
    if (sessionDir && resolve(String(sessionDir)) !== locationDir) return;
    const archived = Boolean(info?.time?.archived ?? info?.archived);
    if (info && !shouldReview({ parentID: info.parentID, archived })) return;
    if (state.inFlight) return;
    const started = Date.now();
    const result = await runReview({
      ctx,
      config,
      sessionID,
      state,
      now: started
    });
    const patch = {};
    if (result.kind !== "skipped") {
      counters.calls += 1;
      patch.calls = counters.calls;
    }
    if (result.kind === "dropped") {
      const reason = result.reason === "empty" || result.reason === "unparsed" || result.reason === "error" ? result.reason : "error";
      counters.drops[reason] += 1;
      patch.drops = { ...counters.drops };
      if (reason === "error") state.muted = true;
    }
    if (result.kind === "delivered") {
      lastAdviceAt = Date.now();
      lastMs = result.ms ?? null;
      cooldownUntil = state.cooldownUntil;
      patch.lastAdviceAt = lastAdviceAt;
      patch.lastMs = lastMs;
      patch.cooldownUntil = cooldownUntil;
      try {
        await appendRecord(journalPath, {
          kind: "advice",
          at: lastAdviceAt,
          sessionID,
          project: locationDir,
          severity: result.severity,
          note: result.note,
          model: modelLabel(config),
          ms: lastMs
        });
      } catch {
      }
    }
    if (Object.keys(patch).length > 0) await flush(patch);
  }
  const SUGGEST_EVERY_MS = 9e4;
  async function suggestNext(sessionID) {
    const state = stateOf(sessionID);
    if (!config.nextPrompt || state.disabled) return;
    if (state.suggesting) return;
    if (Date.now() - (state.lastSuggestAt ?? 0) < SUGGEST_EVERY_MS) return;
    const model = modelRef(config);
    if (!model) return;
    let raw2;
    try {
      raw2 = await ctx.session.context({ sessionID });
    } catch {
      return;
    }
    const messages = (Array.isArray(raw2) ? raw2 : []).map((message) => ({
      role: message?.type ?? message?.role ?? "user",
      text: Array.isArray(message?.content) ? message.content.filter((part) => part?.type === "text" && typeof part.text === "string").map((part) => part.text).join("\n") : typeof message?.text === "string" ? message.text : "",
      description: message?.description
    })).filter((message) => !String(message.description ?? "").startsWith("advisor:")).filter((message) => message.text.trim() !== "").slice(-20);
    if (messages.length === 0) return;
    const transcript = messages.map((message) => `${message.role === "user" ? "\u0447\u0435\u043B\u043E\u0432\u0435\u043A" : "\u0430\u0433\u0435\u043D\u0442"}: ${message.text}`).join("\n\n");
    state.suggesting = true;
    try {
      const answer = await ctx.experimental.generate.text({
        model: { providerID: model.providerID, id: model.modelID },
        prompt: buildNextPromptPrompt(transcript)
      });
      const text2 = parseSuggestion(answer?.text, config.nextPromptMaxChars);
      if (!text2) {
        await unlink(suggestionPath).catch(() => {
        });
        return;
      }
      state.lastSuggestAt = Date.now();
      await writeJsonAtomic(suggestionPath, {
        at: state.lastSuggestAt,
        sessionID,
        text: text2
      });
    } catch {
    } finally {
      state.suggesting = false;
    }
  }
  async function consume(iterable) {
    try {
      for await (const event of iterable) {
        try {
          await handleEvent(event);
        } catch {
        }
      }
    } catch {
    }
  }
  const controller = new AbortController();
  const subscription = ctx.event.subscribe({
    types: EVENT_TYPES,
    signal: controller.signal
  });
  let unsubscribe = () => {
  };
  if (subscription && typeof subscription[Symbol.asyncIterator] === "function") {
    void consume(subscription);
  } else if (typeof subscription === "function") {
    unsubscribe = subscription;
  }
  return async function dispose() {
    clearInterval(heartbeat);
    controller.abort();
    try {
      watcher?.close();
    } catch {
    }
    try {
      await unsubscribe();
    } catch {
    }
    try {
      await registration?.dispose?.();
    } catch {
    }
    try {
      await subscription?.return?.();
    } catch {
    }
    sessions.clear();
  };
}
var index_default = { id: "advisor", setup };
export {
  PLUGIN_VERSION,
  index_default as default,
  setup
};
