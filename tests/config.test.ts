import { describe, expect, it } from 'vitest'
import { readConfig } from '../src/config.js'
import { allTools } from '../src/tools/index.js'

/**
 * The checks that catch the two mistakes somebody actually makes: pasting the
 * wrong credential, and a tool whose schema no longer matches its handler.
 */
describe('config', () => {
  const token = `cka_live_${'A'.repeat(12)}_${'a'.repeat(43)}`

  it('refuses a project API key, which is read-only', () => {
    const projectKey = token.replace(/^cka_/, 'csk_')
    expect(() => readConfig({ CMSKITE_AGENT_TOKEN: projectKey } as NodeJS.ProcessEnv)).toThrow(
      /project API key/,
    )
  })

  it('refuses to start with no token at all', () => {
    expect(() => readConfig({} as NodeJS.ProcessEnv)).toThrow(/CMSKITE_AGENT_TOKEN/)
  })

  it('trims a trailing slash off the API url so paths do not double up', () => {
    const config = readConfig({
      CMSKITE_AGENT_TOKEN: token,
      CMSKITE_API_URL: 'https://api.example.com/',
    } as NodeJS.ProcessEnv)
    expect(config.apiUrl).toBe('https://api.example.com')
  })
})

describe('tools', () => {
  it('every tool has a unique name and a description worth reading', () => {
    const names = allTools.map((t) => t.name)
    expect(new Set(names).size).toBe(names.length)
    for (const tool of allTools) {
      expect(tool.description.length).toBeGreaterThan(40)
      expect(tool.title).toBeTruthy()
    }
  })

  it('marks the tools that delete as destructive', () => {
    for (const tool of allTools) {
      if (tool.name.startsWith('delete_')) expect(tool.destructive).toBe(true)
      if (tool.name.startsWith('list_') || tool.name.startsWith('get_')) {
        expect(tool.readOnly).toBe(true)
      }
    }
  })
})
