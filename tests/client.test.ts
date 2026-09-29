import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, CmsKiteClient } from '../src/client.js'

// Audit F17: a tool call is bounded in time, and a write carries an identity the API can deduplicate.
const client = new CmsKiteClient({ apiUrl: 'https://api.example.test', token: 'cka_live_x', defaultProjectId: 'prj_1' })
const ok = () => new Response(JSON.stringify({ success: true, data: {} }), { status: 200 })

afterEach(() => vi.unstubAllGlobals())

describe('CmsKiteClient', () => {
  it('sends a fresh idempotency key on each write, and none on reads', async () => {
    const fetch = vi.fn(async () => ok())
    vi.stubGlobal('fetch', fetch)
    await client.request('/v1/blog/posts', { method: 'POST', body: { title: 'a' } })
    await client.request('/v1/blog/posts', { method: 'POST', body: { title: 'a' } })
    await client.request('/v1/blog/posts')
    const keys = fetch.mock.calls.map(([, init]) => (init as RequestInit & { headers: Record<string, string> }).headers['idempotency-key'])
    expect(keys[0]).toMatch(/[0-9a-f-]{36}/)
    expect(keys[1]).not.toBe(keys[0])
    expect(keys[2]).toBeUndefined()
  })

  it('gives up on a call that does not answer, and says a write may have happened', async () => {
    vi.stubGlobal('fetch', vi.fn((_url: URL, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal!.addEventListener('abort', () => reject(init.signal!.reason))
    })))
    const err = (await client.request('/v1/blog/posts', { method: 'POST', body: {}, timeoutMs: 50 }).catch((e: unknown) => e)) as ApiError
    expect(err).toBeInstanceOf(ApiError)
    expect(err.code).toBe('TIMEOUT')
    expect(err.message).toMatch(/may or may not have taken effect/)
  })
})
