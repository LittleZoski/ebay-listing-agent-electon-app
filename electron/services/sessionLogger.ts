import fs from 'fs'
import path from 'path'

export interface WatcherSession {
  id: string
  accountId: string
  accountName: string
  watchFolder: string
  startTime: string
  logs: string[]
}

let sessionFilePath: string | null = null
let currentWatcherSession: WatcherSession | null = null

export function initSessionLogger(appDataPath: string): void {
  sessionFilePath = path.join(appDataPath, 'session.md')
  // Create file with header if it doesn't exist
  if (!fs.existsSync(sessionFilePath)) {
    fs.writeFileSync(sessionFilePath, '# eBay Seller Activity Sessions\n\n', 'utf-8')
  }
}

function appendToFile(content: string): void {
  if (!sessionFilePath) return
  fs.appendFileSync(sessionFilePath, content, 'utf-8')
}

function formatDuration(startIso: string, endIso: string): string {
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime()
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const secs = seconds % 60
  if (minutes < 60) return `${minutes}m ${secs}s`
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  return `${hours}h ${mins}m`
}

// Log a re-authorization event
export function logReAuthorization(
  accountId: string,
  accountName: string,
  environment: string,
  success: boolean,
  errorMessage?: string
): void {
  const timestamp = new Date().toISOString()
  const status = success ? 'Success' : `Failed — ${errorMessage || 'Unknown error'}`

  const entry = [
    `---\n`,
    `## [Re-Authorization] ${timestamp}\n`,
    `**Account:** ${accountName} (\`${accountId}\`)\n`,
    `**Environment:** ${environment}\n`,
    `**Status:** ${status}\n`,
    `\n`,
  ].join('')

  appendToFile(entry)
}

// Start a new watcher session — returns session id
export function startWatcherSession(
  accountId: string,
  accountName: string,
  watchFolder: string
): string {
  const sessionId = `session_${Date.now()}`
  const startTime = new Date().toISOString()

  currentWatcherSession = { id: sessionId, accountId, accountName, watchFolder, startTime, logs: [] }

  // Write the session header immediately so it's visible even if app crashes
  const header = [
    `---\n`,
    `## [Watcher Session] ${startTime}\n`,
    `**Session ID:** \`${sessionId}\`\n`,
    `**Account:** ${accountName} (\`${accountId}\`)\n`,
    `**Watch Folder:** ${watchFolder}\n`,
    `**Status:** Running\n`,
    `\n`,
  ].join('')

  appendToFile(header)
  return sessionId
}

// Append a log line to the current watcher session (buffered in memory)
export function appendWatcherLog(message: string): void {
  if (!currentWatcherSession) return
  currentWatcherSession.logs.push(`${new Date().toISOString()} ${message}`)
}

// Close the current watcher session and write the full log block
export function endWatcherSession(): void {
  if (!currentWatcherSession || !sessionFilePath) return

  const endTime = new Date().toISOString()
  const { startTime, logs } = currentWatcherSession
  const duration = formatDuration(startTime, endTime)

  const logBlock =
    logs.length > 0
      ? `\`\`\`\n${logs.join('\n')}\n\`\`\`\n`
      : `_No activity logged during this session._\n`

  const footer = [
    `**End Time:** ${endTime}\n`,
    `**Duration:** ${duration}\n`,
    `\n`,
    `### Activity Log\n`,
    logBlock,
    `\n`,
  ].join('')

  // Read the file and patch the "Status: Running" line for this session to "Completed"
  try {
    let content = fs.readFileSync(sessionFilePath, 'utf-8')
    const sessionId = currentWatcherSession.id
    content = content.replace(
      new RegExp(`(\\*\\*Session ID:\\*\\* \`${sessionId}\`[\\s\\S]*?\\*\\*Status:\\*\\*) Running`),
      `$1 Completed`
    )
    fs.writeFileSync(sessionFilePath, content, 'utf-8')
  } catch {
    // Non-fatal: just append footer without patching status
  }

  appendToFile(footer)
  currentWatcherSession = null
}

export function getCurrentWatcherSession(): WatcherSession | null {
  return currentWatcherSession
}
