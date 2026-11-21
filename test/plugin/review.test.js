import test from "node:test";
import assert from "node:assert/strict";
import { runReview } from "../../src/plugin/review.js";

function ctxWith(
  reply,
  messages = [{ id: "1", role: "assistant", text: "готово" }],
) {
  const calls = { synthetic: [], entry: [] };
  return {
    calls,
    session: {
      context: async () => messages,
      synthetic: async (x) => calls.synthetic.push(x),
      instructions: {
        entry: {
          put: async (x) => calls.entry.push(x),
          remove: async () => {},
        },
      },
    },
    experimental: { generate: { text: async () => ({ text: reply }) } },
  };
}
const config = {
  provider: "p",
  model: "m",
  immuneTurns: 3,
  noteMaxChars: 40,
  enabled: true,
};

test("модель уходит в generate как providerID + id", async () => {
  let seen = null;
  const ctx = ctxWith('{"severity":"nit","guidance":"ок"}');
  ctx.experimental.generate.text = async (input) => {
    seen = input;
    return { text: '{"severity":"nit","guidance":"ок"}' };
  };
  await runReview({
    ctx,
    config,
    sessionID: "s",
    state: { lastSeenID: null, turns: 0 },
    now: 1,
  });
  assert.deepEqual(seen.model, { providerID: "p", id: "m" });
});

test("nit уходит в entry, агент не будится", async () => {
  const ctx = ctxWith('{"severity":"nit","guidance":"переименуй helper"}');
  const r = await runReview({
    ctx,
    config,
    sessionID: "s",
    state: { lastSeenID: null, turns: 0 },
    now: 1,
  });
  assert.equal(r.kind, "delivered");
  assert.equal(ctx.calls.synthetic.length, 0);
  assert.match(ctx.calls.entry[0].value, /переименуй/);
});

test("blocker уходит synthetic со steer", async () => {
  const ctx = ctxWith('{"severity":"blocker","guidance":"стоп"}');
  await runReview({
    ctx,
    config,
    sessionID: "s",
    state: { lastSeenID: null, turns: 0 },
    now: 1,
  });
  assert.equal(ctx.calls.synthetic[0].delivery, "steer");
  assert.match(ctx.calls.synthetic[0].text, /^\[advisor:blocker\]/);
});

test("мусорный ответ даёт dropped unparsed", async () => {
  const ctx = ctxWith("не JSON");
  const r = await runReview({
    ctx,
    config,
    sessionID: "s",
    state: { lastSeenID: null, turns: 0 },
    now: 1,
  });
  assert.equal(r.kind, "dropped");
  assert.equal(r.reason, "unparsed");
});

test("пользователь выключил во время вызова — не доставляем", async () => {
  const ctx = ctxWith('{"severity":"blocker","guidance":"стоп"}');
  const state = { lastSeenID: null, turns: 0 };
  const p = runReview({ ctx, config, sessionID: "s", state, now: 1 });
  state.disabled = true;
  await p;
  assert.equal(ctx.calls.synthetic.length, 0);
});

test("proseFallback доставляет прозу как nit", async () => {
  const ctx = ctxWith("Лучше вынести разбор в отдельную функцию.");
  const r = await runReview({
    ctx,
    config: { ...config, proseFallback: true, noteMaxChars: 60 },
    sessionID: "s",
    state: { lastSeenID: null, turns: 0 },
    now: 1,
  });
  assert.equal(r.kind, "delivered");
  assert.equal(r.severity, "nit");
  assert.match(ctx.calls.entry[0].value, /отдельную функцию/);
});
