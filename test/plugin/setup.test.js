import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import plugin from "../../src/plugin/index.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(check, timeoutMs = 3000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await check()) return true;
    await sleep(40);
  }
  return false;
}

function fakeCtx(options = {}) {
  const dir = mkdtempSync(join(tmpdir(), "adv-plugin-"));
  const commands = [];
  const subs = [];
  return {
    app: { version: "2.3.2" },
    options: {
      configDir: join(dir, "config"),
      stateDir: join(dir, "state"),
      ...options,
    },
    location: { directory: "/proj" },
    event: {
      subscribe: (o) => {
        subs.push(o);
        return () => {};
      },
    },
    command: {
      transform: async (fn) => {
        fn({ add: (c) => commands.push(c) });
      },
    },
    session: {
      context: async () => [],
      prompt: async () => {},
      synthetic: async () => {},
      get: async () => ({}),
    },
    experimental: { generate: { text: async () => ({ text: "" }) } },
    _commands: commands,
    _subs: subs,
  };
}

test("регистрирует /advisor и подписку на шаги", async () => {
  const ctx = fakeCtx();
  const dispose = await plugin.setup(ctx);
  assert.equal(plugin.id, "advisor");
  assert.deepEqual(
    ctx._commands.map((c) => c.name),
    ["advisor"],
  );
  assert.deepEqual(ctx._subs[0].types.includes("session.step.ended"), true);
  assert.equal(typeof dispose, "function");
  await dispose();
});

test("хук контекста дописывает карточку подсказки синхронно", async () => {
  const ctx = fakeCtx();
  const hooks = {};
  ctx.session.hook = async (name, handler) => {
    hooks[name] = handler;
    return { dispose() {} };
  };
  const dispose = await plugin.setup(ctx);
  assert.equal(typeof hooks.context, "function");

  const event = { sessionID: "s1", system: [] };
  hooks.context(event);
  assert.equal(event.system.length, 1);
  assert.match(event.system[0].text, /AdvisorNext\(\)/);

  await dispose();
});

test("без модели команда status сообщает причину", async () => {
  const ctx = fakeCtx();
  const dispose = await plugin.setup(ctx);
  const status = ctx._commands[0];
  let said = "";
  ctx.session.synthetic = async ({ text }) => {
    said = text;
  };
  await status.execute({
    sessionID: "s1",
    prompt: { text: "" },
    delivery: "steer",
  });
  assert.match(said, /model-missing|модель/i);
  await dispose();
});

test("атомарная замена config.json перечитывается, а не только первая", async () => {
  const ctx = fakeCtx();
  const dispose = await plugin.setup(ctx);
  const status = ctx._commands[0];
  const configPath = join(ctx.options.configDir, "config.json");
  const atomicWrite = (value) => {
    const temp = `${configPath}.${process.pid}.tmp`;
    writeFileSync(temp, JSON.stringify(value));
    renameSync(temp, configPath);
  };

  let said = "";
  ctx.session.synthetic = async ({ text }) => {
    said = text;
  };
  const ask = async () => {
    await status.execute({ sessionID: "s1", prompt: { text: "status" } });
    return said;
  };

  atomicWrite({ enabled: true, provider: "p1", model: "m1" });
  assert.equal(
    await waitFor(async () => (await ask()).includes("p1/m1")),
    true,
    said,
  );

  atomicWrite({ enabled: true, provider: "p2", model: "m2" });
  assert.equal(
    await waitFor(async () => (await ask()).includes("p2/m2")),
    true,
    said,
  );

  await dispose();
});
