import { connectHost } from '@openchamber/sdk'
import { applyHostReady, mountBadge, mountBanner, mountButton } from '@openchamber/sdk/ui'

import { parseJournal } from '../core/journal-parse.js'
import { connectionState, mergeRecords, severityTone } from './view.js'

const STATE_DIR = '~/.local/state/openchamber-advisor'
const POLL_MS = 3_000

/** Newest advice of one session, or null when it has none. */
export function latestForSession(records, sessionID) {
  if (!sessionID) return null
  let latest = null
  for (const record of Array.isArray(records) ? records : []) {
    if (!record || record.kind !== 'advice' || record.sessionID !== sessionID) continue
    if (latest === null || (record.at ?? 0) > (latest.at ?? 0)) latest = record
  }
  return latest
}

/** Newest suggestion the person has not dismissed yet. */
export function pickSuggestion(suggestions, dismissedAt = 0) {
  let latest = null
  for (const item of Array.isArray(suggestions) ? suggestions : []) {
    if (!item || typeof item.text !== 'string' || item.text.trim() === '') continue
    if ((item.at ?? 0) <= dismissedAt) continue
    if (latest === null || (item.at ?? 0) > (latest.at ?? 0)) latest = item
  }
  return latest
}

export function countForSession(records, sessionID) {
  if (!sessionID) return 0
  return (Array.isArray(records) ? records : []).filter(
    (record) => record && record.kind === 'advice' && record.sessionID === sessionID,
  ).length
}

function boot() {
  const host = connectHost()
  const root = document.getElementById('root')

  const DISMISS_KEY = 'advisor:suggestion-dismissed'
  const dismissedAt = () => {
    try {
      return Number(window.localStorage.getItem(DISMISS_KEY)) || 0
    } catch {
      return 0
    }
  }

  const state = {
    sessionID: null,
    records: [],
    status: null,
    suggestion: null,
    suggestionDismissedAt: dismissedAt(),
  }

  const element = (tag, className, text) => {
    const node = document.createElement(tag)
    if (className) node.className = className
    if (text !== undefined) node.textContent = text
    return node
  }

  const timeLabel = (at) => (typeof at === 'number' ? new Date(at).toLocaleTimeString() : '—')

  function banner(title, body, tone = 'warning') {
    const holder = element('div')
    mountBanner(holder, { tone, title, body })
    root.append(holder)
  }

  function render() {
    root.replaceChildren()
    const connection = connectionState(state.status, Date.now())

    if (connection === 'missing') {
      banner('Ревьюер не запущен', 'Нет heartbeat: плагин не загружен в OpenCode.')
    } else if (connection === 'stale') {
      banner('Плагин не отвечает', 'Последний сигнал старше 30 секунд: OpenCode недоступен или плагин выключен.')
    }

    if (state.status?.enabled === false) {
      banner('Ревьюер выключен', 'Включите его на вкладке «Настройки» в панели Advisor.', 'info')
    }

    if (state.status?.reason === 'model-missing') {
      banner('Модель не задана', 'Задайте provider и model в панели Advisor.', 'info')
    }

    if (state.suggestion) {
      const box = element('div', 'status-suggestion')
      box.append(element('p', 'status-note', state.suggestion.text))
      const actions = element('div', 'status-actions')
      mountButton(actions, {
        label: 'В инпут',
        size: 'xs',
        variant: 'default',
        onClick: () => {
          void host.compose({ text: state.suggestion?.text ?? '' }).catch(() => {})
        },
      })
      mountButton(actions, {
        label: 'Скрыть',
        size: 'xs',
        variant: 'ghost',
        onClick: () => {
          state.suggestionDismissedAt = state.suggestion?.at ?? Date.now()
          state.suggestion = null
          try {
            window.localStorage.setItem(DISMISS_KEY, String(state.suggestionDismissedAt))
          } catch {
            // Storage may be denied in the frame: the dismissal still holds for this view.
          }
          render()
        },
      })
      box.append(actions)
      root.append(box)
    }

    const count = countForSession(state.records, state.sessionID)
    root.append(element('div', 'status-count', `Советов за сессию: ${count}`))

    const latest = latestForSession(state.records, state.sessionID)
    if (!latest) {
      root.append(element('p', 'status-empty', 'В этой сессии ревьюер ещё ничего не советовал.'))
      return
    }

    const advice = element('div', 'status-advice')
    const meta = element('div', 'status-meta')
    const badgeHost = element('span')
    mountBadge(badgeHost, { label: latest.severity ?? 'nit', tone: severityTone(latest.severity) })
    meta.append(badgeHost, element('span', 'status-time', timeLabel(latest.at)))
    advice.append(meta, element('p', 'status-note', latest.note ?? ''))

    const actions = element('div', 'status-actions')
    mountButton(actions, {
      label: 'В инпут',
      size: 'xs',
      variant: 'secondary',
      onClick: () => {
        void host.compose({ text: latest.note ?? '' }).catch(() => {})
      },
    })
    advice.append(actions)
    root.append(advice)
  }

  async function readAll() {
    let entries = []
    try {
      entries = (await host.listDir(STATE_DIR)).entries
    } catch {
      return { records: [], status: null }
    }

    const journals = []
    const statuses = []
    const suggestions = []
    for (const entry of entries) {
      if (entry.kind !== 'file') continue
      const path = `${STATE_DIR}/${entry.name}`
      try {
        if (entry.name.startsWith('journal-') && entry.name.endsWith('.jsonl')) {
          journals.push(parseJournal((await host.readFile(path)).content))
        } else if (entry.name.startsWith('status-') && entry.name.endsWith('.json')) {
          statuses.push(JSON.parse((await host.readFile(path)).content))
        } else if (entry.name.startsWith('suggestion-') && entry.name.endsWith('.json')) {
          suggestions.push(JSON.parse((await host.readFile(path)).content))
        }
      } catch {
        // One unreadable file must not hide the rest.
      }
    }

    const status = statuses.reduce((best, item) => (!best || (item.at ?? 0) > (best.at ?? 0) ? item : best), null)
    return {
      records: mergeRecords(journals),
      status,
      suggestion: pickSuggestion(suggestions, state.suggestionDismissedAt),
    }
  }

  async function refresh() {
    if (document.visibilityState !== 'visible') return
    try {
      const { records, status, suggestion } = await readAll()
      state.records = records
      state.status = status
      state.suggestion = suggestion
    } catch {
      // Keep the last picture and retry on the next tick.
    }
    render()
  }

  host.onReady((ctx) => {
    applyHostReady(ctx, document.documentElement)
    state.sessionID = ctx.session?.id ?? null
    void refresh()
  })

  host.onSession((session) => {
    state.sessionID = session?.id ?? null
    render()
  })

  host.onDirectory(() => {
    void refresh()
  })

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void refresh()
  })

  if (typeof ResizeObserver === 'function') {
    const observer = new ResizeObserver(() => {
      const height = Math.ceil(root.getBoundingClientRect().height)
      // The section is declared as 200 px: stay there until the content needs more.
      void host.setHeight(Math.min(480, Math.max(200, height))).catch(() => {})
    })
    observer.observe(root)
  }

  setInterval(() => {
    void refresh()
  }, POLL_MS)

  render()
  void refresh()
}

// The module is imported by node tests as well: no DOM there, no page to boot.
if (typeof document !== 'undefined') boot()
