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

test("шаг без текста не зовёт модель", async () => {
  let called = 0;
  const ctx = ctxWith("", [
    { id: "1", role: "assistant", text: "  " },
    { id: "2", role: "assistant", text: "" },
  ]);
  ctx.experimental.generate.text = async () => {
    called += 1;
    return { text: '{"severity":"nit","guidance":"ок"}' };
  };
  const r = await runReview({
    ctx,
    config,
    sessionID: "s",
    state: { lastSeenID: null, turns: 0 },
    now: 1,
  });
  assert.equal(r.kind, "skipped");
  assert.equal(called, 0);
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

test("две сессии одновременно: советы не перепутываются", async () => {
  let arrived = 0;
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const calls = { synthetic: [], entry: [] };
  const ctx = {
    session: {
      context: async ({ sessionID }) => [
        { id: `${sessionID}-1`, role: "assistant", text: `шаг ${sessionID}` },
      ],
      synthetic: async (x) => calls.synthetic.push(x),
      instructions: {
        entry: {
          put: async (x) => calls.entry.push(x),
          remove: async () => {},
        },
      },
    },
    experimental: {
      generate: {
        text: async ({ prompt }) => {
          arrived += 1;
          if (arrived === 2) release();
          await gate;
          const who = prompt.includes("шаг b") ? "b" : "a";
          return { text: `{"severity":"concern","guidance":"для ${who}"}` };
        },
      },
    },
  };
  const state = () => ({ lastSeenID: null, turns: 0 });
  const results = await Promise.all([
    runReview({ ctx, config, sessionID: "a", state: state(), now: 1 }),
    runReview({ ctx, config, sessionID: "b", state: state(), now: 2 }),
  ]);
  assert.deepEqual(results.map((r) => r.kind), ["delivered", "delivered"]);
  const byId = new Map(calls.synthetic.map((x) => [x.sessionID, x.text]));
  assert.match(byId.get("a"), /для a/);
  assert.match(byId.get("b"), /для b/);
  assert.deepEqual(calls.entry.map((x) => x.sessionID).sort(), ["a", "b"]);
});

test("шаг, разбуженный советом, не ревьюится", async () => {
  const messages = [
    { id: "u1", role: "user", text: "почини тест" },
    { id: "a1", role: "synthetic", description: "advisor:concern", text: "[advisor:concern] допиши вывод" },
    { id: "m1", role: "assistant", text: "готово" },
  ];
  const ctx = ctxWith('{"severity":"concern","guidance":"ещё совет"}', messages);
  const r = await runReview({
    ctx,
    config,
    sessionID: "s",
    state: { lastSeenID: null, turns: 0 },
    now: 1,
  });
  assert.equal(r.kind, "skipped");
  assert.equal(r.reason, "advisor-triggered");
  assert.equal(ctx.calls.synthetic.length, 0);
  assert.equal(ctx.calls.entry.length, 0);
});

test("новое сообщение человека снова включает ревью", async () => {
  const messages = [
    { id: "a1", role: "synthetic", description: "advisor:concern", text: "[advisor:concern] допиши вывод" },
    { id: "m1", role: "assistant", text: "дописал" },
    { id: "u2", role: "user", text: "теперь проверь сборку" },
    { id: "m2", role: "assistant", text: "собрал" },
  ];
  const ctx = ctxWith('{"severity":"concern","guidance":"прогони тесты"}', messages);
  const r = await runReview({
    ctx,
    config,
    sessionID: "s",
    state: { lastSeenID: null, turns: 0 },
    now: 1,
  });
  assert.equal(r.kind, "delivered");
});

test("один и тот же совет не доставляется дважды", async () => {
  const messages = [{ id: "u1", role: "user", text: "старт" }];
  const ctx = ctxWith('{"severity":"concern","guidance":"проверь край"}', messages);
  const state = { lastSeenID: null, turns: 0 };
  const first = await runReview({ ctx, config, sessionID: "s", state, now: 1 });

  messages.push({ id: "m2", role: "assistant", text: "ещё шаг" });
  const again = await runReview({ ctx, config, sessionID: "s", state, now: 2 });

  assert.equal(first.kind, "delivered");
  assert.equal(again.kind, "skipped");
  assert.equal(again.reason, "duplicate");
  assert.equal(ctx.calls.synthetic.length, 1);
});

test("сбой модели не сдвигает окно: шаги ревьюятся снова", async () => {
  const ctx = ctxWith('{"severity":"concern","guidance":"проверь край"}');
  let attempts = 0;
  ctx.experimental.generate.text = async () => {
    attempts += 1;
    if (attempts === 1) throw new Error("timeout");
    return { text: '{"severity":"concern","guidance":"проверь край"}' };
  };
  const state = { lastSeenID: null, turns: 0, inFlight: false, muted: false };

  const failed = await runReview({ ctx, config, sessionID: "s", state, now: 1 });
  assert.equal(failed.kind, "dropped");
  assert.equal(failed.reason, "error");
  assert.equal(state.lastSeenID, null);

  const retried = await runReview({ ctx, config, sessionID: "s", state, now: 2 });
  assert.equal(retried.kind, "delivered");
  assert.equal(attempts, 2);
  assert.equal(state.lastSeenID, "1");
});

test("пустой ответ двигает окно, чтобы шаг не ревьюился вечно", async () => {
  const ctx = ctxWith("NO_ADVICE");
  const state = { lastSeenID: null, turns: 0, inFlight: false, muted: false };

  const result = await runReview({
    ctx,
    config,
    sessionID: "s",
    state,
    now: 1,
  });

  assert.equal(result.reason, "empty");
  assert.equal(state.lastSeenID, "1");
});
