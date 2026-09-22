import { z } from 'zod'
import { defineTool } from './register.js'

/**
 * How to wire CMSKite into a project that already exists.
 *
 * An assistant with the other tools could create a project, write posts and
 * mint a key, and would then write the integration by hand -- a `fetch`
 * wrapper, a URL built from a template string, a `catch` that re-threw a
 * `TypeError`, and no view tracking at all, because nothing told it there was
 * any. Every assistant wrote a slightly different one, and none of them counted
 * a reader.
 *
 * This tool answers with the official SDK instead. It is not a code generator:
 * it returns the two or three files that project shape needs, and says which
 * key goes where, because that is the part that is easy to get wrong in a way
 * nobody notices until a secret is in a bundle.
 *
 * Deliberately not clever about detection. The caller says what it found --
 * an assistant has already read the package.json it is standing in -- and this
 * answers for that. Guessing from a directory listing would be a brittle
 * assumption dressed as intelligence.
 */

const framework = z
  .enum(['nextjs-app', 'nextjs-pages', 'react', 'node', 'other'])
  .describe(
    'What the project is. Read it from package.json rather than guessing: `next` in ' +
      'dependencies with an app/ directory is `nextjs-app`, `next` with pages/ is ' +
      '`nextjs-pages`, `react` without `next` is `react`, no framework is `node`. Use ' +
      '`other` for anything else and the answer will be framework-neutral.',
  )

export const integrationTools = [
  defineTool({
    name: 'get_integration_guide',
    title: 'How to integrate CMSKite into this project',
    description:
      'The official way to connect a JavaScript or TypeScript project to CMSKite, using the ' +
      'cmskite package. Returns the install command, the files to write, and which key ' +
      'belongs on the server versus in the browser. ' +
      'Call this BEFORE writing any integration code by hand: hand-rolled fetch wrappers miss ' +
      'view tracking entirely, so the customer gets a working site with no analytics and no ' +
      'indication that anything is missing. ' +
      'Does not read or change anything in CMSKite.',
    input: {
      framework,
      projectId: z
        .string()
        .optional()
        .describe('The CMSKite project id, as `prj_...`, if one already exists.'),
      includeAnalytics: z
        .boolean()
        .optional()
        .describe('Include view and click tracking. Defaults to true; there is rarely a reason not to.'),
    },
    readOnly: true,
    run: (_client, args) => Promise.resolve(guide(args)),
  }),
]

interface GuideArgs {
  framework: z.infer<typeof framework>
  projectId?: string | undefined
  includeAnalytics?: boolean | undefined
}

function guide(args: GuideArgs): {
  install: string
  keys: { name: string; where: string; why: string }[]
  files: { path: string; contents: string }[]
  notes: string[]
} {
  const analytics = args.includeAnalytics !== false
  const notes = [
    'Fetch on the server, track in the browser. That split IS the integration.',
    'A CMSKite key is read-only and scoped to one project. There is no secret credential, ' +
      'so nothing here needs hiding — but use two keys anyway, so the exposed one can be ' +
      'revoked without taking the build down.',
    'Set the allowed origins on the browser key: Project → Settings → Allowed origins. ' +
      'Until that is set, any page anywhere can read the published content with it.',
    'A view is reported by the page that renders the post, never inferred from an API ' +
      'request. A build fetching every post is two hundred requests and no readers.',
  ]

  if (args.projectId) {
    notes.push(`Create the keys for project ${args.projectId} with the create_api_key tool.`)
  }

  const keys = [
    {
      name: 'CMSKITE_API_KEY',
      where: 'Server environment only. Never prefixed with NEXT_PUBLIC_ or VITE_.',
      why: 'Used by createCMSKite to fetch content during rendering or at build time.',
    },
  ]
  if (analytics) {
    keys.push({
      name:
        args.framework.startsWith('nextjs')
          ? 'NEXT_PUBLIC_CMSKITE_KEY'
          : 'VITE_CMSKITE_KEY or equivalent',
      where: 'In the browser bundle, deliberately.',
      why: 'Used by the tracker to report views. Restrict its origins in project settings.',
    })
  }

  return {
    install: 'npm install cmskite',
    keys,
    files: filesFor(args.framework, analytics),
    notes,
  }
}

function filesFor(
  kind: GuideArgs['framework'],
  analytics: boolean,
): { path: string; contents: string }[] {
  const client = `import { createCMSKite } from 'cmskite'

// Created once and reused. It holds no connection and no mutable state.
export const cms = createCMSKite({ apiKey: process.env.CMSKITE_API_KEY! })
`

  const tracker = `'use client'

import { useTrackView } from 'cmskite/react'

/**
 * Reports one view for this post, once.
 *
 * Safe to render on every navigation: the hook reports the first mount only,
 * and the tracker remembers the post for the tab besides. Nothing here can
 * throw, and nothing blocks the page.
 */
export function TrackView({ postId }: { postId: string }) {
  useTrackView(postId, { apiKey: process.env.NEXT_PUBLIC_CMSKITE_KEY! })
  return null
}
`

  if (kind === 'nextjs-app') {
    return [
      { path: 'lib/cmskite.ts', contents: client },
      ...(analytics ? [{ path: 'components/track-view.tsx', contents: tracker }] : []),
      {
        path: 'app/blog/[slug]/page.tsx',
        contents: `import { notFound } from 'next/navigation'
import { cms } from '@/lib/cmskite'
${analytics ? "import { TrackView } from '@/components/track-view'\n" : ''}
export async function generateStaticParams() {
  const params = []
  // An async iterator, so a site with four thousand posts does not hold four
  // thousand posts in memory to build a route list.
  for await (const post of cms.posts.all({ status: 'published' })) {
    params.push({ slug: post.slug })
  }
  return params
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  // findBySlug answers null rather than throwing, so the page renders its own
  // not-found state.
  const post = await cms.posts.findBySlug(slug)
  if (!post) notFound()

  return (
    <article>
      <h1>{post.title}</h1>
      <div dangerouslySetInnerHTML={{ __html: post.body }} />
${analytics ? '      <TrackView postId={post.id} />\n' : ''}    </article>
  )
}
`,
      },
      {
        path: 'app/blog/page.tsx',
        contents: `import Link from 'next/link'
import { cms } from '@/lib/cmskite'

export default async function BlogIndex() {
  const { items } = await cms.posts.list({ limit: 20, status: 'published' })

  return (
    <ul>
      {items.map((post) => (
        <li key={post.id}>
          <Link href={\`/blog/\${post.slug}\`}>{post.title}</Link>
        </li>
      ))}
    </ul>
  )
}
`,
      },
    ]
  }

  if (kind === 'nextjs-pages') {
    return [
      { path: 'lib/cmskite.ts', contents: client },
      {
        path: 'pages/blog/[slug].tsx',
        contents: `import type { GetStaticPaths, GetStaticProps } from 'next'
${analytics ? "import { useTrackView } from 'cmskite/react'\n" : ''}import type { Post } from 'cmskite'
import { cms } from '../../lib/cmskite'

export default function BlogPost({ post }: { post: Post }) {
${analytics ? "  useTrackView(post.id, { apiKey: process.env.NEXT_PUBLIC_CMSKITE_KEY! })\n\n" : ''}  return (
    <article>
      <h1>{post.title}</h1>
      <div dangerouslySetInnerHTML={{ __html: post.body }} />
    </article>
  )
}

export const getStaticPaths: GetStaticPaths = async () => {
  const { items } = await cms.posts.list({ limit: 100, status: 'published' })
  return { paths: items.map((p) => ({ params: { slug: p.slug } })), fallback: 'blocking' }
}

export const getStaticProps: GetStaticProps = async ({ params }) => {
  const post = await cms.posts.findBySlug(String(params?.slug))
  if (!post) return { notFound: true }
  return { props: { post }, revalidate: 300 }
}
`,
      },
    ]
  }

  if (kind === 'react') {
    return [
      {
        path: 'src/cmskite.ts',
        contents: `import { createCMSKite } from 'cmskite'

/**
 * A browser-only app has no server to hide a key behind, so this is the
 * read-only project key and its origins MUST be restricted in project
 * settings. If this app has a backend, fetch there instead and let the browser
 * do only the tracking.
 */
export const cms = createCMSKite({ apiKey: import.meta.env.VITE_CMSKITE_KEY })
`,
      },
      {
        path: 'src/BlogPost.tsx',
        contents: `import { useEffect, useState } from 'react'
${analytics ? "import { useTrackView } from 'cmskite/react'\n" : ''}import { CMSKiteError, type Post } from 'cmskite'
import { cms } from './cmskite'

export function BlogPost({ slug }: { slug: string }) {
  const [post, setPost] = useState<Post | null>(null)
  const [error, setError] = useState<string | null>(null)

${analytics ? "  useTrackView(post?.id, { apiKey: import.meta.env.VITE_CMSKITE_KEY })\n\n" : ''}  useEffect(() => {
    // Cancelled on unmount, and when a newer slug supersedes this one.
    const controller = new AbortController()
    cms.posts
      .findBySlug(slug, { signal: controller.signal })
      .then(setPost)
      .catch((err: unknown) => {
        if (err instanceof CMSKiteError) setError(err.message)
      })
    return () => controller.abort()
  }, [slug])

  if (error) return <p>{error}</p>
  if (!post) return <p>Loading…</p>
  return (
    <article>
      <h1>{post.title}</h1>
      <div dangerouslySetInnerHTML={{ __html: post.body }} />
    </article>
  )
}
`,
      },
    ]
  }

  return [
    {
      path: 'cmskite.ts',
      contents: `${client}
// Reading content:
//   const { items } = await cms.posts.list({ limit: 10 })
//   const post = await cms.posts.getBySlug('my-post')
//
// Every page at once, without a cursor loop:
//   for await (const post of cms.posts.all()) { … }
//
// Errors are one type, with a status, a stable code and a request id:
//   catch (error) { if (error instanceof CMSKiteError) … }
${
  analytics
    ? `
// View tracking runs in a browser, not here. A server fetching a post is not
// a reader, which is the whole reason it is not counted as one. Send the
// rendered page the project's public key and call trackView there.`
    : ''
}`,
    },
  ]
}
