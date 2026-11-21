# OpenChamber Advisor — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Расширение OpenChamber с ревьюером-советником: отдельная модель читает ход агента и вставляет совет с уровнем важности ему в контекст, журнал советов виден в правой панели и в Work Status.

**Architecture:** Один пакет-расширение; внутри — плагин OpenCode (собирается в один файл без зависимостей) и страница панели (IIFE). Плагин делает вызовы модели и доставку, пишет журнал и heartbeat в файлы; страница читает файлы через `host.readFile` и показывает UI. Общего рантайма между ними нет.

**Tech Stack:** JavaScript ESM (Node 22.23), `node --test`, esbuild 0.28 (`npx`), `@openchamber/sdk`, `@opencode/plugin` только как тип/документация.

**Spec:** `docs/superpowers/specs/2026-11-21-advisor-design.md`

## Global Constraints

- Каталог проекта: `/mnt/f/_Project/Plugins/Opencode/opencode-advisor-extended`.
- GitHub: `triagmas/opencode-advisor-extended`, приватный, `gh` уже авторизован; после каждого коммита — `git push`.
- `package.json` → `openchamber.apiVersion: 1`, `engines.openchamber: ">=2.5.0"`, `id: "advisor"`.
- `contributes.filesystem`: `["~/.local/state/openchamber-advisor/**", "~/.config/openchamber-advisor/**"]`.
- `contributes.opencodePlugin: "plugin"`; `plugin/index.js` — один самодостаточный файл, без импортов из `node_modules`.
- Дефолты конфига: `immuneTurns: 3`, `maxDeltaMessages: 60`, `noteMaxChars: 768`, `proseFallback: false`, `enabled: true`.
- Обрезка текста — по границе слова, `…` входит в лимит.
- Ротация журнала: 1 МБ или 5000 строк, один бэкап `.1`.
- Heartbeat устаревает через 30 000 мс.
- Права манифеста: без `prompt`, `model`, `sessions`, сервиса и сети.
- Ревью только сессий без `parentID`, архивные пропускаются.

## Review Focus

1. Битая или недописанная строка журнала (падение посреди записи) — панель показывает остальное, а не падает и не теряет весь файл.
2. Плагин не загрузился (удалённый OpenCode, изолированное пространство) — панель пишет «не запущен», а не «советов нет».
3. Модель не задана или не авторизована — ревьюер молчит, статус объясняет причину, основной цикл работает.
4. Пользователь выключил ревьюера в середине шага — запоздавший ответ модели не доставляется.
5. Две локации (worktree) пишут одновременно — записи не смешиваются, ротация одной не съедает журнал другой.

---

### Task 1: Каркас проекта, манифест, сборка

**Files:**
- Create: `package.json`, `.gitignore`, `panel/index.html`, `src/panel/main.js`, `scripts/build.mjs`
- Test: `test/manifest.test.js`

**Interfaces:**
- Produces: `npm run build` → `panel/main.js` (IIFE) и `plugin/index.js`; `panel/index.html` грузит только `./main.js`.

- [x] **Step 1: Инициализировать репозиторий, создать GitHub и зависимости**

```bash
cd "/mnt/f/_Project/Plugins/Opencode/opencode-advisor-extended"
git init -b main
printf 'node_modules/\n' > .gitignore
git add -A && git commit -m "docs: spec and implementation plan"
gh repo create triagmas/opencode-advisor-extended --private --source=. --remote=origin --push
npm init -y
npm i -D esbuild@0.28.2
```

Expected: `gh repo view triagmas/opencode-advisor-extended` показывает репозиторий, `git remote -v` — origin.

- [x] **Step 2: Написать падающий тест манифеста**

```js
// test/manifest.test.js
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const oc = pkg.openchamber

test('манифест объявляет расширение и поверхности', () => {
  assert.equal(oc.apiVersion, 1)
  assert.equal(oc.id, 'advisor')
  assert.equal(oc.contributes.panel.entry, 'panel/index.html')
  assert.equal(oc.contributes.statusSection.entry, 'status/index.html')
  assert.equal(oc.contributes.opencodePlugin, 'plugin')
})

test('права ограничены двумя каталогами', () => {
  assert.deepEqual(oc.contributes.filesystem, [
    '~/.local/state/openchamber-advisor/**',
    '~/.config/openchamber-advisor/**',
  ])
  assert.equal(oc.contributes.capabilities, undefined)
})

test('файлы расширения на месте', () => {
  for (const p of ['panel/index.html', 'panel/main.js', 'status/index.html', 'plugin/index.js']) {
    assert.ok(existsSync(new URL(`../${p}`, import.meta.url)), p)
  }
})
```

- [x] **Step 3: Запустить тест, убедиться что падает**

Run: `node --test test/manifest.test.js`
Expected: FAIL — `oc` is undefined.

- [x] **Step 4: Создать package.json, скрипт сборки и пустые страницы**

`package.json` держит `"type": "module"`, скрипты `build` (esbuild для панели и плагина), `test` (`node --test test`). Блок `openchamber` — ровно как в тесте; `statusSection: { entry: "status/index.html", title: "Advisor", height: 200 }`, `panel: { entry: "panel/index.html" }`, `icon: "sparkling"`.

`scripts/build.mjs` собирает:
- `src/panel/main.js` → `panel/main.js`, `--format=iife --platform=browser --bundle`;
- `src/plugin/index.js` → `plugin/index.js`, `--format=esm --platform=node --bundle --external:@opencode/plugin`.

`panel/index.html` и `status/index.html` — минимальный HTML с `<script src="./main.js"></script>`.

- [x] **Step 5: Собрать и прогнать тесты**

Run: `npm run build && node --test test/manifest.test.js`
Expected: PASS, `panel/main.js` и `plugin/index.js` существуют.

- [x] **Step 6: Коммит**

```bash
git add -A && git commit -m "chore: scaffold extension package and build"
```

---

### Task 2: Обрезка текста и разбор кадра совета

**Files:**
- Create: `src/core/limits.js`, `src/core/frame.js`
- Test: `test/core/limits.test.js`, `test/core/frame.test.js`

**Interfaces:**
- Produces: `limitText(text: string, max: number): string`; `parseAdviceFrame(text: string): { severity: 'nit'|'concern'|'blocker', guidance: string } | null`.

- [x] **Step 1: Написать падающие тесты**

```js
// test/core/limits.test.js
import test from 'node:test'
import assert from 'node:assert/strict'
import { limitText } from '../../src/core/limits.js'

test('короткий текст не меняется', () => {
  assert.equal(limitText('коротко', 20), 'коротко')
})

test('режет по границе слова и ставит многоточие в лимит', () => {
  const out = limitText('один два три четыре', 12)
  assert.ok(out.length <= 12)
  assert.ok(out.endsWith('…'))
  assert.ok(!out.includes('четыр'))
})

test('одно длинное слово режется жёстко', () => {
  assert.equal(limitText('abcdefghij', 4), 'abc…')
})
```

```js
// test/core/frame.test.js
import test from 'node:test'
import assert from 'node:assert/strict'
import { parseAdviceFrame } from '../../src/core/frame.js'

test('разбирает JSON в тексте и в заборе', () => {
  const a = parseAdviceFrame('{"severity":"concern","guidance":"проверь ветку"}')
  assert.deepEqual(a, { severity: 'concern', guidance: 'проверь ветку' })
  const b = parseAdviceFrame('```json\n{"severity":"nit","guidance":"x"}\n```')
  assert.equal(b.severity, 'nit')
})

test('неизвестный уровень и мусор дают null', () => {
  assert.equal(parseAdviceFrame('{"severity":"warn","guidance":"x"}'), null)
  assert.equal(parseAdviceFrame('просто проза'), null)
  assert.equal(parseAdviceFrame('{"severity":"nit"}'), null)
})
```

- [x] **Step 2: Запустить, убедиться что падает**

Run: `node --test test/core`
Expected: FAIL — модулей нет.

- [x] **Step 3: Реализовать `limitText` и `parseAdviceFrame`**

`limitText`: если `text.length <= max` — вернуть как есть; иначе отрезать `max - 1` символов, откатиться до последнего пробела (если он дальше половины), обрезать хвост, добавить `…`. `parseAdviceFrame`: найти первый `{` и последний `}`, `JSON.parse`, проверить, что `severity` из трёх значений и `guidance` — непустая строка; иначе `null`.

- [x] **Step 4: Прогнать тесты**

Run: `node --test test/core`
Expected: PASS.

- [x] **Step 5: Коммит**

```bash
git add src/core test/core && git commit -m "feat: text limit and advice frame parser"
```

---

### Task 3: Журнал

**Files:**
- Create: `src/core/journal.js`
- Test: `test/core/journal.test.js`

**Interfaces:**
- Produces:
  - `journalFileName(locationDir: string): string` — `journal-<8 hex>.jsonl`;
  - `appendRecord(path: string, record: object, fsOps?): Promise<void>` — атомарная дозапись с ротацией;
  - `parseJournal(text: string): object[]` — пропускает битые строки;
  - `ROTATE_BYTES = 1_000_000`, `ROTATE_LINES = 5000`.

- [x] **Step 1: Написать падающие тесты**

```js
// test/core/journal.test.js
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { journalFileName, appendRecord, parseJournal, ROTATE_LINES } from '../../src/core/journal.js'

test('имя файла стабильно и различается по локации', () => {
  assert.equal(journalFileName('/a/b'), journalFileName('/a/b'))
  assert.notEqual(journalFileName('/a/b'), journalFileName('/a/c'))
  assert.match(journalFileName('/a/b'), /^journal-[0-9a-f]{8}\.jsonl$/)
})

test('дозапись добавляет строку', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'adv-'))
  const p = join(dir, 'journal-x.jsonl')
  await appendRecord(p, { at: 1, note: 'a' })
  await appendRecord(p, { at: 2, note: 'b' })
  const lines = readFileSync(p, 'utf8').trim().split('\n')
  assert.equal(lines.length, 2)
  assert.equal(JSON.parse(lines[1]).note, 'b')
})

test('битая строка не ломает разбор остальных', () => {
  const recs = parseJournal('{"at":1}\n{битая\n{"at":2}\n')
  assert.deepEqual(recs.map(r => r.at), [1, 2])
})

test('ротация по числу строк оставляет бэкап .1', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'adv-'))
  const p = join(dir, 'journal-x.jsonl')
  writeFileSync(p, Array.from({ length: ROTATE_LINES }, () => '{"at":0}').join('\n') + '\n')
  await appendRecord(p, { at: 1 })
  assert.ok(readFileSync(p + '.1', 'utf8').length > 0)
  assert.equal(parseJournal(readFileSync(p, 'utf8')).length, 1)
})
```

- [x] **Step 2: Запустить, убедиться что падает**

Run: `node --test test/core/journal.test.js`
Expected: FAIL — модуля нет.

- [x] **Step 3: Реализовать модуль**

`journalFileName` — `createHash('sha256').update(locationDir).digest('hex').slice(0, 8)`. `appendRecord` — прочитать `stat` файла; если `size + newLine > ROTATE_BYTES` или строк `>= ROTATE_LINES`, `rename` в `.1` (перезаписывая старый бэкап), затем `appendFile` одной строкой `JSON.stringify(record) + '\n'`. `parseJournal` — split по `\n`, `JSON.parse` в try/catch, пропуск пустых и битых.

- [x] **Step 4: Прогнать тесты**

Run: `node --test test/core/journal.test.js`
Expected: PASS.

- [x] **Step 5: Коммит**

```bash
git add src/core/journal.js test/core/journal.test.js && git commit -m "feat: append-only journal with rotation"
```

---

### Task 4: Конфиг и гейт модели

**Files:**
- Create: `src/core/config.js`
- Test: `test/core/config.test.js`

**Interfaces:**
- Produces: `DEFAULTS`; `normalizeConfig(raw: unknown): { config, errors: string[] }`; `modelRef(config): { providerID, modelID } | null`.

- [ ] **Step 1: Написать падающие тесты**

```js
// test/core/config.test.js
import test from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULTS, normalizeConfig, modelRef } from '../../src/core/config.js'

test('пустой конфиг даёт дефолты и ошибку про модель', () => {
  const { config, errors } = normalizeConfig({})
  assert.equal(config.immuneTurns, 3)
  assert.equal(config.noteMaxChars, 768)
  assert.equal(config.enabled, true)
  assert.deepEqual(errors, ['model-missing'])
  assert.equal(modelRef(config), null)
})

test('полная пара моделей проходит, лишние ключи отбрасываются', () => {
  const { config, errors } = normalizeConfig({ provider: 'opencode-go', model: 'x', junk: 1 })
  assert.deepEqual(errors, [])
  assert.equal(config.junk, undefined)
  assert.deepEqual(modelRef(config), { providerID: 'opencode-go', modelID: 'x' })
})

test('границы значений зажимаются', () => {
  const { config } = normalizeConfig({ immuneTurns: -5, noteMaxChars: 99999, maxDeltaMessages: 'нет' })
  assert.equal(config.immuneTurns, 0)
  assert.equal(config.noteMaxChars, 4096)
  assert.equal(config.maxDeltaMessages, DEFAULTS.maxDeltaMessages)
})
```

- [ ] **Step 2: Запустить, убедиться что падает**

Run: `node --test test/core/config.test.js`
Expected: FAIL — модуля нет.

- [ ] **Step 3: Реализовать модуль**

`DEFAULTS = { enabled: true, provider: '', model: '', immuneTurns: 3, maxDeltaMessages: 60, noteMaxChars: 768, proseFallback: false }`. `normalizeConfig` берёт только известные ключи, числа зажимает (immuneTurns 0–50, noteMaxChars 128–4096, maxDeltaMessages 0–500), булевы приводит, `errors` получает `model-missing`, если `provider` или `model` пустые.

- [ ] **Step 4: Прогнать тесты**

Run: `node --test test/core/config.test.js`
Expected: PASS.

- [ ] **Step 5: Коммит**

```bash
git add src/core/config.js test/core/config.test.js && git commit -m "feat: config defaults and model gate"
```

---

### Task 5: Heartbeat статуса

**Files:**
- Create: `src/core/status.js`
- Test: `test/core/status.test.js`

**Interfaces:**
- Produces: `statusFileName(locationDir): string`; `buildStatus(prev, patch, now): object`; `isStale(status, now, ttlMs = 30_000): boolean`; `emptyCounters(): { calls, drops: { empty, unparsed, error } }`.

- [ ] **Step 1: Написать падающие тесты**

```js
// test/core/status.test.js
import test from 'node:test'
import assert from 'node:assert/strict'
import { buildStatus, isStale, emptyCounters } from '../../src/core/status.js'

test('патч не теряет счётчики и ставит время', () => {
  const s = buildStatus({ ...emptyCounters(), at: 0 }, { calls: 2 }, 1000)
  assert.equal(s.calls, 2)
  assert.equal(s.at, 1000)
  assert.deepEqual(s.drops, { empty: 0, unparsed: 0, error: 0 })
})

test('устаревание по TTL', () => {
  assert.equal(isStale({ at: 0 }, 29_999), false)
  assert.equal(isStale({ at: 0 }, 30_001), true)
  assert.equal(isStale(undefined, 1), true)
})
```

- [ ] **Step 2: Запустить, убедиться что падает**

Run: `node --test test/core/status.test.js`
Expected: FAIL — модуля нет.

- [ ] **Step 3: Реализовать модуль**

`buildStatus(prev = {}, patch = {}, now = Date.now())` — поверхностное слияние, `drops` сливается по ключам, `at: now`. `isStale(status, now, ttl)` — `!status || now - status.at > ttl`.

- [ ] **Step 4: Прогнать тесты**

Run: `node --test test/core/status.test.js`
Expected: PASS.

- [ ] **Step 5: Коммит**

```bash
git add src/core/status.js test/core/status.test.js && git commit -m "feat: status heartbeat model"
```

---

### Task 6: Область действия, cooldown, дельта

**Files:**
- Create: `src/core/scope.js`, `src/core/delta.js`
- Test: `test/core/scope.test.js`, `test/core/delta.test.js`

**Interfaces:**
- Produces: `shouldReview(session: { parentID?: string, archived?: boolean }): boolean`; `canReview(state, config, now): boolean`; `markReviewed(state, now, turns): void`; `collectDelta(messages, lastSeenID, maxMessages): { messages, lastSeenID }`.

- [ ] **Step 1: Написать падающие тесты**

```js
// test/core/scope.test.js
import test from 'node:test'
import assert from 'node:assert/strict'
import { shouldReview, canReview, markReviewed } from '../../src/core/scope.js'

test('сабагенты и архив не ревьюим', () => {
  assert.equal(shouldReview({}), true)
  assert.equal(shouldReview({ parentID: 'p' }), false)
  assert.equal(shouldReview({ archived: true }), false)
})

test('cooldown держит immuneTurns шагов', () => {
  const state = { cooldownUntil: 0, turns: 0 }
  markReviewed(state, 1000, 3)
  assert.equal(state.turns, 0)
  assert.equal(canReview(state, { enabled: true }, 1000), false)
  state.turns = 3
  assert.equal(canReview(state, { enabled: true }, 1000), true)
  assert.equal(canReview(state, { enabled: false }, 1000), false)
})

test('busy не ревьюим', () => {
  assert.equal(canReview({ turns: 0, inFlight: true }, { enabled: true }, 0), false)
})
```

```js
// test/core/delta.test.js
import test from 'node:test'
import assert from 'node:assert/strict'
import { collectDelta } from '../../src/core/delta.js'

const m = (id, role, text = 't', description) => ({ id, role, text, description })

test('берёт только новые сообщения после lastSeenID', () => {
  const msgs = [m('1', 'user'), m('2', 'assistant'), m('3', 'user')]
  const out = collectDelta(msgs, '1', 10)
  assert.deepEqual(out.messages.map(x => x.id), ['2', '3'])
  assert.equal(out.lastSeenID, '3')
})

test('свои сообщения и synthetic компакции выпадают', () => {
  const msgs = [m('1', 'user'), m('2', 'synthetic', 'advisor: [advisor:concern] x', 'advisor:concern'), m('3', 'synthetic', 'compact', 'compaction'), m('4', 'assistant')]
  const out = collectDelta(msgs, '1', 10)
  assert.deepEqual(out.messages.map(x => x.id), ['4'])
})

test('maxMessages оставляет хвост и не теряет lastSeenID', () => {
  const msgs = [m('1', 'user'), m('2', 'assistant'), m('3', 'user'), m('4', 'assistant')]
  const out = collectDelta(msgs, '1', 1)
  assert.deepEqual(out.messages.map(x => x.id), ['4'])
  assert.equal(out.lastSeenID, '4')
})
```

- [ ] **Step 2: Запустить, убедиться что падает**

Run: `node --test test/core/scope.test.js test/core/delta.test.js`
Expected: FAIL — модулей нет.

- [ ] **Step 3: Реализовать модули**

`shouldReview` — `!session.parentID && !session.archived`. `canReview` — `config.enabled && !state.inFlight && (state.turns >= state.immuneTurns)`; `markReviewed(state, now, immuneTurns)` ставит `turns = 0`, `immuneTurns`, `inFlight = false`. `collectDelta` — фильтр по индексу после `lastSeenID`, выкидывает `description`, начинающиеся с `advisor:`, и `compaction`, оставляет последние `maxMessages` (0 = все) для модели, а `lastSeenID` ставит по последнему сообщению полного отфильтрованного хвоста — так выпавшие из окна сообщения не ревьюятся дважды.

- [ ] **Step 4: Прогнать тесты**

Run: `node --test test/core/scope.test.js test/core/delta.test.js`
Expected: PASS.

- [ ] **Step 5: Коммит**

```bash
git add src/core/scope.js src/core/delta.js test/core && git commit -m "feat: session scope, cooldown and transcript delta"
```

---

### Task 7: Плагин: каркас, конфиг, heartbeat, `/advisor`

**Files:**
- Create: `src/plugin/index.js`
- Test: `test/plugin/setup.test.js`

**Interfaces:**
- Consumes: Task 4 `normalizeConfig`, Task 5 `buildStatus`, Task 3 `appendRecord`.
- Produces: default export `{ id: 'advisor', setup(ctx) }`; `setup` возвращает `dispose()`; регистрирует команды `advisor.on|off|status|model`.

- [ ] **Step 1: Написать падающий тест на фейковом ctx**

```js
// test/plugin/setup.test.js
import test from 'node:test'
import assert from 'node:assert/strict'
import plugin from '../../src/plugin/index.js'

function fakeCtx(options = {}) {
  const commands = []
  const subs = []
  const writes = []
  return {
    app: { version: '2.3.2' },
    options,
    location: { directory: '/proj' },
    event: { subscribe: (o) => { subs.push(o); return () => {} } },
    command: { transform: async (fn) => { fn({ add: (c) => commands.push(c) }) } },
    session: { context: async () => [], prompt: async () => {}, synthetic: async () => {}, get: async () => ({}) },
    experimental: { generate: { text: async () => ({ text: '' }) } },
    _commands: commands,
    _subs: subs,
  }
}

test('регистрирует /advisor и подписку на шаги', async () => {
  const ctx = fakeCtx()
  const dispose = await plugin.setup(ctx)
  assert.equal(plugin.id, 'advisor')
  assert.deepEqual(ctx._commands.map(c => c.name), ['advisor'])
  assert.deepEqual(ctx._subs[0].types.includes('session.step.ended'), true)
  assert.equal(typeof dispose, 'function')
})

test('без модели команда status сообщает причину', async () => {
  const ctx = fakeCtx()
  await plugin.setup(ctx)
  const status = ctx._commands[0]
  let said = ''
  ctx.session.synthetic = async ({ text }) => { said = text }
  await status.execute({ sessionID: 's1', prompt: { text: '' }, delivery: 'steer' })
  assert.match(said, /model-missing|модель/i)
})
```

- [ ] **Step 2: Запустить, убедиться что падает**

Run: `node --test test/plugin/setup.test.js`
Expected: FAIL — модуля нет.

- [ ] **Step 3: Реализовать каркас**

`setup(ctx)`: определить каталоги (`~/.config/openchamber-advisor`, `~/.local/state/openchamber-advisor`) через `ctx.location.directory`; прочитать/создать `config.json`; `normalizeConfig`; подписаться на `session.step.started`, `session.step.ended`, `session.execution.succeeded`, `session.execution.failed`; зарегистрировать команду `advisor` с подкомандами `on|off|status|model set|model reset`; запустить heartbeat (`setInterval` 10 000 мс, `unref()`), писать `status-<loc>.json`; вернуть `dispose`, который чистит таймер, подписки и `fs.watch` конфига.

Разбор аргументов команды — отдельная чистая функция `parseCommand(args)` в `src/core/command.js` с тестом: `''` → toggle, `on`, `off`, `status`, `model set p/m`, `model reset`, мусор → `{ kind: 'usage' }`. Ветка `model set` пишет пару в `config.json` (файл перечитывается `fs.watch`), `model reset` удаляет пару из конфига; обе отвечают через `synthetic`.

- [ ] **Step 4: Прогнать тесты**

Run: `node --test test/plugin test/core/command.test.js`
Expected: PASS.

- [ ] **Step 5: Коммит**

```bash
git add src/plugin src/core/command.js test && git commit -m "feat: plugin skeleton, config, heartbeat and /advisor"
```

---

### Task 8: Ревью и доставка

**Files:**
- Create: `src/plugin/review.js`, `src/plugin/prompts.js`
- Modify: `src/plugin/index.js`
- Test: `test/plugin/review.test.js`

**Interfaces:**
- Consumes: Task 2 `limitText`/`parseAdviceFrame`, Task 6 `collectDelta`.
- Produces: `runReview({ ctx, config, sessionID, state, now }): Promise<{ kind: 'delivered'|'skipped'|'dropped', severity?, reason? }>`.

- [ ] **Step 1: Написать падающие тесты**

```js
// test/plugin/review.test.js
import test from 'node:test'
import assert from 'node:assert/strict'
import { runReview } from '../../src/plugin/review.js'

function ctxWith(reply, messages = [{ id: '1', role: 'assistant', text: 'готово' }]) {
  const calls = { synthetic: [], entry: [] }
  return {
    calls,
    session: {
      context: async () => messages,
      synthetic: async (x) => calls.synthetic.push(x),
      instructions: { entry: { put: async (x) => calls.entry.push(x), remove: async () => {} } },
    },
    experimental: { generate: { text: async () => ({ text: reply }) } },
  }
}
const config = { provider: 'p', model: 'm', immuneTurns: 3, noteMaxChars: 40, enabled: true }

test('nit уходит в entry, агент не будится', async () => {
  const ctx = ctxWith('{"severity":"nit","guidance":"переименуй helper"}')
  const r = await runReview({ ctx, config, sessionID: 's', state: { lastSeenID: null, turns: 0 }, now: 1 })
  assert.equal(r.kind, 'delivered')
  assert.equal(ctx.calls.synthetic.length, 0)
  assert.match(ctx.calls.entry[0].value, /переименуй/)
})

test('blocker уходит synthetic со steer', async () => {
  const ctx = ctxWith('{"severity":"blocker","guidance":"стоп"}')
  await runReview({ ctx, config, sessionID: 's', state: { lastSeenID: null, turns: 0 }, now: 1 })
  assert.equal(ctx.calls.synthetic[0].delivery, 'steer')
  assert.match(ctx.calls.synthetic[0].text, /^\[advisor:blocker\]/)
})

test('мусорный ответ даёт dropped unparsed', async () => {
  const ctx = ctxWith('не JSON')
  const r = await runReview({ ctx, config, sessionID: 's', state: { lastSeenID: null, turns: 0 }, now: 1 })
  assert.equal(r.kind, 'dropped')
  assert.equal(r.reason, 'unparsed')
})

test('пользователь выключил во время вызова — не доставляем', async () => {
  const ctx = ctxWith('{"severity":"blocker","guidance":"стоп"}')
  const state = { lastSeenID: null, turns: 0 }
  const p = runReview({ ctx, config, sessionID: 's', state, now: 1 })
  state.disabled = true
  await p
  assert.equal(ctx.calls.synthetic.length, 0)
})

test('proseFallback доставляет прозу как nit', async () => {
  const ctx = ctxWith('Лучше вынести разбор в отдельную функцию.')
  const r = await runReview({ ctx, config: { ...config, proseFallback: true }, sessionID: 's', state: { lastSeenID: null, turns: 0 }, now: 1 })
  assert.equal(r.kind, 'delivered')
  assert.equal(r.severity, 'nit')
  assert.match(ctx.calls.entry[0].value, /отдельную функцию/)
})
```

- [ ] **Step 2: Запустить, убедиться что падает**

Run: `node --test test/plugin/review.test.js`
Expected: FAIL — модуля нет.

- [ ] **Step 3: Реализовать `runReview` и тексты промптов**

`runReview`: `collectDelta`, один `experimental.generate.text`, `limitText` до отправки дельты (≈16 000 знаков), `parseAdviceFrame`; если кадр не разобрался и `proseFallback` включён — взять ответ как есть с уровнем `nit`; проверка `state.disabled` **после** ответа, обрезка `noteMaxChars`, доставка: `nit` → `instructions.entry.put({ sessionID, key: 'advisor-note', value })`; иначе `synthetic({ sessionID, text: '[advisor:severity] ' + note, description: 'advisor:' + severity, delivery: 'steer' })` плюс entry; вернуть результат.

`prompts.js` — `REVIEWER_SYSTEM` (роль, три уровня, требование JSON-кадра, запрет на команды) и `buildReviewPrompt(deltaText)`.

- [ ] **Step 4: Прогнать тесты**

Run: `node --test test/plugin/review.test.js`
Expected: PASS.

- [ ] **Step 5: Подключить в каркас и проверить сборку**

Run: `npm run build && node --test test`
Expected: PASS; `plugin/index.js` собирается без внешних импортов (`grep -c "from '" plugin/index.js` → 0).

- [ ] **Step 6: Коммит**

```bash
git add -A && git commit -m "feat: review loop with severity delivery"
```

---

### Task 9: Панель

**Files:**
- Create: `src/panel/main.js`, `src/panel/view.js`, `panel/index.html`
- Test: `test/panel/view.test.js`

**Interfaces:**
- Consumes: Task 3 `parseJournal`, Task 5 `isStale`.
- Produces: `buildJournalView({ records, sessionID, allProjects }): { rows, empty }`; `mergeRecords(files: object[][]): object[]`; `connectionState(status, now): 'live'|'stale'|'missing'`.

- [ ] **Step 1: Написать падающие тесты**

```js
// test/panel/view.test.js
import test from 'node:test'
import assert from 'node:assert/strict'
import { buildJournalView, mergeRecords, connectionState } from '../../src/panel/view.js'

const rec = (sessionID, at, severity = 'nit') => ({ kind: 'advice', sessionID, at, severity, note: `${severity} @${at}` })

test('журнал фильтруется по сессии и сортируется новыми вверх', () => {
  const v = buildJournalView({ records: [rec('a', 1), rec('b', 2), rec('a', 3)], sessionID: 'a', allProjects: false })
  assert.deepEqual(v.rows.map(r => r.at), [3, 1])
  assert.equal(v.empty, false)
})

test('пустой журнал помечается отдельно', () => {
  assert.equal(buildJournalView({ records: [], sessionID: 'a', allProjects: false }).empty, true)
})

test('склейка файлов разных локаций', () => {
  const merged = mergeRecords([[rec('a', 1)], [rec('a', 2), rec('a', 2)]])
  assert.deepEqual(merged.map(r => r.at), [1, 2])
})

test('состояние связи по heartbeat', () => {
  assert.equal(connectionState(undefined, 10), 'missing')
  assert.equal(connectionState({ at: 0 }, 29_000), 'live')
  assert.equal(connectionState({ at: 0 }, 31_000), 'stale')
})
```

- [ ] **Step 2: Запустить, убедиться что падает**

Run: `node --test test/panel/view.test.js`
Expected: FAIL — модуля нет.

- [ ] **Step 3: Реализовать view-модели**

`buildJournalView` фильтрует по `sessionID` (или все при `allProjects`), сортирует по `at` вниз, возвращает `{ rows, empty: rows.length === 0 }`. `mergeRecords` склеивает и убирает дубли по `at + note`. `connectionState` — `missing`, `live` (< 30 000 мс), `stale`.

- [ ] **Step 4: Реализовать страницу**

`src/panel/main.js`: `connectHost()`, `applyHostReady` в `onReady`, три вкладки, чтение `journal-*.jsonl` и `status-*.json` по `listDir`/`readFile`, опрос раз в 2 000 мс только при `document.visibilityState === 'visible'`, кнопки «в инпут» (`host.compose`), «сохранить» (`writeFile` конфига), бейджи уровней. Разметка — на элементах UI kit; своих цветов нет.

- [ ] **Step 5: Собрать и прогнать тесты**

Run: `npm run build && node --test test`
Expected: PASS; `panel/main.js` — IIFE (`grep -c "import " panel/main.js` → 0).

- [ ] **Step 6: Коммит**

```bash
git add -A && git commit -m "feat: advisor panel with journal, settings and status"
```

---

### Task 10: Секция Work Status

**Files:**
- Create: `src/panel/status.js`, `status/index.html`
- Modify: `scripts/build.mjs`
- Test: `test/panel/status.test.js`

**Interfaces:**
- Consumes: Task 9 `connectionState`, Task 3 `parseJournal`.
- Produces: `latestForSession(records, sessionID): object | null`.

- [ ] **Step 1: Написать падающий тест**

```js
// test/panel/status.test.js
import test from 'node:test'
import assert from 'node:assert/strict'
import { latestForSession } from '../../src/panel/status.js'

test('берёт последний совет сессии', () => {
  const recs = [{ kind: 'advice', sessionID: 'a', at: 1 }, { kind: 'advice', sessionID: 'a', at: 5 }, { kind: 'suggestion', sessionID: 'a', at: 9 }]
  assert.equal(latestForSession(recs, 'a').at, 5)
  assert.equal(latestForSession(recs, 'b'), null)
})
```

- [ ] **Step 2: Запустить, убедиться что падает**

Run: `node --test test/panel/status.test.js`
Expected: FAIL — модуля нет.

- [ ] **Step 3: Реализовать страницу**

`latestForSession` — фильтр `kind === 'advice'` и `sessionID`, максимум по `at`. Страница `src/panel/status.js`: те же чтения раз в 3 000 мс, `setHeight(200)` по `ResizeObserver`, строка уровня, кнопка «в инпут», счётчик за сессию, плашка «ревьюер выключен»/«не запущен». Сборка добавляет второй вход → `status/main.js`.

- [ ] **Step 4: Собрать и прогнать тесты**

Run: `npm run build && node --test test`
Expected: PASS; `status/main.js` существует.

- [ ] **Step 5: Коммит**

```bash
git add -A && git commit -m "feat: work status section"
```

---

### Task 11: Документация и ручная проверка

**Files:**
- Create: `README.md`
- Modify: `docs/superpowers/specs/2026-11-21-advisor-design.md` (только раздел «Статус»)

- [ ] **Step 1: Написать README**

Установка (Settings → Extensions → Add → путь), что просит при установке, настройка модели, `/advisor`, где лежат файлы, что делать при `stale`/`disabled-with-reason`, как отключить.

- [ ] **Step 2: Собрать и прогнать все тесты**

Run: `npm run build && node --test test`
Expected: PASS, без пропусков.

- [ ] **Step 3: Ручная проверка в OpenChamber (чеклист в README)**

1. Установка по пути → иконка на рейке, диалог прав с двумя паттернами и строкой про плагин.
2. `/advisor status` без модели → текст про `model-missing`.
3. Задать модель в панели → `/advisor status` показывает её, heartbeat `live`.
4. Шаг агента с явной ошибкой в правке → в журнале запись, у агента виден `nit`.
5. `concern`/`blocker` с `synthetic` + `steer` действительно будят простаивающего агента; если нет — зафиксировать в README как известное ограничение и вернуться к fallback на `session.prompt`.
6. Выключить ревьюера → новых записей нет, статус «выключен».
7. Work Status → последний совет и кнопка «в инпут».

- [ ] **Step 4: Коммит и публикация**

```bash
git add -A && git commit -m "docs: install and manual checklist"
git push -u origin main
```

Expected: `git status -sb` → `## main...origin/main`, `gh repo view triagmas/opencode-advisor-extended` открывается.
