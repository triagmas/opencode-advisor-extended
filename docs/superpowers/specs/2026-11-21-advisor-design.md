# OpenChamber Advisor — дизайн

Дата: 2026-11-21. Статус: утверждён; реализация по плану, ручная проверка — по чеклисту README.
Проект: `/mnt/f/_hermes/CODE/openchamber-advisor`.

## 1. Зачем

В DSH работал `dsh-advisor`: отдельная модель-ревьюер читала ход основного агента и
вставляла совет с уровнем важности обратно в контекст. В OpenChamber такого нет.

Нужен один пакет, который даёт:

1. совет ревьюера, попадающий в контекст агента, а не только человеку;
2. правую панель с историей советов по текущей сессии и по проекту;
3. секцию в Work Status рядом с чатом с последним советом и счётчиками.

Предсказание следующего промпта писать не нужно: в OpenChamber оно уже есть
(Session Assist, §2.1) и показывает подсказку чипом над полем ввода.

## 2. Факты платформы (проверено)

OpenChamber 2.7.3, OpenCode v2.3.2.

Расширение OpenChamber (`@openchamber/sdk`):

- папка с `package.json` (блок `openchamber`, `apiVersion: 1`), `panel/index.html` и
  собранным IIFE `panel/main.js`; страница живёт в песочнице iframe;
- поверхности: панель на правой рейке (`contributes.panel`), секция в Work Status
  (`contributes.statusSection`), полноэкранная страница, блоки в ответах агента,
  команды `/`, меню `+` и `@`;
- `host.compose({ text, mode })` — кладёт текст в поле ввода без отправки;
- `host.readFile/writeFile/listDir/stat` — относительные пути требуют capability
  `files`, абсолютные и `~/…` — объявленных паттернов `contributes.filesystem`
  (glob `*` и `**`, атомарная запись, до 2 МБ);
- `contributes.opencodePlugin: "<folder>"` — папка с `index.js` или `server.js`,
  default-export `{ id, setup }`, без импортов: OpenCode грузит её через bare
  `import()` из папки, где ничего не установлено;
- права выводятся из манифеста и показываются в диалоге установки; панель и чтение
  текущей сессии — без разрешений.

Плагин OpenCode (V2, `@opencode/plugin`):

- `Plugin.define({ id, setup(ctx) })`;
- `ctx.experimental.generate.text({ model, prompt })` — вызов модели без сессии,
  без истории, без инструментов;
- `ctx.event.subscribe({ types })` — события `session.step.started`,
  `session.step.ended` (поля `sessionID`, `assistantMessageID`, `finish`),
  `session.execution.succeeded`, `session.execution.failed`;
- `ctx.session.context({ sessionID })` — сообщения сессии;
- `ctx.session.instructions.entry.put/remove({ sessionID, key, value })` — entry
  объявляется на границе шага и не создаёт ход (замена «inject» из DSH);
- `ctx.session.synthetic({ sessionID, text, description, delivery })` — скрытое
  сообщение с отдельной ролью; носитель `Session.Inbox.Synthetic` принимает
  `delivery: "steer"`;
- `ctx.command.transform(editor => editor.add(...))` — команды `/advisor`.

### 2.1 Session Assist — встроенный предсказатель

Отдельная серверная подсистема OpenChamber (`packages/web/server/lib/session-assist`):

- после простоя сессии (idle + тихое окно 60 с) делает вызов Small Model и пишет
  `metadata.openchamber.assist` = `{ recap, suggestion, forMessageID, generatedAt }`;
- `suggestion` показывается чипом над полем ввода: иконка карандаша, клик —
  вставить в инпут, X — скрыть, наведение — полный текст;
- `recap` (краткое напоминание о работе) появляется после 60 с тишины;
- выключается настройками `sessionSuggestionEnabled` и `sessionRecapEnabled`;
- читает до трёх человеческих ходов, вырезает payload инструментов и вложения.

Отсюда: наш плагин предсказание не дублирует и `metadata.openchamber.assist` не
трогает.

## 3. Цели, не-цели, анти-цели

Цели:

- совет входит в контекст агента и виден в панели;
- ни один сбой ревьюера не тормозит и не ломает основной цикл;
- журнал переживает перезапуск OpenChamber и OpenCode;
- панель и Work Status выглядят как части OpenChamber (UI kit SDK).

Не-цели:

- предсказание следующего промпта — уже есть в Session Assist;
- ghost-текст в терминальном TUI и в поле ввода OpenChamber;
- правки ядра OpenChamber и форк OpenCode;
- несколько ревьюеров на сессию;
- ревью дочерних сессий (сабагентов);
- синхронизация журнала между машинами.

Анти-цели (провал, даже если работает):

- совет без уровня важности;
- ревьюер, который может остановить или зациклить основной цикл;
- текст ревьюера, выданный за сообщение пользователя.

## 4. Подходы

A. **Расширение + плагин OpenCode в одном пакете** (выбран). Плагин делает ревью и
   пишет журнал; панель читает файл и рисует UI. Семантика DSH сохраняется,
   установка одна.

B. **Только расширение.** Совет виден человеку, но в контекст агента не попадает:
   у страницы нет доступа к `instructions.entry`. Это журнал, а не advisor.

C. **Расширение с сервисом-мозгом.** Локальный сервис сам зовёт модель и хранит
   журнал, панель читает через `serviceRequest`. Нет файлового моста, но лишний
   процесс с полным доступом пользователя и свой путь к API OpenCode.

Выбран A: единственный вариант, где совет реально доходит до агента, при этом
дешевле C по числу движущихся частей.

## 5. Архитектура

```
OpenCode server
  plugin/index.js ──(session.step.ended)──► delta транскрипта
        │                                    │
        │ generate.text(reviewer)            │
        ▼                                    ▼
  instructions.entry / synthetic(steer)  journal-<loc>.jsonl (append)
        │                                    ▲
        │                                    │ readFile + poll по mtime
        └── status.json (heartbeat) ───► panel/ ◄─ readFile
                                            │  compose(text) → поле ввода
                                            │  writeFile(config.json)
                                            ▼
                                   plugin читает config.json (fs.watch)
```

Мост между страницей и плагином — файлы, потому что у песочницы нет другого канала
к серверному коду плагина.

Файлы на диске:

- `~/.local/state/openchamber-advisor/journal-<loc>.jsonl` — журнал, одна строка
  JSON на запись; `<loc>` — первые 8 hex sha256 канонического каталога проекта,
  чтобы две локации (worktree) не писали в один файл; ротация при 1 МБ или
  5000 строк (переименование в `.1`);
- `~/.local/state/openchamber-advisor/status-<loc>.json` — heartbeat:
  `{ pluginVersion, startedAt, at, enabled, model, calls, drops, lastAdviceAt,
  lastMs, cooldownUntil }`; перезапись при изменении и раз в 10 с; старше 30 с —
  панель считает плагин не запущенным;
- `~/.config/openchamber-advisor/config.json` — настройки, пишет панель, читает
  плагин;

Пакет:

```
package.json            манифест + скрипты сборки
panel/index.html        страница панели
panel/main.js           собранный IIFE (из panel/main.ts)
status/index.html       секция Work Status (тот же бандл, ctx.surface === "status")
plugin/index.js         плагин OpenCode, без зависимостей, один файл
plugin/prompts.js       тексты промптов (относительный импорт)
docs/                   спеки и README
```

## 6. Плагин: поведение

Область действия: только корневые сессии (`Session.Info.parentID` пуст), архивные
пропускаются; события сабагентов игнорируются.

Запуск:

1. читает `config.json`; нет файла — создаёт дефолтный;
2. валидирует `provider` + `model`; при неполной паре модель не зовётся, в статус
   пишется `disabled-with-reason`;
3. подписывается на события и на `fs.watch` конфига; перезагружает настройки без
   рестарта;
4. при выгрузке отменяет подписки, незавершённые вызовы и таймер heartbeat.

Ревью (`session.step.ended`):

1. пропустить, если сессия выключена, идёт cooldown `immuneTurns` или уже идёт
   ревью этой сессии;
2. взять дельту: сообщения после последнего просмотренного `messageID`, не больше
   `maxDeltaMessages` (0 — без ограничения); сообщения с `description`, начинающимся
   на `advisor:`, и synthetic-вставки компакции в дельту не попадают;
3. один вызов `generate.text`; ответ — JSON-кадр
   `{ "severity": "nit|concern|blocker", "guidance": "..." }`;
4. обрезать `guidance` по границе слова до `noteMaxChars`, добавить `…`;
5. доставка:
   - `nit` → `instructions.entry.put({ key: "advisor-note", value })`; при
     следующем `session.step.started` entry удаляется — совет живёт один шаг;
   - `concern` и `blocker` → `session.synthetic({ text: "[advisor:concern] …",
     description: "advisor:concern", delivery: "steer" })` плюс тот же entry;
     затем cooldown `immuneTurns`;
6. записать в журнал `{ at, sessionID, project, severity, note, model, ms }`;
7. ошибки и неразобранный кадр — в `drops` по классу (`empty`, `unparsed`,
   `error`); `proseFallback: true` доставляет прозу как `nit`.

Команда `/advisor` (ответ — `synthetic` с `description: "advisor:status"`,
короткий текст до 500 знаков):

- `/advisor on|off` — переключатель текущей сессии, в памяти;
- `/advisor status` — состояние, модель, счётчики, последняя активность;
- `/advisor model set <provider>/<model>` — пишет в `config.json`, живёт после
  рестарта; `/advisor model reset` — возвращает дефолт из конфига.

Ограничения: не больше одного вызова модели на сессию одновременно; дедлайн вызова
60 с; при ошибке модели ревьюер молчит до `/advisor on` или правки конфига.

## 7. Панель и Work Status

Панель (`ctx.surface === "panel"`), вкладки:

- **Журнал** — записи текущей сессии, переключатель «вся история проекта», бейдж
  уровня, время, кнопка «в инпут» (`compose`), «скопировать»;
- **Настройки** — on/off, provider/model, `immuneTurns`, `maxDeltaMessages`,
  `noteMaxChars`, `proseFallback`; сохранение в `config.json`;
- **Статус** — версия плагина, модель, вызовы, дропы по классам, последняя
  активность, средняя задержка; `disabled-with-reason`, если модель не задана;
  «плагин не запущен», если heartbeat старше 30 с.

Секция Work Status (`ctx.surface === "status"`, высота 200): последний совет с
уровнем и кнопкой «в инпут», счётчик советов за сессию, индикатор «ревьюер
выключен».

Обновление: панель опрашивает `stat()` журнала и heartbeat раз в 2 с, только пока
видима; файл перечитывается при изменении mtime, берётся хвост. Секция — раз в 3 с.
Журналы разных локаций панель склеивает по `at`.

UI собирается на `@openchamber/sdk/ui` (`applyHostReady` в `onReady`), тема
наследуется; своих цветов не вводим.

## 8. Права

Манифест объявляет:

- `contributes.panel` и `contributes.statusSection` — без разрешений;
- `contributes.filesystem`: `["~/.local/state/openchamber-advisor/**",
  "~/.config/openchamber-advisor/**"]`;
- `contributes.opencodePlugin: "plugin"` — строка «Add a plugin to OpenCode».

Не запрашиваем: `prompt`, `model`, `sessions`, сервис, сеть.

## 9. Риски и как их снимаем

- **Файловый мост.** Панель и плагин не видят друг друга напрямую. Пишем атомарно
  (`writeFile` SDK), журнал только дописываем, читаем по mtime; журнал на локацию —
  два инстанса плагина не делят файл.
- **Heartbeat врёт.** Панель различает «советов ещё нет» и «плагин не запущен» по
  возрасту heartbeat (30 с); на удалённом OpenCode и в изолированном пространстве
  это ожидаемое состояние, а не ошибка.
- **`synthetic` + `steer`.** Что synthetic-сообщение с `delivery: "steer"` будит
  простаивающего агента, проверяется первым спайком; если нет — fallback на
  `session.prompt` с меткой в тексте, и анти-цель про «сообщение пользователя»
  фиксируется в тестах.
- **Версии.** `apiVersion: 1`, `engines.openchamber: ">=2.5.0"`; плагин сверяет
  `ctx.app.version` и пишет предупреждение в статус.
- **Стоимость.** Один вызов модели на шаг; `immuneTurns: 3`; без модели ревьюер
  молчит.
- **Песочница.** Бандл IIFE, без сети; всё через host API.
- **Плагин без зависимостей.** `plugin/index.js` не импортирует ничего, кроме
  `./prompts.js`.

## 10. Решения, принятые автором дизайна (проверить при чтении)

- Журнал — JSONL, не SQLite: панели нужен хвост, зависимостей у плагина быть не
  может.
- Мост — файлы, не локальный сервис: сервис требует отдельного одобрения и своего
  доступа к API OpenCode.
- Третье состояние — `status.json` heartbeat: без него панель не отличает «тишину»
  от «плагин не загрузился» и не может показать счётчики.
- Счётчики и liveness живут только в heartbeat, в журнал не пишутся: журнал — для
  советов.
- Ревью только корневых сессий: сабагенты не получают советов и не тратят токены
  вдвое.
- `concern`/`blocker` доставляются `synthetic` с `steer`, а не `prompt`: роль не
  пользовательская, анти-цель не нарушается.
- `nit` живёт один шаг: entry ставится перед шагом и снимается на следующем
  `session.step.started`.
- `/advisor model set` пишет `config.json` (переживает рестарт), `on|off` — только
  в памяти сессии.
- TUI-часть не делаем: вы работаете в OpenChamber.
- Подсказка не вставляется в инпут автоматически: `compose` без спроса затирал бы
  черновик.
- Ротация журнала — 1 МБ / 5000 строк, один бэкап `.1`.

## 11. Замечания независимой проверки и как они закрыты

1. Где живут счётчики и liveness → `status-<loc>.json`, перезапись раз в 10 с,
   устаревание 30 с (§5, §7).
2. Какие сессии в области действия → только корневые, без сабагентов; журнал на
   локацию, чтобы два инстанса не делили файл (§5, §6).
3. `prompt` против `synthetic` → `synthetic` с отдельной ролью и `steer` (§6);
   поведение проверяется спайком (§9).
4. Чем отвечает `/advisor` и что переживает рестарт → `synthetic`-ответ;
   `model set` пишет конфиг, `on|off` — нет (§6).
5. Сколько живёт `nit` → один шаг, снятие на `session.step.started` (§6).
