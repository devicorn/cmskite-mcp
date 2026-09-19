/**
 * Everything this server needs, read once at start-up.
 *
 * It refuses to start rather than starting and failing on the first tool call.
 * An MCP server that dies during a conversation surfaces to the person as the
 * assistant being confused, not as a missing environment variable, so the
 * failure is worth having up front and in plain words.
 */
export interface Config {
  apiUrl: string
  token: string
  /** The project every content tool defaults to, when only one is in play. */
  defaultProjectId: string | null
}

const TOKEN_PREFIX = 'cka_'

export function readConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const token = env.CMSKITE_AGENT_TOKEN?.trim()
  if (!token) {
    throw new Error(
      'CMSKITE_AGENT_TOKEN is required. Create one in the dashboard under Settings → Agent tokens.',
    )
  }
  // A project API key starts `csk_` and is read-only, so it fails later with a
  // 404 on the first write and a confusing "no such endpoint". Saying so here
  // costs one comparison and saves the person half an hour.
  if (!token.startsWith(TOKEN_PREFIX)) {
    throw new Error(
      `CMSKITE_AGENT_TOKEN should start with "${TOKEN_PREFIX}". A "csk_" value is a project API key: ` +
        'it is read-only and scoped to one project, and cannot be used here.',
    )
  }

  const apiUrl = (env.CMSKITE_API_URL?.trim() || 'https://api.cmskite.com').replace(/\/+$/, '')

  return {
    apiUrl,
    token,
    defaultProjectId: env.CMSKITE_PROJECT_ID?.trim() || null,
  }
}
