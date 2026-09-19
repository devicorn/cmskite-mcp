import { z } from 'zod'
import { segment } from '../client.js'
import { defineTool, projectArg } from './register.js'

/**
 * Categories, tags and authors: what a post is filed under and who wrote it.
 *
 * Categories nest, at most three deep, and a post has exactly one. Tags are
 * flat and a post has many. Authors are content, not accounts — a byline does
 * not require creating a login for a dead historical figure.
 */
export const taxonomyTools = [
  defineTool({
    name: 'list_categories',
    title: 'List categories',
    description:
      'The category tree, ordered so a parent always precedes its children; `depth` is how far ' +
      'to indent. Pass include="counts" to get how many posts sit in each.',
    input: {
      ...projectArg,
      parentId: z.string().optional().describe('Direct children of this one. "root" for top level.'),
      q: z.string().optional().describe('Filter on name, slug or path.'),
      include: z.literal('counts').optional(),
    },
    readOnly: true,
    run: (client, { projectId, ...query }) =>
      client.request('/v1/blog/categories', { projectId, query }),
  }),

  defineTool({
    name: 'create_category',
    title: 'Create a category',
    description:
      'A section of the blog, or a subsection of one when you pass parentId. Three levels deep ' +
      'at most. Requires the content.write grant.',
    input: {
      ...projectArg,
      name: z.string().min(1).max(200),
      slug: z.string().max(200).optional(),
      description: z.string().max(1000).optional(),
      parentId: z.string().nullable().optional().describe('Omit for a top-level category.'),
    },
    run: (client, { projectId, ...body }) =>
      client.request('/v1/blog/categories', { method: 'POST', projectId, body }),
  }),

  defineTool({
    name: 'update_category',
    title: 'Update or move a category',
    description:
      'Renames a category, or moves it under a different parent — which moves everything beneath ' +
      'it too. A category cannot be moved inside one of its own subcategories.',
    input: {
      ...projectArg,
      id: z.string().describe('The category id, as `cat_...`.'),
      name: z.string().min(1).max(200).optional(),
      slug: z.string().max(200).optional(),
      description: z.string().max(1000).nullable().optional(),
      parentId: z.string().nullable().optional().describe('null moves it to the top level.'),
    },
    run: (client, { projectId, id, ...body }) =>
      client.request(`/v1/blog/categories/${segment(id)}`, { method: 'PATCH', projectId, body }),
  }),

  defineTool({
    name: 'delete_category',
    title: 'Delete a category',
    description:
      'Posts filed under it are NOT deleted; they simply stop having a category. Its ' +
      'subcategories keep their path. Confirm with the person first.',
    input: { ...projectArg, id: z.string() },
    destructive: true,
    run: (client, { projectId, id }) =>
      client.request(`/v1/blog/categories/${segment(id)}`, { method: 'DELETE', projectId }),
  }),

  defineTool({
    name: 'list_tags',
    title: 'List tags',
    description: 'Tags in a project, with how many posts use each.',
    input: {
      ...projectArg,
      limit: z.number().int().min(1).max(100).optional(),
      cursor: z.string().optional(),
    },
    readOnly: true,
    run: (client, { projectId, ...query }) => client.request('/v1/blog/tags', { projectId, query }),
  }),

  defineTool({
    name: 'create_tag',
    title: 'Create a tag',
    description:
      'Usually unnecessary: create_post and update_post create tags they do not find. Use this ' +
      'when a tag needs a description, or to set one up before writing.',
    input: {
      ...projectArg,
      name: z.string().min(1).max(100),
      slug: z.string().max(100).optional(),
      description: z.string().max(500).optional(),
    },
    run: (client, { projectId, ...body }) =>
      client.request('/v1/blog/tags', { method: 'POST', projectId, body }),
  }),

  defineTool({
    name: 'list_authors',
    title: 'List authors',
    description: 'The bylines available in this project, with the ids create_post takes.',
    input: {
      ...projectArg,
      limit: z.number().int().min(1).max(100).optional(),
      cursor: z.string().optional(),
    },
    readOnly: true,
    run: (client, { projectId, ...query }) =>
      client.request('/v1/blog/authors', { projectId, query }),
  }),

  defineTool({
    name: 'create_author',
    title: 'Create an author',
    description:
      'A byline. This does NOT create an account or invite anybody — an author is content, and ' +
      'giving somebody access to the workspace is a separate thing a person does in the dashboard.',
    input: {
      ...projectArg,
      name: z.string().min(1).max(200),
      slug: z.string().max(200).optional(),
      email: z.string().max(320).optional(),
      bio: z.string().max(2000).optional(),
    },
    run: (client, { projectId, ...body }) =>
      client.request('/v1/blog/authors', { method: 'POST', projectId, body }),
  }),
] as const
