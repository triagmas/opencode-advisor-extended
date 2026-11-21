import { connectHost } from '@openchamber/sdk'
import { applyHostReady, mountButton } from '@openchamber/sdk/ui'

const STATE_DIR = '~/.local/state/openchamber-advisor'
const POLL_MS = 4_000
const DISMISS_KEY = 'advisor:next-block-dismissed'

/** Newest suggestion of this session that the person has not dismissed. */
export function pickBlockSuggestion(suggestions, sessionID, dismissedAt = 0) {
  if (!sessionID) return null
  let latest = null
  for (const item of Array.isArray(suggestions) ? suggestions : []) {
    if (!item || typeof item.text !== 'string' || item.text.trim() === '')
      continue
    if (item.sessionID !== sessionID) continue
    if ((item.at ?? 0) <= dismissedAt) continue
    if (latest === null || (item.at ?? 0) > (latest.at ?? 0)) latest = item
  }
  return latest
}

function boot() {
  const host = connectHost()
  const root = document.getElementById('root')

  const state = {
    sessionID: null,
    suggestion: null,
    dismissedAt: 0,
  }

  // The frame has an opaque origin, so window.localStorage is denied; the
  // host's own storage outlives the frame and the page.
  const readDismissed = async () => {
    try {
      return Number(await host.storage.get(DISMISS_KEY)) || 0
    } catch {
      return 0
    }
  }

  const element = (tag, className, text) => {
    const node = document.createElement(tag)
    if (className) node.className = className
    if (text !== undefined) node.textContent = text
    return node
  }

  const resize = () => {
    const height = Math.ceil(root.getBoundingClientRect().height)
    void host.setHeight(Math.max(0, height)).catch(() => {})
  }

  function render() {
    root.replaceChildren()
    if (!state.suggestion) {
      root.style.display = 'none'
      resize()
      return
    }
    root.style.display = 'block'

    const box = element('div', 'next-card')
    const head = element('div', 'next-head')
    head.append(element('span', 'next-label', 'Дальше'))
    const actions = element('div', 'next-actions')
    mountButton(actions, {
      label: 'В инпут',
      size: 'xs',
      variant: 'default',
      onClick: () => {
        void host
          .compose({ text: state.suggestion?.text ?? '' })
          .catch(() => {})
      },
    })
    mountButton(actions, {
      label: 'Скрыть',
      size: 'xs',
      variant: 'ghost',
      onClick: () => {
        state.dismissedAt = state.suggestion?.at ?? Date.now()
        state.suggestion = null
        void host.storage.set(DISMISS_KEY, state.dismissedAt).catch(() => {})
        render()
      },
    })
    head.append(actions)
    box.append(head, element('p', 'next-text', state.suggestion.text))
    root.append(box)
    resize()
  }

  async function refresh() {
    if (document.visibilityState !== 'visible' || !state.sessionID) return
    let entries = []
    try {
      entries = (await host.listDir(STATE_DIR)).entries
    } catch {
      return
    }
    const suggestions = []
    for (const entry of entries) {
      if (entry.kind !== 'file') continue
      if (
        !entry.name.startsWith('suggestion-') ||
        !entry.name.endsWith('.json')
      )
        continue
      try {
        suggestions.push(
          JSON.parse(
            (await host.readFile(`${STATE_DIR}/${entry.name}`)).content,
          ),
        )
      } catch {
        // One unreadable file must not hide the rest.
      }
    }
    const next = pickBlockSuggestion(
      suggestions,
      state.sessionID,
      state.dismissedAt,
    )
    const changed = (next?.at ?? 0) !== (state.suggestion?.at ?? 0)
    state.suggestion = next
    if (changed) render()
  }

  host.onReady((ctx) => {
    applyHostReady(ctx, document.documentElement)
    state.sessionID = ctx.session?.id ?? null
    void readDismissed().then((at) => {
      state.dismissedAt = Math.max(state.dismissedAt, at)
      void refresh()
    })
  })

  host.onSession((session) => {
    state.sessionID = session?.id ?? null
    void refresh()
  })

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void refresh()
  })

  if (typeof ResizeObserver === 'function') {
    const observer = new ResizeObserver(() => resize())
    observer.observe(root)
  }

  setInterval(() => {
    void refresh()
  }, POLL_MS)

  root.style.display = 'none'
  render()
}

// The module is imported by node tests as well: no DOM there, no page to boot.
if (typeof document !== 'undefined') boot()
