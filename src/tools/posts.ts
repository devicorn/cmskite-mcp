import { z } from 'zod'
import { ApiError, segment } from '../client.js'
import { defineTool, projectArg } from './register.js'

const STATUS = z.enum(['draft', 'scheduled', 'published', 'archived'])

const locale = z
  .string()
  .max(10)
  .optional()
  .describe("locale: a language the project has turned on, e.g. `hi`; leave it out for the project's default")

/** An object without its null, undefined and empty-string entries, nested objects included. */
const withoutEmpty = (o: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(o)
      .filter(([, v]) => v !== null && v !== undefined && v !== '')
      .map(([k, v]) => [k, v && typeof v === 'object' && !Array.isArray(v) ? withoutEmpty(v as Record<string, unknown>) : v]),
  )

// The API wraps successes as { data }; unwrap defensively.
const unwrap = <T>(res: unknown) => ((res as { data?: T } | null)?.data ?? res) as T

const seo = z
  .object({
    title: z.string().max(200).optional().describe('The <title>. Aim for under 60 characters.'),
    description: z.string().max(500).optional().describe('The meta description.'),
    canonicalUrl: z.string().max(2000).optional(),
    ogImage: z.string().max(2000).optional(),
    noIndex: z.boolean().optional(),
    keywords: z.array(z.string().max(60)).max(20).optional(),
    focusKeyword: z
      .string()
      .max(100)
      .optional()
      .describe(
        'The phrase this post should rank for. The SEO score checks it in the title, description, first paragraph, slug and a subheading.',
      ),
  })
  .describe('Search-engine fields. Omit any the person did not ask for.')

/**
 * Posts: the thing the product is actually for.
 *
 * `body` is markdown by default because that is what an assistant writes well
 * and what the editor round-trips without losing formatting. Passing HTML is
 * allowed and is what an import would use.
 */
export const postTools = [
  defineTool({
    name: 'list_posts',
    title: 'List posts',
    description:
      'Posts in a project, newest published first. Paginate with `cursor` from the previous ' +
      'response — there is no page number, by design. Filter before paginating. ' +
      'Each item carries seoScore (0-100, or null when unscored).',
    input: {
      ...projectArg,
      status: STATUS.optional(),
      category: z.string().optional().describe('Category slug.'),
      tag: z.string().optional().describe('Tag slug.'),
      author: z.string().optional().describe('Author slug.'),
      q: z.string().max(200).optional().describe('Title match. Use search_posts for full text.'),
      locale,
      limit: z.number().int().min(1).max(100).optional(),
      cursor: z.string().optional().describe('`nextCursor` from the previous response.'),
    },
    readOnly: true,
    run: (client, { projectId, ...query }) =>
      client.request('/v1/blog/posts', { projectId, query }),
  }),

  defineTool({
    name: 'get_post',
    title: 'Get a post',
    description:
      'One post with its full body, by id or by slug. It carries seoScore (0-100) and ' +
      'seoAudit.checks: fix "fail" and "warn" checks to raise the score. Free plans show the ' +
      'three most important issues and hiddenIssues.',
    input: {
      ...projectArg,
      id: z.string().optional().describe('The post id, as `post_...`.'),
      slug: z.string().optional().describe('Its slug, if you do not have the id.'),
      locale,
    },
    readOnly: true,
    run: (client, { projectId, id, slug, locale }) => {
      if (!id && !slug) throw new Error('Give either id or slug.')
      const path = id
        ? `/v1/blog/posts/${segment(id)}`
        : `/v1/blog/posts/slug/${segment(slug!)}`
      return client.request(path, { projectId, query: { locale } })
    },
  }),

  defineTool({
    name: 'search_posts',
    title: 'Search posts',
    description:
      'Full-text search across titles and bodies, ranked. Use this to find something; use ' +
      'list_posts to enumerate. May require a paid capability on the workspace.',
    input: {
      ...projectArg,
      q: z.string().min(1).max(200),
      locale,
      status: STATUS.optional(),
      limit: z.number().int().min(1).max(100).optional(),
    },
    readOnly: true,
    run: (client, { projectId, ...query }) =>
      client.request('/v1/blog/search', { projectId, query }),
  }),

  defineTool({
    name: 'create_post',
    title: 'Create a post',
    description:
      'Writes a new post. It is a draft unless you say otherwise, which is usually what you ' +
      'want: publishing is a decision the person should make. Requires the content.write grant, ' +
      'and content.publish as well if you send status "published".',
    input: {
      ...projectArg,
      title: z.string().min(1).max(300),
      locale,
      body: z.string().max(1_000_000).optional().describe('Markdown by default.'),
      bodyFormat: z.enum(['markdown', 'html', 'plain']).optional(),
      slug: z.string().max(200).optional().describe('Derived from the title when omitted.'),
      excerpt: z.string().max(1000).optional(),
      status: STATUS.optional().describe('Defaults to draft.'),
      categoryId: z.string().nullable().optional(),
      tags: z.array(z.string()).max(50).optional().describe('Tag slugs. Created if missing.'),
      authorId: z.string().optional(),
      publishedAt: z.string().optional().describe('ISO 8601. Only with status "published".'),
      scheduledAt: z.string().optional().describe('ISO 8601. Required with status "scheduled".'),
      seo: seo.optional(),
    },
    run: (client, { projectId, ...body }) =>
      client.request('/v1/blog/posts', { method: 'POST', projectId, body }),
  }),

  defineTool({
    name: 'update_post',
    title: 'Update a post',
    description:
      'Changes only the fields you send; anything omitted is left alone. This is how a post is ' +
      'published: send status "published", which needs the content.publish grant on top of ' +
      'content.write. Pass expectedRevision (the `revision` from get_post) so that an edit made ' +
      'against an old copy is refused with REVISION_CONFLICT instead of overwriting a newer save; ' +
      'on that error, read the post again and reapply the change. A `locale` other than the ' +
      "post's original language edits that language version (created if new, then title and body " +
      'are required); shared fields (category, tags, author, cover) cannot be combined with `locale`. ' +
      "Without `locale` the original is edited, and a post whose default version is not its original " +
      'is refused until you pass `locale`.',
    input: {
      ...projectArg,
      id: z.string().describe('The post id, as `post_...`.'),
      expectedRevision: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe('The `revision` of the copy this edit is based on. Recommended.'),
      locale,
      title: z.string().min(1).max(300).optional(),
      body: z.string().max(1_000_000).optional(),
      bodyFormat: z.enum(['markdown', 'html', 'plain']).optional(),
      slug: z.string().max(200).optional(),
      excerpt: z.string().max(1000).nullable().optional(),
      status: STATUS.optional(),
      categoryId: z.string().nullable().optional(),
      tags: z.array(z.string()).max(50).optional().describe('Replaces the whole set.'),
      authorId: z.string().nullable().optional(),
      publishedAt: z.string().nullable().optional(),
      scheduledAt: z.string().nullable().optional(),
      seo: seo.optional(),
    },
    run: async (client, { projectId, id, locale, ...body }) => {
      const path = `/v1/blog/posts/${segment(id)}`
      const patch = () => client.request(path, { method: 'PATCH', projectId, body })
      const post = unwrap<{ locale?: string; versions?: { locale: string; original?: boolean }[] }>(
        await client.request(path, { projectId }),
      )
      // `locale` on the post is the served version, not the original: only `versions` says which is the original.
      const original = post.versions?.find((v) => v.original)?.locale
      if (!locale) {
        // A PATCH writes the original; the agent was looking at another version's text.
        if (original && post.locale && original !== post.locale) {
          throw new Error(
            `This post was written in ${original}, but its ${post.locale} version is the one served by default. ` +
              `To choose, pass \`locale\`: "${original}" to edit the original, or "${post.locale}" to edit that version.`,
          )
        }
        return patch()
      }
      if (!original) {
        throw new Error('Cannot tell the post\'s original language (no `versions` in the response); not updating.')
      }
      if (original === locale) return patch()

      // Another language: the translations endpoint is strict and owns only the text fields.
      const { categoryId, tags, authorId, ...own } = body
      if (categoryId !== undefined || tags !== undefined || authorId !== undefined) {
        throw new Error(
          'Category, tags, author and featured image are shared by every language. ' +
            'Update them in a separate update_post call without `locale`.',
        )
      }
      const tPath = `${path}/translations/${segment(locale)}`
      let current: Record<string, unknown> | null = null
      try {
        current = unwrap(await client.request(tPath, { projectId }))
      } catch (err) {
        if (!(err instanceof ApiError && err.status === 404)) throw err
      }
      if (!current && (!own.title || own.body === undefined)) {
        throw new Error(`There is no ${locale} version yet: send both title and body to create it.`)
      }
      // PUT replaces the whole version, so start from what is stored and lay the caller's fields on top.
      const merged: Record<string, unknown> = {}
      if (current) {
        for (const k of ['title', 'body', 'excerpt', 'seo', 'bodyFormat', 'slug', 'status']) merged[k] = current[k]
        if (current.status === 'published') merged.publishedAt = current.publishedAt
        if (current.status === 'scheduled') merged.scheduledAt = current.scheduledAt
        merged.expectedRevision = current.revision
      }
      // What the API sends back has every key, nulls included (`seo.title: null`), and PUT
      // refuses a null where it wants a string: stored nulls are left out at every depth.
      // The caller's own null (excerpt: null) is kept, which is how a field is cleared.
      const put = { ...withoutEmpty(merged), ...Object.fromEntries(Object.entries(own).filter(([, v]) => v !== undefined)) }
      return client.request(tPath, { method: 'PUT', projectId, body: put })
    },
  }),

  defineTool({
    name: 'delete_post_translation',
    title: 'Delete a post translation',
    description:
      'Removes one language version of a post; the original and the other languages stay. ' +
      'locale: a language the project has turned on, e.g. `hi`; required here. Confirm with the ' +
      'person first. Requires the content.delete grant.',
    input: {
      ...projectArg,
      postId: z.string().describe('The post id, as `post_...`.'),
      locale: z.string().min(2).max(10).describe('The language version to remove, e.g. `hi`.'),
    },
    destructive: true,
    run: (client, { projectId, postId, locale }) =>
      client.request(`/v1/blog/posts/${segment(postId)}/translations/${segment(locale)}`, {
        method: 'DELETE',
        projectId,
      }),
  }),

  defineTool({
    name: 'delete_post',
    title: 'Delete a post',
    description:
      'Soft-deletes a post: it stops being served and its slug becomes free again. Confirm with ' +
      'the person first. Requires the content.delete grant.',
    input: { ...projectArg, id: z.string().describe('The post id, as `post_...`.') },
    destructive: true,
    run: (client, { projectId, id }) =>
      client.request(`/v1/blog/posts/${segment(id)}`, { method: 'DELETE', projectId }),
  }),
] as const
