import { connectHost } from '@openchamber/sdk'
import {
  applyHostReady,
  mountBadge,
  mountBanner,
  mountButton,
  mountEmpty,
  mountSwitch,
  mountTabs,
  mountTextField,
} from '@openchamber/sdk/ui'

import { DEFAULTS, normalizeConfig } from '../core/config.js'
import { parseJournal } from '../core/journal-parse.js'
import { buildJournalView, connectionState, mergeRecords, severityTone } from './view.js'

const STATE_DIR = '~/.local/state/openchamber-advisor'
const CONFIG_PATH = '~/.config/openchamber-advisor/config.json'
const POLL_MS = 2_000

const host = connectHost()
const root = document.getElementById('root')

const state = {
  tab: 'journal',
  sessionID: null,
  allProjects: false,
  records: [],
  status: null,
  config: { ...DEFAULTS },
  draft: null,
  message: null,
}

const style = document.createElement('style')
style.textContent = `
  .adv { display: flex; flex-direction: column; gap: 12px; height: 100%; min-height: 0; font: inherit; color: var(--oc-fg); }
  .adv-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .adv-title { font-weight: 600; }
  .adv-pane { display: flex; flex-direction: column; gap: 10px; min-height: 0; overflow: auto; padding-bottom: 8px; }
  .adv-row { display: flex; flex-direction: column; gap: 6px; padding: 10px; border: 1px solid var(--oc-border); border-radius: var(--oc-radius); }
  .adv-row-head { display: flex; align-items: center; gap: 8px; }
  .adv-time { color: var(--oc-muted); font-size: 0.85em; }
  .adv-note { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
  .adv-actions { display: flex; gap: 6px; flex-wrap: wrap; }
  .adv-field { display: flex; flex-direction: column; gap: 4px; }
  .adv-status-row { display: flex; justify-content: space-between; gap: 12px; padding: 4px 0; border-bottom: 1px solid var(--oc-border); }
  .adv-status-label { color: var(--oc-muted); }
  .adv-status-value { text-align: right; overflow-wrap: anywhere; }
`
document.head.append(style)

function element(tag, className, text) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

const layout = element('div', 'adv')
const head = element('div', 'adv-head')
const headTitle = element('span', 'adv-title', 'Advisor')
const headBadge = element('span')
head.append(headTitle, headBadge)

const tabsHost = element('div')
const panes = element('div', 'adv-pane')
layout.append(head, tabsHost, panes)
root.append(layout)

// --- journal --------------------------------------------------------------

const journalPane = element('div', 'adv-pane')
const journalControls = element('div')
const journalRows = element('div', 'adv-pane')
journalPane.append(journalControls, journalRows)

const allProjectsSwitch = mountSwitch(journalControls, {
  label: 'Вся история проекта',
  checked: false,
  onChange: (checked) => {
    state.allProjects = checked
    renderJournal()
  },
})

// --- settings -------------------------------------------------------------

const settingsPane = element('div', 'adv-pane')
const settingsFields = element('div', 'adv-pane')
const settingsActions = element('div', 'adv-actions')
const settingsNotice = element('div')
settingsPane.append(settingsFields, settingsActions, settingsNotice)

const fieldHandles = {}

function addField(key, label) {
  const hostNode = element('div', 'adv-field')
  settingsFields.append(hostNode)
  fieldHandles[key] = mountTextField(hostNode, {
    label,
    value: '',
    onChange: (value) => {
      state.draft = { ...(state.draft ?? {}), [key]: value }
      state.message = null
      renderSettingsNotice()
    },
  })
}

addField('provider', 'Provider')
addField('model', 'Model')
addField('immuneTurns', 'Пропускать шагов после совета')
addField('maxDeltaMessages', 'Сообщений в обзоре (0 — без ограничения)')
addField('noteMaxChars', 'Длина совета, знаков')

const enabledSwitch = mountSwitch(settingsFields, {
  label: 'Ревьюер включён',
  checked: DEFAULTS.enabled,
  onChange: (checked) => {
    state.draft = { ...(state.draft ?? {}), enabled: checked }
    state.message = null
    renderSettingsNotice()
  },
})

const proseSwitch = mountSwitch(settingsFields, {
  label: 'Доставлять прозу как nit',
  checked: DEFAULTS.proseFallback,
  onChange: (checked) => {
    state.draft = { ...(state.draft ?? {}), proseFallback: checked }
    state.message = null
    renderSettingsNotice()
  },
})

mountButton(settingsActions, {
  label: 'Сохранить',
  variant: 'primary',
  onClick: () => {
    void saveSettings()
  },
})

// --- status ---------------------------------------------------------------

const statusPane = element('div', 'adv-pane')

// --- tabs -----------------------------------------------------------------

const tabs = mountTabs(tabsHost, {
  items: [
    { id: 'journal', label: 'Журнал' },
    { id: 'settings', label: 'Настройки' },
    { id: 'status', label: 'Статус' },
  ],
  activeId: 'journal',
  onChange: (id) => {
    state.tab = id
    render()
  },
})

// --- rendering ------------------------------------------------------------

function renderJournal() {
  const view = buildJournalView({
    records: state.records,
    sessionID: state.sessionID,
    allProjects: state.allProjects,
  })

  journalRows.replaceChildren()

  if (view.rows.length === 0 && connectionState(state.status, Date.now()) !== 'live') {
    mountEmpty(journalRows, {
      title: 'Плагин не запущен',
      body: 'Нет heartbeat. Проверьте, что OpenCode работает и расширение включено.',
    })
    return
  }

  if (view.empty) {
    mountEmpty(journalRows, { title: 'Советов пока нет', body: 'Ревьюер оставит запись после шага агента.' })
    return
  }

  for (const record of view.rows) {
    const row = element('div', 'adv-row')
    const rowHead = element('div', 'adv-row-head')
    const badgeHost = element('span')
    mountBadge(badgeHost, { label: record.severity ?? 'nit', tone: severityTone(record.severity) })
    rowHead.append(badgeHost, element('span', 'adv-time', formatTime(record.at)))
    row.append(rowHead, element('p', 'adv-note', record.note ?? ''))

    const actions = element('div', 'adv-actions')
    mountButton(actions, {
      label: 'в инпут',
      size: 'xs',
      variant: 'secondary',
      onClick: () => {
        void host.compose({ text: record.note ?? '' })
      },
    })
    mountButton(actions, {
      label: 'скопировать',
      size: 'xs',
      variant: 'ghost',
      onClick: () => {
        void host.writeClipboard(record.note ?? '')
      },
    })
    row.append(actions)
    journalRows.append(row)
  }
}

function formatTime(at) {
  if (typeof at !== 'number') return '—'
  return new Date(at).toLocaleTimeString()
}

function settingsEditing() {
  const active = document.activeElement
  if (!active || !settingsPane.contains(active)) return false
  return active.tagName === 'INPUT' || active.tagName === 'TEXTAREA'
}

function renderSettings() {
  if (settingsEditing()) {
    renderSettingsNotice()
    return
  }
  const effective = { ...state.config, ...(state.draft ?? {}) }
  enabledSwitch.update({ checked: Boolean(effective.enabled) })
  proseSwitch.update({ checked: Boolean(effective.proseFallback) })
  for (const key of ['provider', 'model', 'immuneTurns', 'maxDeltaMessages', 'noteMaxChars']) {
    fieldHandles[key].update({ value: String(effective[key] ?? '') })
  }
  renderSettingsNotice()
}

function renderSettingsNotice() {
  settingsNotice.replaceChildren()
  if (state.message) {
    mountBanner(settingsNotice, { tone: state.message.tone, title: state.message.text })
    return
  }
  if (state.draft !== null) {
    mountBanner(settingsNotice, { tone: 'info', title: 'Есть несохранённые изменения' })
  }
}

function renderStatus() {
  statusPane.replaceChildren()
  const status = state.status
  const connection = connectionState(status, Date.now())

  if (connection === 'missing') {
    mountBanner(statusPane, {
      tone: 'warning',
      title: 'Плагин не запущен',
      body: 'Нет heartbeat: OpenCode не работает или расширение выключено.',
    })
  } else if (connection === 'stale') {
    mountBanner(statusPane, {
      tone: 'warning',
      title: 'Heartbeat устарел',
      body: 'Последний сигнал плагина старше 30 секунд.',
    })
  }

  if (status?.reason === 'model-missing') {
    mountBanner(statusPane, {
      tone: 'info',
      title: 'disabled-with-reason: model-missing',
      body: 'Задайте provider и model на вкладке «Настройки» — до этого ревьюер молчит.',
    })
  }

  const latest = latestAdvice()
  const average = averageLatency()
  const rows = [
    ['Версия плагина', status?.pluginVersion ?? '—'],
    ['OpenCode', status?.appVersion ?? '—'],
    ['Модель', status?.model ?? 'нет (model-missing)'],
    ['Включён', status ? (status.enabled ? 'да' : 'нет') : '—'],
    ['Вызовов', status?.calls ?? 0],
    ['Дропов', status ? `${status.drops?.empty ?? 0} пусто · ${status.drops?.unparsed ?? 0} разбор · ${status.drops?.error ?? 0} ошибки` : '—'],
    ['Последний совет', latest ? formatTime(latest.at) : 'советов ещё не было'],
    ['Средняя задержка', average === null ? '—' : `${average} мс`],
  ]

  for (const [label, value] of rows) {
    const row = element('div', 'adv-status-row')
    row.append(element('span', 'adv-status-label', label), element('span', 'adv-status-value', String(value)))
    statusPane.append(row)
  }
}

function latestAdvice() {
  const advices = state.records.filter((record) => record.kind === 'advice')
  return advices.reduce((best, record) => (!best || (record.at ?? 0) > (best.at ?? 0) ? record : best), null)
}

function averageLatency() {
  const values = state.records.map((record) => record.ms).filter((ms) => typeof ms === 'number' && ms >= 0)
  if (values.length === 0) return null
  return Math.round(values.reduce((sum, ms) => sum + ms, 0) / values.length)
}

function renderHead() {
  headBadge.replaceChildren()
  const connection = connectionState(state.status, Date.now())
  mountBadge(headBadge, {
    label: connection === 'live' ? 'live' : connection === 'stale' ? 'stale' : 'не запущен',
    tone: connection === 'live' ? 'success' : 'warning',
  })
}

function render() {
  tabs.update({ activeId: state.tab })
  panes.replaceChildren(
    state.tab === 'journal' ? journalPane : state.tab === 'settings' ? settingsPane : statusPane,
  )
  renderHead()
  if (state.tab === 'journal') renderJournal()
  if (state.tab === 'settings') renderSettings()
  if (state.tab === 'status') renderStatus()
}

// --- data -----------------------------------------------------------------

async function updateState() {
  let entries = []
  try {
    entries = (await host.listDir(STATE_DIR)).entries
  } catch {
    // The plugin has not written anything yet.
    entries = []
  }

  const journals = []
  const statuses = []
  for (const entry of entries) {
    const path = `${STATE_DIR}/${entry.name}`
    try {
      if (entry.name.startsWith('journal-') && entry.name.endsWith('.jsonl')) {
        const { content } = await host.readFile(path)
        journals.push(parseJournal(content))
      } else if (entry.name.startsWith('status-') && entry.name.endsWith('.json')) {
        const { content } = await host.readFile(path)
        statuses.push(JSON.parse(content))
      }
    } catch {
      // One unreadable file must not hide the rest of the journal.
    }
  }

  state.records = mergeRecords(journals)
  state.status = statuses.reduce((best, item) => (!best || (item.at ?? 0) > (best.at ?? 0) ? item : best), null)
}

async function updateConfig() {
  try {
    const { content } = await host.readFile(CONFIG_PATH)
    state.config = normalizeConfig(JSON.parse(content)).config
  } catch {
    state.config = { ...DEFAULTS }
  }
}

async function refresh() {
  if (document.visibilityState !== 'visible') return
  await updateState()
  await updateConfig()
  render()
}

function settingsValues() {
  const merged = { ...state.config, ...(state.draft ?? {}) }
  for (const key of ['immuneTurns', 'maxDeltaMessages', 'noteMaxChars']) {
    merged[key] = Number.parseInt(String(merged[key]), 10)
  }
  return merged
}

async function saveSettings() {
  const { config, errors } = normalizeConfig(settingsValues())
  try {
    await host.writeFile(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n')
    state.config = config
    state.draft = null
    state.message = errors.length
      ? { tone: 'warning', text: `Сохранено, но модель не задана (${errors[0]}).` }
      : { tone: 'success', text: 'Настройки сохранены.' }
  } catch (error) {
    state.message = { tone: 'error', text: `Не сохранено: ${error?.message ?? error}` }
  }
  renderSettings()
}

host.onReady((ctx) => {
  applyHostReady(ctx, document.documentElement)
  state.sessionID = ctx.session?.id ?? null
  void refresh()
})

host.onSession((session) => {
  state.sessionID = session?.id ?? null
  renderJournal()
})

host.onDirectory(() => {
  void refresh()
})

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') void refresh()
})

setInterval(() => {
  void refresh()
}, POLL_MS)

render()
void refresh()
