import { describe, expect, it } from 'vitest'
import { allTools } from '../src/tools/index.js'

/**
 * What the guide actually hands somebody.
 *
 * The failure this tool exists to prevent is not an error -- it is a site that
 * works and counts nobody. Every assertion here is about a property whose
 * absence is invisible until a customer asks why their views are zero, so each
 * one is worth a test even though none of them can throw.
 */
const guide = allTools.find((t) => t.name === 'get_integration_guide')!
const client = null as never

type Guide = {
  install: string
  keys: { name: string; where: string }[]
  files: { path: string; contents: string }[]
  notes: string[]
  verify: string
}

const FRAMEWORKS = [
  'nextjs-app',
  'nextjs-pages',
  'react',
  'node',
  'html',
  'php',
  'wordpress',
  'laravel',
  'python',
  'other',
] as const

const ask = (framework: string, extra: Record<string, unknown> = {}) =>
  guide.run(client, { framework, ...extra }) as Promise<Guide>

describe('the integration guide', () => {
  it('answers for every project shape, not just the JavaScript ones', async () => {
    for (const framework of FRAMEWORKS) {
      const answer = await ask(framework)
      expect(answer.files.length, framework).toBeGreaterThan(0)
      expect(answer.keys.length, framework).toBeGreaterThan(0)
      expect(answer.notes.length, framework).toBeGreaterThan(0)
    }
  })

  it('tells a non-JavaScript project there is nothing to install', async () => {
    for (const framework of ['html', 'php', 'wordpress', 'laravel', 'python', 'other'] as const) {
      const answer = await ask(framework)
      expect(answer.install, framework).toMatch(/nothing to install/i)
      // A PHP site cannot npm install, and being told to is how a five-minute
      // job becomes a project.
      expect(JSON.stringify(answer.files), framework).not.toMatch(/npm install cmskite/)
    }
  })

  it('ships view tracking with every framework, because nothing else will', async () => {
    for (const framework of FRAMEWORKS) {
      const files = JSON.stringify(await ask(framework))
      expect(files, framework).toMatch(/trackView|track_view|blog\/events|TrackView|useTrackView/)
    }
  })

  /**
   * The three properties a hand-written tracker gets wrong. Each one fails
   * silently: the page renders, the content is right, and no view is ever
   * recorded.
   */
  describe('the raw tracking snippet', () => {
    const RAW = ['html', 'php', 'wordpress', 'laravel', 'python', 'other'] as const

    it('uses a CORS-safelisted content type, so the browser does not preflight it', async () => {
      for (const framework of RAW) {
        const files = JSON.stringify(await ask(framework))
        expect(files, framework).toMatch(/text\/plain;charset=UTF-8/)
        // application/json on the events call is preflighted, and the
        // preflight carries no key, so it is refused and the view is dropped.
        expect(files, framework).not.toMatch(/events[^]{0,400}'content-type': 'application\/json'/)
      }
    })

    it('carries the key in the query string, where a beacon can put it', async () => {
      for (const framework of RAW) {
        const files = JSON.stringify(await ask(framework))
        expect(files, framework).toMatch(/blog\/events\?key=/)
      }
    })

    it('says in the code that it needs the post id and not the slug', async () => {
      for (const framework of RAW) {
        const files = JSON.stringify(await ask(framework))
        expect(files, framework).toMatch(/postId/)
      }
    })
  })

  it('warns a browser-fetched site that allowed origins are not optional', async () => {
    // Without them the browser refuses the response and the page renders
    // empty -- which reads as "the API is broken", and is not.
    const answer = await ask('html')
    expect(answer.notes.join(' ')).toMatch(/NOT optional/)
  })

  it('does not ask a plain HTML site to hide a key it cannot hide', async () => {
    const answer = await ask('html')
    expect(answer.keys).toHaveLength(1)
    expect(answer.keys[0]!.where).toMatch(/in the html/i)
  })

  it('names the environment each server key actually belongs in', async () => {
    expect((await ask('wordpress')).keys[0]!.where).toMatch(/wp-config/i)
    expect((await ask('laravel')).keys[0]!.where).toMatch(/\.env/)
    expect((await ask('nextjs-app')).keys[0]!.where).toMatch(/never prefixed/i)
  })

  it('ends by telling the caller to verify rather than to declare victory', async () => {
    for (const framework of FRAMEWORKS) {
      expect((await ask(framework)).verify, framework).toMatch(/check_integration/)
    }
  })

  it('leaves tracking out when asked, and says what that costs', async () => {
    const answer = await ask('php', { includeAnalytics: false })
    expect(JSON.stringify(answer.files)).toMatch(/zero views/)
  })
})

describe('the diagnostic tools', () => {
  it('registers check_integration, which is what answers "why are my views zero"', () => {
    const check = allTools.find((t) => t.name === 'check_integration')
    expect(check).toBeDefined()
    expect(check!.readOnly).toBe(true)
  })

  it('registers analytics reading, which nothing could do before', () => {
    expect(allTools.find((t) => t.name === 'get_content_analytics')).toBeDefined()
  })

  it('points a stuck assistant from the analytics tool at the diagnostic one', () => {
    const analytics = allTools.find((t) => t.name === 'get_content_analytics')!
    expect(analytics.description).toMatch(/check_integration/)
  })
})
