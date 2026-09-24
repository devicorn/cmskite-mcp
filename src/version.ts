import { createRequire } from 'node:module'

/** From package.json, so the handshake reports the version that is actually running. */
export const VERSION = (createRequire(import.meta.url)('../package.json') as { version: string }).version

/** a > b for plain x.y.z versions. */
export function isNewer(a: string, b: string): boolean {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0)
  return false
}

let latest: Promise<string | null> | null = null

/**
 * The newest version on npm, asked once per process.
 *
 * A stale npx cache pinned a customer two releases back while they reported
 * bugs that were already fixed. Nothing told them. Never throws and never
 * waits more than two seconds: an offline machine gets null, not an error.
 */
export function latestVersion(): Promise<string | null> {
  latest ??= fetch('https://registry.npmjs.org/cmskite-mcp/latest', { signal: AbortSignal.timeout(4000) })
    .then(async (r) => (r.ok ? ((await r.json()) as { version?: string }).version ?? null : null))
    .catch(() => null)
  return latest
}

/** What whoami reports about this server. */
export async function versionReport() {
  const newest = await latestVersion()
  const outdated = newest !== null && isNewer(newest, VERSION)
  return {
    version: VERSION,
    latest: newest,
    outdated,
    ...(outdated && {
      fix: `This is cmskite-mcp ${VERSION}; ${newest} is out. Tell the person: use "npx -y cmskite-mcp@latest" in the MCP config, and if it still starts ${VERSION}, run "npx clear-npx-cache" and restart the client.`,
    }),
  }
}
