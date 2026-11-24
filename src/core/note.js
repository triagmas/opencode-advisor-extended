/**
 * The note the agent sees. One shape for every client: a reviewer note is a
 * line in the transcript, so it reads the same in the TUI, the desktop app and
 * any client that shows a synthetic message.
 */
export function formatNote(severity, note) {
  return `Advisor · ${severity}: ${note}`
}
