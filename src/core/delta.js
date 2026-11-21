function isOwnRecord(message) {
  const description = typeof message?.description === 'string' ? message.description : ''
  return description.startsWith('advisor:')
}

function isCompaction(message) {
  if (message?.role === 'compaction' || message?.type === 'compaction') return true
  const description = typeof message?.description === 'string' ? message.description : ''
  return description === 'compaction' || description.startsWith('compaction:')
}

/**
 * Messages after `lastSeenID`, without the advisor's own inserts and compaction
 * placeholders. The model sees the last `maxMessages` (0 = all), while
 * `lastSeenID` follows the whole filtered tail so a window never re-reviews.
 */
export function collectDelta(messages, lastSeenID, maxMessages) {
  const list = Array.isArray(messages) ? messages : []

  let start = 0
  if (lastSeenID != null) {
    const index = list.findIndex((message) => message?.id === lastSeenID)
    start = index === -1 ? 0 : index + 1
  }

  const fresh = list.slice(start).filter((message) => !isOwnRecord(message) && !isCompaction(message))
  const lastID = fresh.length > 0 ? fresh[fresh.length - 1].id : lastSeenID ?? null

  const window = typeof maxMessages === 'number' && maxMessages > 0 ? fresh.slice(-maxMessages) : fresh
  return { messages: window, lastSeenID: lastID }
}
