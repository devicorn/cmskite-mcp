import { describe, expect, it } from 'vitest'
import { z } from 'zod'
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
