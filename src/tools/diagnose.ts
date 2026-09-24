import { z } from 'zod'
import { segment } from '../client.js'
import { defineTool } from './register.js'

/**
 * Whether the work actually worked.
 *
 * Every other tool here changes something and reports that it changed it. None
 * of them could tell anybody whether the result was a working website, and the
 * failure this product has is specifically one that reports success: an
 * assistant creates a project, writes eight posts, mints a key and wires up the
 * content fetching, and every one of those steps succeeds. The tracker is a
 * separate snippet, nothing asked for it, and so nobody added it. The site
 * works. Every post reads zero views. There is no error anywhere to find.
 *
 * So `check_integration` exists to make that state something a tool can say out
 * loud. It is the last call of any integration, and the first call of "why are
 * my views zero".
 */
export const diagnosticTools = [
  defineTool({
    name: 'check_integration',
    title: 'Is this project actually working?',
    description:
      'Checks whether a project is really connected to a website: does it have a key, has a ' +
      'site ever used it, and are views arriving from the pages that render the content. ' +
      'Each check comes back with the one action that fixes it. ' +
      'ALWAYS call this after wiring up an integration, and always when somebody says views or ' +
      'analytics are zero — a site can fetch content perfectly and report nothing, and this is ' +
      'the only thing that tells the difference. Requires the project.read grant.',
    input: { projectId: z.string().describe('The project id, as `prj_...`.') },
    readOnly: true,
    run: (client, args) =>
      client.request(`/v1/projects/${segment(args.projectId)}/integration-health`),
  }),

  defineTool({
    name: 'get_content_analytics',
    title: 'Views, uniques and clicks',
    description:
      'What readers did with a project’s posts over a date range: totals, a daily series, and ' +
      'the posts that were actually read. Read from rollups, so the answer is the same size ' +
      'whatever the traffic was. If everything is zero, call check_integration — that is a ' +
      'tracking problem far more often than it is a traffic problem. Requires the ' +
      'analytics.read grant.',
    input: {
      projectId: z.string().describe('The project id, as `prj_...`.'),
      from: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional()
        .describe('Inclusive UTC day. Defaults to 30 days ago.'),
      to: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional()
        .describe('Inclusive UTC day. Defaults to today.'),
      topPosts: z
        .number()
        .int()
        .min(1)
        .max(50)
        .optional()
        .describe('How many of the best-read posts to include. Defaults to 10.'),
    },
    readOnly: true,
    run: async (client, args) => {
      const query = { projectId: args.projectId, from: args.from, to: args.to }
      // Two calls rather than one, because the summary and the leaderboard are
      // different shapes and an assistant asking "how is the blog doing" wants
      // both. They are independent reads and nothing here mutates, so they go
      // together.
      const [summary, top] = await Promise.all([
        client.request<unknown>('/v1/analytics/content/summary', { query }),
        client.request<unknown>('/v1/analytics/content/top-posts', {
          query: { ...query, limit: args.topPosts ?? 10 },
        }),
      ])
      return { summary, topPosts: top }
    },
  }),

  defineTool({
    name: 'get_post_analytics',
    title: 'One post, day by day',
    description:
      'Views, unique readers and clicks for one post, per day. The way to check that a specific ' +
      'post\'s view landed after wiring up tracking: open the post in a real browser (headless ' +
      'browsers are not counted), wait about a minute for the rollup, then call this. A reader ' +
      'counts once per post per day. Requires the analytics.read grant.',
    input: {
      projectId: z.string().describe('The project id, as `prj_...`.'),
      postId: z.string().describe('The post id, as `post_...`. Not the slug.'),
      from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('Inclusive UTC day. Defaults to 30 days ago.'),
      to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('Inclusive UTC day. Defaults to today.'),
    },
    readOnly: true,
    run: (client, args) =>
      client.request(`/v1/analytics/content/posts/${segment(args.postId)}`, {
        query: { projectId: args.projectId, from: args.from, to: args.to },
      }),
  }),
] as const
