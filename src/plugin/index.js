import { watch } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

import { parseCommand } from "../core/command.js";
import { DEFAULTS, modelRef, normalizeConfig } from "../core/config.js";
import { appendRecord } from "../core/journal.js";
import { journalFileName } from "../core/journal-format.js";
import { migrateLegacyData } from "../core/migrate.js";
import { limitText } from "../core/limits.js";
import { canReview, shouldReview } from "../core/scope.js";
import { runReview } from "./review.js";

export const PLUGIN_VERSION = "0.2.0";

const ANSWER_MAX = 500;
const EVENT_TYPES = ["session.step.started", "session.step.ended"];

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
 * OpenCode plugin: reviews a finished step with a separate model and delivers a
 * graded note into the agent's context. The journal on disk is the record; the
 * plugin draws nothing.
 */
export async function setup(ctx) {
  const options = ctx.options ?? {};
  const home = options.homeDir ?? homedir();
  const configDir = options.configDir ?? join(home, ".config", "opencode-advisor");
  const stateDir = options.stateDir ?? join(home, ".local", "state", "opencode-advisor");
  const locationDir = resolve(String(ctx.location?.directory ?? process.cwd()));

  await mkdir(configDir, { recursive: true });
  await mkdir(stateDir, { recursive: true });

  // The extension used to be an OpenChamber one, with its own directories. The
  // journals are the only record a person cannot recreate, so they move first.
  if (options.migrate !== false) {
    await migrateLegacyData({ homeDir: home, configDir, stateDir }).catch(
      () => {},
    );
  }

  const configPath = join(configDir, "config.json");
  const journalPath = join(stateDir, journalFileName(locationDir));

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

  const counters = { calls: 0, drops: { empty: 0, unparsed: 0, error: 0 } };
  let lastAdviceAt = null;
  let lastMs = null;
  let lastSkip = null;

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
  }

  let watcher;
  try {
    // Watch the directory, not the file: editors replace config.json with an
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
      ? " Модель не задана (model-missing): укажите provider/model в config.json или /advisor model set <provider>/<model>."
      : "";
    return limitText(`Advisor: ${body}${missing}`, ANSWER_MAX);
  };

  function statusLine(session) {
    const state = config.enabled ? "включён" : "выключен";
    const model = modelLabel(config) ?? "нет (model-missing)";
    const last = lastAdviceAt
      ? new Date(lastAdviceAt).toLocaleTimeString()
      : "советов ещё не было";
    const latency = typeof lastMs === "number" ? `${lastMs} мс` : "—";
    const mute = session?.disabled
      ? "сессия выключена"
      : session?.muted
        ? "молчит после ошибки модели"
        : "сессия включена";
    const drop = counters.drops.empty + counters.drops.unparsed + counters.drops.error;
    const skip = lastSkip?.reason ? `; пропуск: ${lastSkip.reason}` : "";
    return `состояние: ${state}, ${mute}; модель: ${model}; вызовов: ${counters.calls}; дропов: ${drop}${skip}; задержка: ${latency}; ${last}`;
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
        key: "advisor-note",
      });
    } catch {
      // No entry support (older server): the note simply was not set.
    }
  }

  async function handleEvent(event) {
    if (event?.type === "session.step.started") {
      const sessionID = event.data?.sessionID;
      if (!sessionID) return;
      stateOf(sessionID).turns += 1;
      await clearNote(sessionID);
      return;
    }
    if (event?.type === "session.step.ended") {
      const sessionID = event.data?.sessionID;
      if (!sessionID) return;
      await onStepEnded(sessionID);
    }
  }

  async function onStepEnded(sessionID) {
    // Why a step was not reviewed is the first thing a silent session is asked
    // about; `/advisor status` answers from the last reason kept here.
    const noteSkip = (reason) => {
      lastSkip = { reason, at: Date.now() };
    };

    const state = stateOf(sessionID);
    if (state.inFlight) return noteSkip("in-flight");
    if (!canReview(state, config, Date.now())) return noteSkip("gate");

    let info = null;
    try {
      info = await ctx.session.get({ sessionID });
    } catch {
      info = null;
    }
    // One server serves every location: never review a session that lives in a
    // different directory, or its advice lands in this one's context.
    const sessionDir = info?.location?.directory;
    if (sessionDir && resolve(String(sessionDir)) !== locationDir)
      return noteSkip("foreign");

    const archived = Boolean(info?.time?.archived ?? info?.archived);
    if (info && !shouldReview({ parentID: info.parentID, archived }))
      return noteSkip("subagent");
    if (state.inFlight) return noteSkip("in-flight");

    const result = await runReview({
      ctx,
      config,
      sessionID,
      state,
      now: Date.now(),
    });
    if (result.kind === "skipped") noteSkip(result.reason ?? "skipped");
    if (result.kind !== "skipped") counters.calls += 1;

    if (result.kind === "dropped") {
      const reason =
        result.reason === "empty" ||
        result.reason === "unparsed" ||
        result.reason === "error"
          ? result.reason
          : "error";
      counters.drops[reason] += 1;
      if (reason === "error") state.muted = true;
    }

    if (result.kind === "delivered") {
      lastAdviceAt = Date.now();
      lastMs = result.ms ?? null;
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
  if (subscription && typeof subscription[Symbol.asyncIterator] === "function") {
    void consume(subscription);
  } else if (typeof subscription === "function") {
    unsubscribe = subscription;
  }

  return async function dispose() {
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
