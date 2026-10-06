import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { CmsKiteClient } from '../src/client.js'
import { allTools } from '../src/tools/index.js'

describe('post tools', () => {
  it.each(['update_post', 'create_post'])('%s takes a focus keyword', (name) => {
    const tool = allTools.find((t) => t.name === name)!
    const input = { id: 'pst_1', title: 't', seo: { focusKeyword: 'running shoes' } }
    expect(z.object(tool.input).parse(input).seo).toEqual({ focusKeyword: 'running shoes' })
    expect(() =>
      z.object(tool.input).parse({ ...input, seo: { focusKeyword: 'x'.repeat(101) } }),
    ).toThrow()
  })
})

describe('post tools and locale', () => {
  const client = new CmsKiteClient({ apiUrl: 'https://api.example.test', token: 'cka_live_x', defaultProjectId: 'prj_1' })
  const tool = (name: string) => allTools.find((t) => t.name === name)!
  const call = (name: string, args: Record<string, unknown>) => tool(name).run(client, args)
  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(status < 400 ? { success: true, data } : { error: { code: 'NOT_FOUND', message: 'no' } }), { status })
  // routes: "METHOD /path" -> response data (or a status for errors)
  const fake = (routes: Record<string, unknown>) => {
    const fetch = vi.fn(async (url: URL, init: RequestInit) => {
      const key = `${init.method} ${url.pathname}`
      if (!(key in routes)) throw new Error(`unexpected ${key}`)
      return routes[key] === 404 ? json(null, 404) : json(routes[key])
    })
    vi.stubGlobal('fetch', fetch)
    return fetch
  }
  const sent = (fetch: ReturnType<typeof fake>, i: number) => {
    const [url, init] = fetch.mock.calls[i] as unknown as [URL, RequestInit]
    return { method: init.method, path: url.pathname, query: url.search, body: init.body ? JSON.parse(init.body as string) : undefined }
  }
  afterEach(() => vi.unstubAllGlobals())

  it('get_post, list_posts and search_posts pass ?locale', async () => {
    const fetch = fake({ 'GET /v1/blog/posts/pst_1': {}, 'GET /v1/blog/posts': {}, 'GET /v1/blog/search': {} })
    await call('get_post', { id: 'pst_1', locale: 'hi' })
    await call('list_posts', { locale: 'hi' })
    await call('search_posts', { q: 'x', locale: 'hi' })
    for (let i = 0; i < 3; i++) expect(sent(fetch, i).query).toContain('locale=hi')
  })

  it('create_post sends locale in the body', async () => {
    const fetch = fake({ 'POST /v1/blog/posts': {} })
    await call('create_post', { title: 't', locale: 'hi' })
    expect(sent(fetch, 0).body.locale).toBe('hi')
  })

  it('update_post without locale, or in the original locale, still PATCHes', async () => {
    const fetch = fake({ 'GET /v1/blog/posts/pst_1': { locale: 'en', versions: [{ locale: 'en', original: true }, { locale: 'hi' }] }, 'PATCH /v1/blog/posts/pst_1': {} })
    await call('update_post', { id: 'pst_1', title: 'a' })
    await call('update_post', { id: 'pst_1', title: 'a', locale: 'en', categoryId: 'c' })
    expect(fetch).toHaveBeenCalledTimes(3)
    expect(sent(fetch, 0).method).toBe('PATCH')
    expect(sent(fetch, 2)).toMatchObject({ method: 'PATCH', body: { title: 'a', categoryId: 'c' } })
    expect(sent(fetch, 2).body.locale).toBeUndefined()
  })

  it('update_post in another locale PUTs the translation, filling title/body from it', async () => {
    const fetch = fake({
      'GET /v1/blog/posts/pst_1': { locale: 'en', versions: [{ locale: 'en', original: true }, { locale: 'hi' }] },
      'GET /v1/blog/posts/pst_1/translations/hi': { title: 'T', body: 'B' },
      'PUT /v1/blog/posts/pst_1/translations/hi': {},
    })
    await call('update_post', { id: 'pst_1', locale: 'hi', excerpt: 'e', expectedRevision: 3 })
    const put = sent(fetch, 2)
    expect(put).toMatchObject({ method: 'PUT', body: { title: 'T', body: 'B', excerpt: 'e', expectedRevision: 3 } })
    expect(put.body.locale).toBeUndefined()
  })

  it('update_post merges the whole stored translation under the caller fields', async () => {
    const fetch = fake({
      'GET /v1/blog/posts/pst_1': { locale: 'hi', versions: [{ locale: 'en', original: true }, { locale: 'hi' }] },
      'GET /v1/blog/posts/pst_1/translations/hi': {
        title: 'T', body: 'B', excerpt: 'E', seo: { title: 's' }, bodyFormat: 'html', slug: 'sl', status: 'draft', revision: 7, publishedAt: 'x',
      },
      'PUT /v1/blog/posts/pst_1/translations/hi': {},
    })
    await call('update_post', { id: 'pst_1', locale: 'hi', title: 'x' })
    expect(sent(fetch, 2).body).toEqual({
      title: 'x', body: 'B', excerpt: 'E', seo: { title: 's' }, bodyFormat: 'html', slug: 'sl', status: 'draft', expectedRevision: 7,
    })
  })

  it('update_post uses versions, not the served locale, to find the original', async () => {
    const fetch = fake({
      'GET /v1/blog/posts/pst_1': { locale: 'hi', versions: [{ locale: 'en', original: true }, { locale: 'hi' }] },
      'GET /v1/blog/posts/pst_1/translations/hi': { title: 'T', body: 'B' },
      'PUT /v1/blog/posts/pst_1/translations/hi': {},
      'PATCH /v1/blog/posts/pst_1': {},
    })
    await call('update_post', { id: 'pst_1', locale: 'hi', title: 'x' })
    expect(sent(fetch, 2).method).toBe('PUT')
    await call('update_post', { id: 'pst_1', locale: 'en', title: 'x' })
    expect(sent(fetch, 4).method).toBe('PATCH')
  })

  it('update_post refuses to guess when versions is missing', async () => {
    const fetch = fake({ 'GET /v1/blog/posts/pst_1': { locale: 'hi' } })
    await expect(call('update_post', { id: 'pst_1', locale: 'hi', title: 'x' })).rejects.toThrow(/original language/)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('update_post for a new translation needs title and body', async () => {
    fake({ 'GET /v1/blog/posts/pst_1': { locale: 'en', versions: [{ locale: 'en', original: true }, { locale: 'hi' }] }, 'GET /v1/blog/posts/pst_1/translations/hi': 404 })
    await expect(call('update_post', { id: 'pst_1', locale: 'hi', title: 'T' })).rejects.toThrow(/title and body/)
  })

  it('update_post refuses shared fields on a translation', async () => {
    const fetch = fake({ 'GET /v1/blog/posts/pst_1': { locale: 'en', versions: [{ locale: 'en', original: true }, { locale: 'hi' }] } })
    await expect(call('update_post', { id: 'pst_1', locale: 'hi', title: 'T', tags: ['a'] })).rejects.toThrow(/without `locale`/)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('delete_post_translation DELETEs the translation', async () => {
    const fetch = fake({ 'DELETE /v1/blog/posts/pst_1/translations/pt-BR': {} })
    await call('delete_post_translation', { postId: 'pst_1', locale: 'pt-BR' })
    expect(sent(fetch, 0)).toMatchObject({ method: 'DELETE', path: '/v1/blog/posts/pst_1/translations/pt-BR' })
    expect(tool('delete_post_translation').destructive).toBe(true)
  })
})
