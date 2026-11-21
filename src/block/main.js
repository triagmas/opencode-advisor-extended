import { connectHost } from '@openchamber/sdk'
import { applyHostReady, mountButton } from '@openchamber/sdk/ui'

const STATE_DIR = '~/.local/state/openchamber-advisor'
const POLL_MS = 4_000
const DISMISS_PREFIX = 'next-block-dismissed'

// The check and close paths are the ones the app itself draws.
const ICON_PATH = {
  check: 'M10 15.172l9.192-9.193 1.415 1.414L10 18l-6.364-6.364 1.414-1.414z',
  close:
    'M12 10.586l4.95-4.95 1.414 1.414-4.95 4.95 4.95 4.95-1.414 1.414-4.95-4.95-4.95 4.95-1.414-1.414 4.95-4.95-4.95-4.95L7.05 5.636z',
}

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

  // The frame has an opaque origin, so window.localStorage is denied. The
  // host's storage outlives the frame, and the key is per session: hiding in
  // one conversation never hides another's card.
  const dismissKey = (sessionID) => `${DISMISS_PREFIX}:${sessionID ?? 'none'}`

  const readDismissed = async (sessionID) => {
    try {
      return Number(await host.storage.get(dismissKey(sessionID))) || 0
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

  const iconButton = (parent, name, label, onClick) => {
    const holder = element('span', 'next-icon')
    parent.append(holder)
    mountButton(holder, { label: '', size: 'xs', variant: 'ghost', onClick })
    const node = holder.querySelector('button')
    if (!node) return
    node.classList.add('next-icon-btn')
    node.setAttribute('aria-label', label)
    node.title = label
    node.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="${ICON_PATH[name]}"/></svg>`
  }

  function render() {
    root.replaceChildren()
    if (!state.suggestion) {
      root.style.display = 'none'
      resize()
      return
    }
    root.style.display = 'block'

    const row = element('div', 'next-row')
    const text = element('p', 'next-text', state.suggestion.text)
    text.title = state.suggestion.text
    const actions = element('div', 'next-actions')
    iconButton(actions, 'check', 'Вставить в поле ввода', () => {
      void host.compose({ text: state.suggestion?.text ?? '' }).catch(() => {})
    })
    iconButton(actions, 'close', 'Скрыть подсказку', () => {
      state.dismissedAt = state.suggestion?.at ?? Date.now()
      state.suggestion = null
      void host.storage
        .set(dismissKey(state.sessionID), state.dismissedAt)
        .catch(() => {})
      render()
    })
    row.append(text, actions)
    root.append(row)
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

  async function applySession(sessionID) {
    state.sessionID = sessionID
    state.suggestion = null
    state.dismissedAt = await readDismissed(sessionID)
    render()
    await refresh()
  }

  host.onReady((ctx) => {
    applyHostReady(ctx, document.documentElement)
    void applySession(ctx.session?.id ?? null)
  })

  host.onSession((session) => {
    void applySession(session?.id ?? null)
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
