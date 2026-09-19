import { z } from 'zod'
import { defineTool, projectArg } from './register.js'

const STATUS = z.enum(['draft', 'scheduled', 'published', 'archived'])

const seo = z
  .object({
    title: z.string().max(200).optional().describe('The <title>. Aim for under 60 characters.'),
    description: z.string().max(500).optional().describe('The meta description.'),
    canonicalUrl: z.string().max(2000).optional(),
    ogImage: z.string().max(2000).optional(),
    noIndex: z.boolean().optional(),
    keywords: z.array(z.string().max(60)).max(20).optional(),
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
      'response — there is no page number, by design. Filter before paginating.',
    input: {
      ...projectArg,
      status: STATUS.optional(),
      category: z.string().optional().describe('Category slug.'),
      tag: z.string().optional().describe('Tag slug.'),
      author: z.string().optional().describe('Author slug.'),
      q: z.string().max(200).optional().describe('Title match. Use search_posts for full text.'),
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
    description: 'One post with its full body, by id or by slug.',
    input: {
      ...projectArg,
      id: z.string().optional().describe('The post id, as `post_...`.'),
      slug: z.string().optional().describe('Its slug, if you do not have the id.'),
    },
    readOnly: true,
    run: (client, { projectId, id, slug }) => {
      if (!id && !slug) throw new Error('Give either id or slug.')
      const path = id ? `/v1/blog/posts/${id}` : `/v1/blog/posts/slug/${slug}`
      return client.request(path, { projectId })
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
      'want: publishing is a decision the person should make. Requires the content.write grant.',
    input: {
      ...projectArg,
      title: z.string().min(1).max(300),
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
      'published: send status "published". Requires the content.write grant.',
    input: {
      ...projectArg,
      id: z.string().describe('The post id, as `post_...`.'),
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
    run: (client, { projectId, id, ...body }) =>
      client.request(`/v1/blog/posts/${id}`, { method: 'PATCH', projectId, body }),
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
      client.request(`/v1/blog/posts/${id}`, { method: 'DELETE', projectId }),
  }),
] as const
