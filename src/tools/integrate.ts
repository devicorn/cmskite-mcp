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
  .enum([
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
  ])
  .describe(
    'What the project is. Look at the files rather than guessing. ' +
      'JavaScript: `next` in package.json with an app/ directory is `nextjs-app`, `next` with ' +
      'pages/ is `nextjs-pages`, `react` without `next` is `react`, a package.json with no ' +
      'framework is `node`. ' +
      'Not JavaScript: .html files and no build step is `html`; wp-config.php or a wp-content/ ' +
      'directory is `wordpress`; artisan and composer.json with laravel/framework is `laravel`; ' +
      'any other .php is `php`; requirements.txt, pyproject.toml or .py is `python`. ' +
      'Use `other` for anything else and the answer is the raw HTTP calls, which work in every ' +
      'language.',
  )

export const integrationTools = [
  defineTool({
    name: 'get_integration_guide',
    title: 'How to integrate CMSKite into this project',
    description:
      'The official way to connect a project to CMSKite. For JavaScript and TypeScript that is ' +
      'the cmskite package; for PHP, WordPress, Laravel, Python or a plain HTML site it is the ' +
      'raw HTTP calls, which need no dependency at all. Returns what to install if anything, ' +
      'the files to write, and which key belongs on the server versus in the browser. ' +
      'Call this BEFORE writing any integration code by hand: hand-rolled fetch wrappers miss ' +
      'view tracking entirely, so the customer gets a working site with no analytics and no ' +
      'indication that anything is missing. ' +
      'Finish by calling check_integration, which is the only thing that can tell a working ' +
      'integration from one that silently reports nothing. ' +
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

/** Everything that is not JavaScript, and therefore uses the raw HTTP calls. */
const RAW = new Set(['html', 'php', 'wordpress', 'laravel', 'python', 'other'])

/** A site whose content is fetched by the browser, not by a server. */
const BROWSER_FETCHED = new Set(['html', 'react'])

function guide(args: GuideArgs): {
  install: string
  keys: { name: string; where: string; why: string }[]
  files: { path: string; contents: string }[]
  notes: string[]
  verify: string
} {
  const analytics = args.includeAnalytics !== false
  const raw = RAW.has(args.framework)

  const notes = [
    'Fetch the content on the server, report the view from the browser. That split IS the ' +
      'integration, and it is the part that gets missed: a site that only fetches content ' +
      'works perfectly and counts nobody.',
    'A CMSKite key is read-only and returns published content only. There is no secret ' +
      'credential here — but use two keys anyway, so the one in the page can be revoked ' +
      'without taking the site down.',
    'A view is reported by the page that renders the post, never inferred from an API ' +
      'request. A build fetching every post is two hundred requests and no readers.',
    'The tracker needs the post’s `id` (`post_...`), not its slug. Render the id into the ' +
      'page; a slug is rejected and the view is silently dropped.',
  ]

  if (BROWSER_FETCHED.has(args.framework)) {
    notes.push(
      'This site reads content from the browser, so allowed origins are NOT optional: add ' +
        'every domain the site is served from under Project → Settings → Allowed origins. ' +
        'Without them the browser refuses the response and the page renders empty.',
    )
  } else {
    notes.push(
      'Set allowed origins under Project → Settings → Allowed origins. Until that is set, any ' +
        'page anywhere can read this project’s published content.',
    )
  }

  if (args.projectId) {
    notes.push(`Create the keys for project ${args.projectId} with the create_api_key tool.`)
  }

  const keys = browserOnly(args.framework)
    ? [
        {
          name: 'the project key, pasted directly into the page',
          where: 'In the HTML. There is no server to hide it behind, and nothing to hide.',
          why:
            'Reads published content and reports views. Restrict its origins in project ' +
            'settings — that is the control that matters here, not secrecy.',
        },
      ]
    : [
        {
          name: 'CMSKITE_API_KEY',
          where: serverKeyHome(args.framework),
          why: 'Fetches content while the page is being rendered or built.',
        },
      ]

  if (analytics && !browserOnly(args.framework)) {
    keys.push({
      name: publicKeyName(args.framework),
      where: 'In the page the reader loads, deliberately.',
      why: 'Reports views. Restrict its origins in project settings.',
    })
  }

  return {
    install: raw ? 'Nothing to install. This is plain HTTP.' : 'npm install cmskite',
    keys,
    files: filesFor(args.framework, analytics),
    notes,
    verify:
      'When the files are in place, load one blog post in a browser, then call ' +
      'check_integration for this project. It reports whether the key has been used and ' +
      'whether views are arriving. Do not report the integration as finished before it passes.',
  }
}

/** No server at all, so there is nowhere to put a key that the page cannot see. */
function browserOnly(kind: GuideArgs['framework']): boolean {
  return kind === 'html'
}

function serverKeyHome(kind: GuideArgs['framework']): string {
  if (kind === 'wordpress') return 'wp-config.php, as a define(). Not in the theme.'
  if (kind === 'laravel') return '.env, read through config(). Never committed.'
  if (kind === 'php') return 'An environment variable, or a config file outside the web root.'
  if (kind === 'python') return 'An environment variable.'
  return 'Server environment only. Never prefixed with NEXT_PUBLIC_ or VITE_.'
}

function publicKeyName(kind: GuideArgs['framework']): string {
  if (kind.startsWith('nextjs')) return 'NEXT_PUBLIC_CMSKITE_KEY'
  if (kind === 'react') return 'VITE_CMSKITE_KEY or equivalent'
  return 'the project key, printed into the page by the template'
}

/**
 * The tracking snippet for a page that has no build step.
 *
 * This is the piece that a hand-rolled integration leaves out, so it is written
 * here once, correctly, rather than reinvented per site. Three things in it are
 * not obvious and are each the difference between a counted view and a silent
 * nothing:
 *
 *   `text/plain`. The body is JSON, but `application/json` is not on the CORS
 *   safelist, so the browser preflights the request -- and a preflight carries
 *   no key, so the API cannot tell which project's allowlist to answer from and
 *   refuses it. The beacon is then dropped with no error visible anywhere.
 *
 *   `sendBeacon`. The last view of a reading session is reported as the page is
 *   closing, and it is the only thing a browser promises to finish afterwards.
 *
 *   The post id, not the slug. An id the API does not recognise is dropped
 *   rather than refused, deliberately -- so a slug here produces a page that
 *   looks entirely healthy and counts nothing.
 */
const RAW_TRACKER = `<!--
  CMSKite view tracking.
  Put this at the end of the page that shows ONE post, and give it that post's id.
-->
<script>
(function () {
  var POST_ID = 'PASTE_THE_POST_ID'            // the post's id, like post_01h... NOT the slug
  var KEY     = 'PASTE_THE_PROJECT_KEY'        // the project's read-only key
  if (!POST_ID || !KEY || POST_ID.indexOf('PASTE') === 0) return

  // One view per post per tab. A refresh is not a second reader.
  try {
    var seen = 'cmskite:v:' + POST_ID
    if (sessionStorage.getItem(seen)) return
    sessionStorage.setItem(seen, '1')
  } catch (e) {
    // Private mode, or blocked site data. Count the view rather than lose it.
  }

  var url = 'https://api.cmskite.com/v1/blog/events?key=' + encodeURIComponent(KEY)
  var body = JSON.stringify({
    events: [{ type: 'view', postId: POST_ID, path: location.pathname }]
  })

  // text/plain is deliberate. The body is JSON, but this content type is
  // CORS-safelisted so the browser sends it with no preflight. Using
  // application/json here means the view is silently never delivered.
  var type = 'text/plain;charset=UTF-8'
  try {
    if (navigator.sendBeacon && navigator.sendBeacon(url, new Blob([body], { type: type }))) return
  } catch (e) {}
  try {
    fetch(url, { method: 'POST', headers: { 'content-type': type }, body: body, keepalive: true })
      .catch(function () {})
  } catch (e) {
    // Analytics must never break the page it is measuring.
  }
})()
</script>
`

function filesFor(
  kind: GuideArgs['framework'],
  analytics: boolean,
): { path: string; contents: string }[] {
  const rawFiles = rawFilesFor(kind, analytics)
  if (rawFiles) return rawFiles

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

/**
 * The guides for everything that is not JavaScript.
 *
 * Returns null for the frameworks the SDK covers, so `filesFor` keeps its own
 * shape and there is exactly one place that decides which world a project is
 * in.
 *
 * These are raw HTTP calls on purpose. A PHP or WordPress site cannot install
 * an npm package, and telling somebody to build one is how a five-minute
 * integration becomes a project. Every one of them is two requests: read the
 * posts with a key, and post the view from the page.
 */
function rawFilesFor(
  kind: GuideArgs['framework'],
  analytics: boolean,
): { path: string; contents: string }[] | null {
  const tracker = analytics ? [{ path: 'the-post-page (tracking snippet)', contents: RAW_TRACKER }] : []

  if (kind === 'html') {
    return [
      {
        path: 'blog.html',
        contents: `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Blog</title></head>
<body>
  <ul id="posts"></ul>

<script>
// A plain HTML site has no server, so the key is in the page. That is fine --
// the key is read-only and returns published posts only. What is NOT optional
// is the origin allowlist: add this site's domain under
// Project -> Settings -> Allowed origins, or the browser will refuse every
// response and this list will render empty with a CORS error in the console.
var KEY = 'PASTE_THE_PROJECT_KEY'

fetch('https://api.cmskite.com/v1/blog/posts?limit=20', {
  headers: { authorization: 'Bearer ' + KEY }
})
  .then(function (res) {
    if (!res.ok) throw new Error('CMSKite ' + res.status)
    return res.json()
  })
  .then(function (payload) {
    document.getElementById('posts').innerHTML = payload.data
      .map(function (post) {
        // textContent-safe: titles are author-controlled text, not markup.
        var a = document.createElement('a')
        a.href = 'post.html?slug=' + encodeURIComponent(post.slug)
        a.textContent = post.title
        return '<li>' + a.outerHTML + '</li>'
      })
      .join('')
  })
  .catch(function (err) {
    document.getElementById('posts').textContent = 'Could not load posts.'
    console.error(err)
  })
</script>
</body>
</html>
`,
      },
      {
        path: 'post.html',
        contents: `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Post</title></head>
<body>
  <article><h1 id="title"></h1><div id="body"></div></article>

<script>
var KEY = 'PASTE_THE_PROJECT_KEY'
var slug = new URLSearchParams(location.search).get('slug')

fetch('https://api.cmskite.com/v1/blog/posts/slug/' + encodeURIComponent(slug), {
  headers: { authorization: 'Bearer ' + KEY }
})
  .then(function (res) {
    if (res.status === 404) throw new Error('No such post')
    if (!res.ok) throw new Error('CMSKite ' + res.status)
    return res.json()
  })
  .then(function (payload) {
    var post = payload.data
    document.getElementById('title').textContent = post.title
    document.getElementById('body').innerHTML = post.body

    // The view is reported here, with the id the API just gave us -- which is
    // why this snippet lives inside the fetch and not beside it. Reporting a
    // slug reports nothing at all.
    trackView(post.id)
  })
  .catch(function (err) {
    document.getElementById('title').textContent = 'Post not found'
    console.error(err)
  })

${analytics ? rawTrackerFunction() : '// Tracking was left out. Every post will read zero views.\nfunction trackView() {}'}
</script>
</body>
</html>
`,
      },
    ]
  }

  if (kind === 'wordpress') {
    return [
      {
        path: 'wp-config.php (add near the other defines)',
        contents: `<?php
// The server key. Never echoed into a template.
define('CMSKITE_API_KEY', 'PASTE_THE_SERVER_KEY');
// The key the reader's browser uses to report views. Safe in the page.
define('CMSKITE_PUBLIC_KEY', 'PASTE_THE_BROWSER_KEY');
`,
      },
      {
        path: 'wp-content/themes/<your-theme>/cmskite.php',
        contents: `<?php
/**
 * CMSKite, for WordPress.
 *
 * Two functions and no dependency. Include this from functions.php:
 *
 *     require_once get_stylesheet_directory() . '/cmskite.php';
 */

function cmskite_get($path, $query = []) {
    $url = 'https://api.cmskite.com/v1' . $path;
    if ($query) {
        $url .= '?' . http_build_query($query);
    }

    // WordPress ships an HTTP client. Using it means proxies, timeouts and
    // filters behave the way the rest of the site does.
    $response = wp_remote_get($url, [
        'timeout' => 10,
        'headers' => ['authorization' => 'Bearer ' . CMSKITE_API_KEY],
    ]);

    if (is_wp_error($response)) {
        error_log('CMSKite: ' . $response->get_error_message());
        return null;
    }
    if (wp_remote_retrieve_response_code($response) !== 200) {
        error_log('CMSKite: HTTP ' . wp_remote_retrieve_response_code($response));
        return null;
    }

    $payload = json_decode(wp_remote_retrieve_body($response), true);
    return $payload['data'] ?? null;
}

/** The list. Cached, because a blog index should not make an API call per visitor. */
function cmskite_posts($limit = 20) {
    $cached = get_transient('cmskite_posts_' . $limit);
    if ($cached !== false) {
        return $cached;
    }
    $posts = cmskite_get('/blog/posts', ['limit' => $limit]) ?: [];
    set_transient('cmskite_posts_' . $limit, $posts, 5 * MINUTE_IN_SECONDS);
    return $posts;
}

/** One post, by its slug. Null when there is no such post. */
function cmskite_post($slug) {
    return cmskite_get('/blog/posts/slug/' . rawurlencode($slug));
}

${analytics ? phpTrackerHelper() : '// Tracking was left out. Every post will read zero views.'}
`,
      },
      {
        path: 'wp-content/themes/<your-theme>/page-blog.php',
        contents: `<?php
/* Template Name: CMSKite Blog */
get_header();

$posts = cmskite_posts(20);
?>
<ul>
<?php foreach ($posts as $post): ?>
  <li>
    <a href="<?php echo esc_url(home_url('/blog/' . $post['slug'])); ?>">
      <?php echo esc_html($post['title']); ?>
    </a>
  </li>
<?php endforeach; ?>
</ul>
<?php get_footer(); ?>
`,
      },
      {
        path: 'wp-content/themes/<your-theme>/single-cmskite.php',
        contents: `<?php
/* One post. Route your /blog/{slug} URLs here. */
get_header();

$slug = get_query_var('cmskite_slug');
$post = cmskite_post($slug);

if (!$post) {
    status_header(404);
    echo '<p>Post not found.</p>';
    get_footer();
    return;
}
?>
<article>
  <h1><?php echo esc_html($post['title']); ?></h1>
  <?php
    // The body is HTML the author wrote in CMSKite, so it is printed as markup
    // rather than escaped. wp_kses_post strips anything a post has no business
    // containing.
    echo wp_kses_post($post['body']);
  ?>
</article>
<?php
${analytics ? "// Reports the view. Takes the post's id -- a slug here counts nothing.\ncmskite_track_view($post['id']);" : '// No tracking: this post will always read zero views.'}
get_footer();
?>
`,
      },
    ]
  }

  if (kind === 'laravel') {
    return [
      {
        path: '.env',
        contents: `CMSKITE_API_KEY=PASTE_THE_SERVER_KEY
CMSKITE_PUBLIC_KEY=PASTE_THE_BROWSER_KEY
`,
      },
      {
        path: 'config/services.php (add to the returned array)',
        contents: `'cmskite' => [
    'key' => env('CMSKITE_API_KEY'),
    'public_key' => env('CMSKITE_PUBLIC_KEY'),
    'url' => 'https://api.cmskite.com/v1',
],
`,
      },
      {
        path: 'app/Services/CMSKite.php',
        contents: `<?php

namespace App\\Services;

use Illuminate\\Support\\Facades\\Cache;
use Illuminate\\Support\\Facades\\Http;
use Illuminate\\Support\\Facades\\Log;

/**
 * CMSKite, through Laravel's own HTTP client.
 *
 * No package: this is two GETs. The client is here rather than in the
 * controllers so the key is attached in exactly one place and the failure
 * behaviour is the same everywhere -- a blog that cannot reach the API renders
 * an empty list, it does not 500.
 */
class CMSKite
{
    /** @return array<int, array<string, mixed>> */
    public function posts(int $limit = 20): array
    {
        return Cache::remember("cmskite.posts.{$limit}", now()->addMinutes(5), function () use ($limit) {
            return $this->get('/blog/posts', ['limit' => $limit]) ?? [];
        });
    }

    /** @return array<string, mixed>|null */
    public function post(string $slug): ?array
    {
        return $this->get('/blog/posts/slug/' . rawurlencode($slug));
    }

    private function get(string $path, array $query = []): mixed
    {
        try {
            $response = Http::withToken(config('services.cmskite.key'))
                ->timeout(10)
                ->get(config('services.cmskite.url') . $path, $query);

            if ($response->status() === 404) {
                return null;
            }
            if ($response->failed()) {
                Log::warning('CMSKite responded ' . $response->status(), [
                    // Every CMSKite response carries one, and support can find
                    // the request from it.
                    'requestId' => $response->json('requestId'),
                ]);
                return null;
            }

            return $response->json('data');
        } catch (\\Throwable $e) {
            Log::warning('CMSKite unreachable: ' . $e->getMessage());
            return null;
        }
    }
}
`,
      },
      {
        path: 'resources/views/blog/show.blade.php',
        contents: `<article>
  <h1>{{ $post['title'] }}</h1>
  {{-- The body is HTML the author wrote in CMSKite, so it is not escaped. --}}
  {!! $post['body'] !!}
</article>

${
  analytics
    ? `{{-- Reports the view. Uses the post's id: a slug here counts nothing. --}}
@include('blog.track', ['postId' => $post['id']])`
    : '{{-- No tracking: this post will always read zero views. --}}'
}
`,
      },
      ...(analytics
        ? [
            {
              path: 'resources/views/blog/track.blade.php',
              contents: bladeTracker(),
            },
          ]
        : []),
    ]
  }

  if (kind === 'php') {
    return [
      {
        path: 'cmskite.php',
        contents: `<?php
/**
 * CMSKite, in plain PHP. No dependency -- this is two GETs.
 *
 * The key comes from the environment rather than from this file, so it is not
 * in version control and not served if the web server ever stops executing
 * .php files.
 */

function cmskite_get(string $path, array $query = []): mixed
{
    $url = 'https://api.cmskite.com/v1' . $path;
    if ($query) {
        $url .= '?' . http_build_query($query);
    }

    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 10,
        CURLOPT_HTTPHEADER => ['authorization: Bearer ' . getenv('CMSKITE_API_KEY')],
    ]);

    $body = curl_exec($ch);
    $status = curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    // No curl_close(). It has done nothing since PHP 8.0 and since 8.5 it
    // prints a deprecation notice -- into the page, above the <!doctype>.

    // A blog that cannot reach the API renders empty. It does not fatal.
    if ($body === false || $status !== 200) {
        error_log("CMSKite: HTTP {$status} for {$path}");
        return null;
    }

    $payload = json_decode($body, true);
    return $payload['data'] ?? null;
}

function cmskite_posts(int $limit = 20): array
{
    return cmskite_get('/blog/posts', ['limit' => $limit]) ?? [];
}

function cmskite_post(string $slug): ?array
{
    return cmskite_get('/blog/posts/slug/' . rawurlencode($slug));
}

${analytics ? phpTrackerHelper() : '// Tracking was left out. Every post will read zero views.'}
`,
      },
      {
        path: 'blog.php',
        contents: `<?php require __DIR__ . '/cmskite.php'; ?>
<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Blog</title></head>
<body>
<ul>
<?php foreach (cmskite_posts(20) as $post): ?>
  <li>
    <a href="/post.php?slug=<?= urlencode($post['slug']) ?>">
      <?= htmlspecialchars($post['title'], ENT_QUOTES, 'UTF-8') ?>
    </a>
  </li>
<?php endforeach; ?>
</ul>
</body>
</html>
`,
      },
      {
        path: 'post.php',
        contents: `<?php
require __DIR__ . '/cmskite.php';

$post = cmskite_post($_GET['slug'] ?? '');
if (!$post) {
    http_response_code(404);
    echo 'Post not found';
    exit;
}
?>
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title><?= htmlspecialchars($post['title'], ENT_QUOTES, 'UTF-8') ?></title>
</head>
<body>
<article>
  <h1><?= htmlspecialchars($post['title'], ENT_QUOTES, 'UTF-8') ?></h1>
  <?php
    // The body is HTML the author wrote in CMSKite, so it is printed as markup.
    echo $post['body'];
  ?>
</article>
<?php
${analytics ? "// Reports the view. Uses the post's id -- a slug here counts nothing.\ncmskite_track_view($post['id']);" : '// No tracking: this post will always read zero views.'}
?>
</body>
</html>
`,
      },
    ]
  }

  if (kind === 'python') {
    return [
      {
        path: 'cmskite.py',
        contents: `"""CMSKite, in plain Python. No package -- this is two GETs.

The key comes from the environment. It is read-only and returns published
content only, but it still does not belong in the repository.
"""

import os
import httpx

BASE_URL = "https://api.cmskite.com/v1"

_client = httpx.Client(
    base_url=BASE_URL,
    timeout=10.0,
    headers={"authorization": f"Bearer {os.environ['CMSKITE_API_KEY']}"},
)


def posts(limit: int = 20) -> list[dict]:
    """The published posts, newest first. Empty when the API cannot be reached."""
    try:
        response = _client.get("/blog/posts", params={"limit": limit})
        response.raise_for_status()
    except httpx.HTTPError as error:
        # A blog that cannot reach the API renders empty rather than erroring.
        print(f"CMSKite: {error}")
        return []
    return response.json()["data"]


def post(slug: str) -> dict | None:
    """One post, or None when there is no such post."""
    try:
        response = _client.get(f"/blog/posts/slug/{slug}")
        if response.status_code == 404:
            return None
        response.raise_for_status()
    except httpx.HTTPError as error:
        print(f"CMSKite: {error}")
        return None
    return response.json()["data"]
`,
      },
      {
        path: 'templates/post.html (Jinja, Django or anything else)',
        contents: `<article>
  <h1>{{ post.title }}</h1>
  {# The body is HTML the author wrote in CMSKite, so it is not escaped. #}
  {{ post.body | safe }}
</article>

${
  analytics
    ? `{# Reports the view. Uses the post's id -- a slug here counts nothing. #}
${RAW_TRACKER.replace("var POST_ID = 'PASTE_THE_POST_ID'            // the post's id, like post_01h... NOT the slug", "var POST_ID = '{{ post.id }}'").replace("var KEY     = 'PASTE_THE_PROJECT_KEY'        // the project's read-only key", "var KEY     = '{{ cmskite_public_key }}'")}`
    : '{# No tracking: this post will always read zero views. #}'
}
`,
      },
    ]
  }

  if (kind === 'other') {
    return [
      {
        path: 'README-cmskite.md',
        contents: `# CMSKite, in any language

Two requests. There is no SDK to wait for.

## 1. Read the content (on your server)

    GET https://api.cmskite.com/v1/blog/posts?limit=20
    Authorization: Bearer <your project key>

    GET https://api.cmskite.com/v1/blog/posts/slug/<slug>
    Authorization: Bearer <your project key>

Every response is \`{ "success": true, "data": ..., "requestId": "req_..." }\`.
A list also carries \`pagination\`. Quote the \`requestId\` to support.

The key already knows which project it belongs to, so there is no workspace or
project header to send — one supplied by the client is refused, not honoured.

## 2. Report the view (from the reader's browser)

This is the half that gets skipped, and skipping it is invisible: the site
works, and every post reads zero views forever.

    POST https://api.cmskite.com/v1/blog/events?key=<your project key>
    Content-Type: text/plain;charset=UTF-8

    {"events":[{"type":"view","postId":"post_01h...","path":"/blog/hello"}]}

Three things that are not obvious:

- **\`postId\`, not the slug.** An id the API does not recognise is dropped
  rather than refused, so a slug produces a page that looks healthy and counts
  nothing.
- **\`text/plain\`.** The body is JSON, but \`application/json\` is not
  CORS-safelisted, so a browser preflights it — and the preflight carries no
  key, so it is refused and the view is silently never sent.
- **It must run in the reader's browser.** A server fetching a post is not a
  reader, which is exactly why fetching is not counted as one.

The snippet is below. Give it the post's id.

${RAW_TRACKER}

## 3. Check it worked

Load one post in a browser, then ask for this project's integration health. It
reports whether the key has been used and whether views are arriving. Do not
call the integration finished before it passes.
`,
      },
      ...tracker,
    ]
  }

  return null
}

/**
 * The tracker as a callable function, for a page that only learns the post id
 * after its fetch has resolved.
 */
function rawTrackerFunction(): string {
  return `// Reports one view. See the notes: text/plain and the post id, not the slug.
function trackView(postId) {
  if (!postId || !KEY) return
  try {
    var seen = 'cmskite:v:' + postId
    if (sessionStorage.getItem(seen)) return
    sessionStorage.setItem(seen, '1')
  } catch (e) {
    // Private mode. Count the view rather than lose it.
  }

  var url = 'https://api.cmskite.com/v1/blog/events?key=' + encodeURIComponent(KEY)
  var body = JSON.stringify({
    events: [{ type: 'view', postId: postId, path: location.pathname }]
  })
  // text/plain is CORS-safelisted, so this is not preflighted. Using
  // application/json means the view is silently never delivered.
  var type = 'text/plain;charset=UTF-8'
  try {
    if (navigator.sendBeacon && navigator.sendBeacon(url, new Blob([body], { type: type }))) return
  } catch (e) {}
  try {
    fetch(url, { method: 'POST', headers: { 'content-type': type }, body: body, keepalive: true })
      .catch(function () {})
  } catch (e) {}
}`
}

/** The same snippet, printed by PHP with the ids already filled in. */
function phpTrackerHelper(): string {
  return `/**
 * Prints the view-tracking snippet for one post.
 *
 * Call it from the template that renders a single post, with that post's id.
 * The id is required: a slug is dropped by the API rather than refused, so
 * passing one gives a page that looks fine and counts nothing.
 */
function cmskite_track_view(string $postId): void
{
    $post = json_encode($postId);
    $key = json_encode(getenv('CMSKITE_PUBLIC_KEY') ?: (defined('CMSKITE_PUBLIC_KEY') ? CMSKITE_PUBLIC_KEY : ''));
    echo <<<HTML
<script>
(function () {
  var POST_ID = {$post}
  var KEY = {$key}
  if (!POST_ID || !KEY) return
  try {
    var seen = 'cmskite:v:' + POST_ID
    if (sessionStorage.getItem(seen)) return
    sessionStorage.setItem(seen, '1')
  } catch (e) {}
  var url = 'https://api.cmskite.com/v1/blog/events?key=' + encodeURIComponent(KEY)
  var body = JSON.stringify({ events: [{ type: 'view', postId: POST_ID, path: location.pathname }] })
  // text/plain is CORS-safelisted, so this is not preflighted. application/json
  // would be, and the view would be silently dropped.
  var type = 'text/plain;charset=UTF-8'
  try { if (navigator.sendBeacon && navigator.sendBeacon(url, new Blob([body], { type: type }))) return } catch (e) {}
  try { fetch(url, { method: 'POST', headers: { 'content-type': type }, body: body, keepalive: true }).catch(function () {}) } catch (e) {}
})()
</script>
HTML;
}`
}

/** The Blade partial, which receives the post id from the view that includes it. */
function bladeTracker(): string {
  return `{{--
  Reports one view for this post.
  Included with: @include('blog.track', ['postId' => $post['id']])
  The id is required -- a slug is dropped by the API rather than refused.
--}}
<script>
(function () {
  var POST_ID = @json($postId)
  var KEY = @json(config('services.cmskite.public_key'))
  if (!POST_ID || !KEY) return
  try {
    var seen = 'cmskite:v:' + POST_ID
    if (sessionStorage.getItem(seen)) return
    sessionStorage.setItem(seen, '1')
  } catch (e) {}
  var url = 'https://api.cmskite.com/v1/blog/events?key=' + encodeURIComponent(KEY)
  var body = JSON.stringify({ events: [{ type: 'view', postId: POST_ID, path: location.pathname }] })
  // text/plain is CORS-safelisted, so this is not preflighted. application/json
  // would be, and the view would be silently dropped.
  var type = 'text/plain;charset=UTF-8'
  try { if (navigator.sendBeacon && navigator.sendBeacon(url, new Blob([body], { type: type }))) return } catch (e) {}
  try { fetch(url, { method: 'POST', headers: { 'content-type': type }, body: body, keepalive: true }).catch(function () {}) } catch (e) {}
})()
</script>
`
}
