// src/plugin/index.js
import { watch } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

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
  proseFallback: false
});
var LIMITS = {
  immuneTurns: { min: 0, max: 50 },
  maxDeltaMessages: { min: 0, max: 500 },
  noteMaxChars: { min: 128, max: 4096 }
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
    proseFallback: bool(input.proseFallback, DEFAULTS.proseFallback)
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

// src/core/journal-format.js
import { createHash } from "node:crypto";
function journalFileName(locationDir) {
  const digest = createHash("sha256").update(String(locationDir ?? "")).digest("hex");
  return `journal-${digest.slice(0, 8)}.jsonl`;
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

// src/plugin/index.js
var PLUGIN_VERSION = "0.1.0";
var HEARTBEAT_MS = 1e4;
var ANSWER_MAX = 500;
var NOTE_KEY = "advisor-note";
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
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    return {};
  }
}
async function writeJsonAtomic(path, value) {
  await mkdir(join(path, ".."), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  await writeFile(temp, JSON.stringify(value, null, 2) + "\n");
  await rename(temp, path);
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
  await mkdir(configDir, { recursive: true });
  await mkdir(stateDir, { recursive: true });
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
      state = { lastSeenID: null, turns: 0, immuneTurns: config.immuneTurns, inFlight: false, disabled: false, cooldownUntil: 0 };
      sessions.set(sessionID, state);
    }
    return state;
  };
  let status = buildStatus({ ...emptyCounters(), startedAt: Date.now(), pluginVersion: PLUGIN_VERSION }, {}, Date.now());
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
    appVersion: ctx.app?.version ?? null
  });
  const heartbeat = setInterval(() => {
    void flush();
  }, HEARTBEAT_MS);
  heartbeat.unref?.();
  async function reloadConfig() {
    const fresh = await readJson(configPath);
    if (fresh === null) return;
    applied = normalizeConfig(fresh);
    config = applied.config;
    errors = applied.errors;
    await flush({ enabled: config.enabled, model: modelLabel(config), reason: errors[0] ?? null });
  }
  let watcher;
  try {
    watcher = watch(configPath, { persistent: false }, () => {
      void reloadConfig().catch(() => {
      });
    });
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
  function statusLine() {
    const state = config.enabled ? "\u0432\u043A\u043B\u044E\u0447\u0451\u043D" : "\u0432\u044B\u043A\u043B\u044E\u0447\u0435\u043D";
    const model = modelLabel(config) ?? "\u043D\u0435\u0442 (model-missing)";
    const last = status.lastAdviceAt ? new Date(status.lastAdviceAt).toLocaleTimeString() : "\u0441\u043E\u0432\u0435\u0442\u043E\u0432 \u0435\u0449\u0451 \u043D\u0435 \u0431\u044B\u043B\u043E";
    const latency = typeof status.lastMs === "number" ? `${status.lastMs} \u043C\u0441` : "\u2014";
    return `\u0441\u043E\u0441\u0442\u043E\u044F\u043D\u0438\u0435: ${state}; \u043C\u043E\u0434\u0435\u043B\u044C: ${model}; \u0432\u044B\u0437\u043E\u0432\u043E\u0432: ${status.calls}; \u0434\u0440\u043E\u043F\u043E\u0432: ${status.drops.empty + status.drops.unparsed + status.drops.error}; \u043F\u043E\u0441\u043B\u0435\u0434\u043D\u044F\u044F \u0437\u0430\u0434\u0435\u0440\u0436\u043A\u0430: ${latency}; ${last}`;
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
        text2 = reply("\u0441\u0435\u0441\u0441\u0438\u044F \u0432\u043A\u043B\u044E\u0447\u0435\u043D\u0430");
        break;
      case "off":
        state.disabled = true;
        text2 = reply("\u0441\u0435\u0441\u0441\u0438\u044F \u0432\u044B\u043A\u043B\u044E\u0447\u0435\u043D\u0430");
        break;
      case "status":
        text2 = reply(statusLine());
        break;
      case "model-set":
        await patchConfig({ provider: parsed.providerID, model: parsed.modelID });
        text2 = reply(`\u043C\u043E\u0434\u0435\u043B\u044C: ${parsed.providerID}/${parsed.modelID}`);
        break;
      case "model-reset":
        await patchConfig({ provider: DEFAULTS.provider, model: DEFAULTS.model });
        text2 = reply("\u043C\u043E\u0434\u0435\u043B\u044C \u0441\u0431\u0440\u043E\u0448\u0435\u043D\u0430, \u0437\u0430\u0434\u0430\u0439\u0442\u0435 provider/model \u0437\u0430\u043D\u043E\u0432\u043E");
        break;
      default:
        text2 = reply(USAGE_TEXT);
    }
    await ctx.session.synthetic({ sessionID, text: text2, description: "advisor:status", delivery: "steer" });
  }
  const registration = await ctx.command.transform((editor) => {
    editor.add({ name: "advisor", description: "Advisor: on | off | status | model set|reset", execute: runCommand });
  });
  async function clearNote(sessionID) {
    try {
      await ctx.session.instructions?.entry?.remove({ sessionID, key: NOTE_KEY });
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
        return;
      }
      default:
    }
  }
  async function onStepEnded(_sessionID) {
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
  const subscription = ctx.event.subscribe({ types: EVENT_TYPES, signal: controller.signal });
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
