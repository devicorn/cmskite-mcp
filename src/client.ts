import type { Config } from './config.js'

/**
 * The one place that talks to CMSKite.
 *
 * Every tool goes through here so that the token is attached in exactly one
 * place and cannot be forgotten, and so that an API error becomes the same
 * readable sentence however it arrived.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly requestId: string | null,
    readonly details: unknown,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export interface RequestOptions {
  method?: string
  body?: unknown
  query?: Record<string, string | number | undefined | null>
  /** Sent as `X-Project-Id`. An agent token is not scoped to one project. */
  projectId?: string | null
}

export class CmsKiteClient {
  constructor(private readonly config: Config) {}

  get projectDefault(): string | null {
    return this.config.defaultProjectId
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const url = new URL(this.config.apiUrl + path)
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, String(value))
      }
    }

    const headers: Record<string, string> = {
      authorization: `Bearer ${this.config.token}`,
      accept: 'application/json',
    }
    const projectId = options.projectId ?? this.config.defaultProjectId
    if (projectId) headers['x-project-id'] = projectId
    if (options.body !== undefined) headers['content-type'] = 'application/json'

    const response = await fetch(url, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    })

    const text = await response.text()
    const payload = text ? safeParse(text) : null

    if (!response.ok) {
      const error = (payload as { error?: Record<string, unknown> } | null)?.error ?? {}
      throw new ApiError(
        response.status,
        String(error.code ?? 'HTTP_ERROR'),
        String(error.message ?? `${response.status} from ${path}`),
        (payload as { requestId?: string } | null)?.requestId ?? null,
        error.details ?? null,
      )
    }

    return payload as T
  }
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    // A proxy returning HTML, usually. Keeping the first line is enough to
    // recognise that and far better than the parse error.
    return { error: { code: 'BAD_RESPONSE', message: text.slice(0, 200) } }
  }
}
