import { watch } from "node:fs";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, basename, join, resolve } from "node:path";

import { parseCommand } from "../core/command.js";
import { DEFAULTS, modelRef, normalizeConfig } from "../core/config.js";
import { appendRecord } from "../core/journal.js";
import { buildProvidersSnapshot } from "../core/providers.js";
import { journalFileName, suggestionFileName } from "../core/journal-format.js";
import { buildNextPromptPrompt, parseSuggestion } from "../core/next-prompt.js";
import { limitText } from "../core/limits.js";
import { canReview, shouldReview } from "../core/scope.js";
import { buildStatus, emptyCounters, statusFileName } from "../core/status.js";
import { runReview } from "./review.js";

export const PLUGIN_VERSION = "0.1.0";

const HEARTBEAT_MS = 10_000;
const ANSWER_MAX = 500;
const NOTE_KEY = "advisor-note";
const EVENT_TYPES = [
  "session.step.started",
  "session.step.ended",
  "session.execution.succeeded",
  "session.execution.failed",
];

const USAGE_TEXT =
  "advisor: on | off | status | model set <provider>/<model> | model reset";

function modelLabel(config) {
  const ref = modelRef(config);
  return ref ? `${ref.providerID}/${ref.modelID}` : null;
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    // A half-written or hand-broken file: fall back to defaults, do not throw.
    return {};
  }
}

async function writeJsonAtomic(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  await writeFile(temp, JSON.stringify(value, null, 2) + "\n");
  await rename(temp, path);
}

/**
 * OpenCode plugin: reviews a finished step with a separate model, delivers a
 * graded note into the agent's context, and keeps the journal and heartbeat the
 * OpenChamber panel reads.
 */
export async function setup(ctx) {
  const options = ctx.options ?? {};
  const home = options.homeDir ?? homedir();
  const configDir =
    options.configDir ?? join(home, ".config", "openchamber-advisor");
  const stateDir =
    options.stateDir ?? join(home, ".local", "state", "openchamber-advisor");
  const locationDir = resolve(String(ctx.location?.directory ?? process.cwd()));

  const configPath = join(configDir, "config.json");
  const statusPath = join(stateDir, statusFileName(locationDir));
  const journalPath = join(stateDir, journalFileName(locationDir));
  const suggestionPath = join(stateDir, suggestionFileName(locationDir));

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

  const sessions = new Map();
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
        cooldownUntil: 0,
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
      pluginVersion: PLUGIN_VERSION,
    },
    {},
    Date.now(),
  );
  let queue = Promise.resolve();

  const flush = (patch = {}) => {
    status = buildStatus(status, patch, Date.now());
    const snapshot = { ...status, at: Date.now() };
    queue = queue
      .then(() => writeJsonAtomic(statusPath, snapshot))
      .catch(() => {});
    return queue;
  };

  await flush({
    enabled: config.enabled,
    model: modelLabel(config),
    reason: errors[0] ?? null,
    appVersion: ctx.app?.version ?? null,
    lastAdviceAt: null,
    lastMs: null,
    cooldownUntil: null,
  });

  // The panel's model picker reads this snapshot: only models this server can
  // actually call, refreshed while the plugin lives.
  const providersPath = join(stateDir, "providers.json");
  let snapshotTick = 0;
  async function writeProviders() {
    try {
      const [models, providers] = await Promise.all([
        ctx.model?.list?.({ location: { directory: locationDir } }),
        ctx.provider?.list?.({ location: { directory: locationDir } }),
      ]);
      const snapshot = buildProvidersSnapshot(
        models?.data ?? models,
        providers?.data ?? providers,
      );
      if (snapshot.providers.length > 0)
        await writeJsonAtomic(providersPath, snapshot);
    } catch {
      // The panel falls back to free-text provider/model fields.
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
      // A config edit is one of the two ways out of a model-error silence.
      state.muted = false;
    }
    await flush({
      enabled: config.enabled,
      model: modelLabel(config),
      reason: errors[0] ?? null,
    });
  }

  let watcher;
  try {
    // Watch the directory, not the file: the panel replaces config.json with an
    // atomic rename, and a watch pinned to the old inode goes silent after it.
    const configName = basename(configPath);
    watcher = watch(
      dirname(configPath),
      { persistent: false },
      (_event, filename) => {
        if (filename && String(filename) !== configName) return;
        void reloadConfig().catch(() => {});
      },
    );
    watcher.unref?.();
  } catch {
    // No watcher means settings need a restart; everything else still works.
  }

  async function patchConfig(patch) {
    const current = (await readJson(configPath)) ?? { ...config };
    await writeJsonAtomic(configPath, { ...current, ...patch });
    await reloadConfig();
  }

  const reply = (body) => {
    const missing = errors.includes("model-missing")
      ? " Модель не задана (model-missing): укажите provider/model в панели или /advisor model set <provider>/<model>."
      : "";
    return limitText(`Advisor: ${body}${missing}`, ANSWER_MAX);
  };

  function statusLine(session) {
    const state = config.enabled ? "включён" : "выключен";
    const model = modelLabel(config) ?? "нет (model-missing)";
    const last = status.lastAdviceAt
      ? new Date(status.lastAdviceAt).toLocaleTimeString()
      : "советов ещё не было";
    const latency =
      typeof status.lastMs === "number" ? `${status.lastMs} мс` : "—";
    const mute = session?.disabled
      ? "сессия выключена"
      : session?.muted
        ? "молчит после ошибки модели"
        : "сессия включена";
    return `состояние: ${state}, ${mute}; модель: ${model}; вызовов: ${status.calls}; дропов: ${status.drops.empty + status.drops.unparsed + status.drops.error}; задержка: ${latency}; ${last}`;
  }

  async function runCommand({ sessionID, prompt }) {
    const parsed = parseCommand(prompt?.text ?? "");
    const state = stateOf(sessionID);
    let text;

    switch (parsed.kind) {
      case "toggle":
        state.disabled = !state.disabled;
        text = reply(`сессия ${state.disabled ? "выключена" : "включена"}`);
        break;
      case "on":
        state.disabled = false;
        state.muted = false;
        text = reply("сессия включена");
        break;
      case "off":
        state.disabled = true;
        text = reply("сессия выключена");
        break;
      case "status":
        text = reply(statusLine(state));
        break;
      case "model-set":
        await patchConfig({
          provider: parsed.providerID,
          model: parsed.modelID,
        });
        text = reply(`модель: ${parsed.providerID}/${parsed.modelID}`);
        break;
      case "model-reset":
        await patchConfig({
          provider: DEFAULTS.provider,
          model: DEFAULTS.model,
        });
        text = reply("модель сброшена, задайте provider/model заново");
        break;
      default:
        text = reply(USAGE_TEXT);
    }

    await ctx.session.synthetic({
      sessionID,
      text,
      description: "advisor:status",
      delivery: "steer",
    });
  }

  const registration = await ctx.command.transform((editor) => {
    editor.add({
      name: "advisor",
      description: "Advisor: on | off | status | model set|reset",
      execute: runCommand,
    });
  });

  async function clearNote(sessionID) {
    try {
      await ctx.session.instructions?.entry?.remove({
        sessionID,
        key: NOTE_KEY,
      });
    } catch {
      // No entry support (older server): the note simply was not set.
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
    // One server serves every location: never review a session that lives in a
    // different directory, or its advice lands in this one's context.
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
      now: started,
    });

    const patch = {};
    if (result.kind !== "skipped") {
      counters.calls += 1;
      patch.calls = counters.calls;
    }

    if (result.kind === "dropped") {
      const reason =
        result.reason === "empty" ||
        result.reason === "unparsed" ||
        result.reason === "error"
          ? result.reason
          : "error";
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
          ms: lastMs,
        });
      } catch {
        // A broken journal must not break the review loop.
      }
    }

    if (Object.keys(patch).length > 0) await flush(patch);
  }

  const SUGGEST_EVERY_MS = 90_000;

  /** Writes the panel's suggested next message; never sends it anywhere. */
  async function suggestNext(sessionID) {
    const state = stateOf(sessionID);
    if (!config.nextPrompt || state.disabled) return;
    if (state.suggesting) return;
    if (Date.now() - (state.lastSuggestAt ?? 0) < SUGGEST_EVERY_MS) return;
    const model = modelRef(config);
    if (!model) return;

    let raw;
    try {
      raw = await ctx.session.context({ sessionID });
    } catch {
      return;
    }
    const messages = (Array.isArray(raw) ? raw : [])
      .map((message) => ({
        role: message?.type ?? message?.role ?? "user",
        text: Array.isArray(message?.content)
          ? message.content
              .filter((part) => part?.type === "text" && typeof part.text === "string")
              .map((part) => part.text)
              .join("\n")
          : typeof message?.text === "string"
            ? message.text
            : "",
        description: message?.description,
      }))
      .filter((message) => !String(message.description ?? "").startsWith("advisor:"))
      .filter((message) => message.text.trim() !== "")
      .slice(-20);
    if (messages.length === 0) return;

    const transcript = messages
      .map((message) => `${message.role === "user" ? "человек" : "агент"}: ${message.text}`)
      .join("\n\n");

    state.suggesting = true;
    try {
      const answer = await ctx.experimental.generate.text({
        model: { providerID: model.providerID, id: model.modelID },
        prompt: buildNextPromptPrompt(transcript),
      });
      const text = parseSuggestion(answer?.text, config.nextPromptMaxChars);
      if (!text) {
        // The request is satisfied (or needs the person): drop the stale offer.
        await unlink(suggestionPath).catch(() => {});
        return;
      }
      state.lastSuggestAt = Date.now();
      await writeJsonAtomic(suggestionPath, {
        at: state.lastSuggestAt,
        sessionID,
        text,
      });
    } catch {
      // A suggestion is a nicety: a failed call leaves the previous one.
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
          // One bad event must not end the subscription.
        }
      }
    } catch {
      // Aborted on dispose, or the stream failed: the plugin keeps working.
    }
  }

  const controller = new AbortController();
  const subscription = ctx.event.subscribe({
    types: EVENT_TYPES,
    signal: controller.signal,
  });
  let unsubscribe = () => {};
  if (
    subscription &&
    typeof subscription[Symbol.asyncIterator] === "function"
  ) {
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
      // Already closed.
    }
    try {
      await unsubscribe();
    } catch {
      // Nothing to undo.
    }
    try {
      await registration?.dispose?.();
    } catch {
      // Nothing to undo.
    }
    try {
      await subscription?.return?.();
    } catch {
      // Nothing to undo.
    }
    sessions.clear();
  };
}

export default { id: "advisor", setup };
