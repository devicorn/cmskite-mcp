import { versionReport } from '../version.js'
import { z } from 'zod'
import { segment } from '../client.js'
import { defineTool } from './register.js'

/**
 * Workspaces and projects: the shape of the account, before any content.
 *
 * A workspace is the company and carries the billing and the membership. A
 * project is one website inside it. Almost every content tool needs a project
 * id, which is why `list_projects` is the tool an assistant should reach for
 * first in an unfamiliar workspace.
 */
export const workspaceTools = [
  defineTool({
    name: 'whoami',
    title: 'Who this token is',
    description:
      'The account this token acts as and the workspaces it can see. Call this first in a new ' +
      'conversation: it confirms the token works and names the workspace everything else happens in. ' +
      '`agentGrants` is what THIS TOKEN may do; `permissions` is what its owner may do. A tool ' +
      'works only when both allow it, so read `agentGrants` to know which tools will succeed. ' +
      '`mcp` says which version of this server is running and whether it is out of date; if ' +
      '`mcp.outdated` is true, tell the person before reporting any bug, because it may already be fixed.',
    input: {},
    readOnly: true,
    run: async (client) => {
      const [me, mcp] = await Promise.all([client.request<Record<string, unknown>>('/v1/auth/me'), versionReport()])
      return { ...me, mcp }
    },
  }),

  defineTool({
    name: 'create_workspace',
    title: 'Create a workspace',
    description:
      'Creates a workspace with a first project, owned by this token\'s account. ' +
      'IMPORTANT: the response carries `agentToken`, a NEW token for the new workspace — this ' +
      'token cannot act in it. Show that value to the person and tell them to save it; it is ' +
      'returned once and cannot be retrieved again. Requires the workspace.create grant.',
    input: {
      name: z.string().min(1).max(200).describe('What the company or site is called.'),
    },
    run: (client, args) =>
      client.request('/v1/workspaces', { method: 'POST', body: { name: args.name } }),
  }),

  defineTool({
    name: 'list_projects',
    title: 'List projects',
    description:
      'Every project in this token\'s workspace, with the `prj_...` ids the content tools take.',
    input: {},
    readOnly: true,
    run: (client) => client.request('/v1/projects'),
  }),

  defineTool({
    name: 'get_project',
    title: 'Get a project',
    description: 'One project: what it is, which site it serves, and its settings.',
    input: { projectId: z.string().describe('The project id, as `prj_...`.') },
    readOnly: true,
    run: (client, args) => client.request(`/v1/projects/${segment(args.projectId)}`),
  }),

  defineTool({
    name: 'create_project',
    title: 'Create a project',
    description:
      'A new site inside this workspace. Requires the project.write grant. ' +
      'The description and website fields are what make a list of projects readable later.',
    input: {
      name: z.string().min(1).max(200),
      slug: z.string().max(100).optional().describe('Derived from the name when omitted.'),
      description: z.string().max(500).optional(),
      websiteName: z.string().max(200).optional(),
      websiteUrl: z.string().max(300).optional().describe('Display only. Not a CORS allowance.'),
    },
    run: (client, args) => client.request('/v1/projects', { method: 'POST', body: args }),
  }),

  defineTool({
    name: 'update_project',
    title: 'Update a project',
    description:
      'Change a project\'s name, description, website, or allowed origins. Only the fields ' +
      'passed change. `allowedOrigins` REPLACES the list: pass every origin, like ' +
      '["https://example.com", "https://www.example.com"] — scheme and host, no path. It decides ' +
      'which websites may use the project key from a browser. Requires the project.write grant.',
    input: {
      projectId: z.string().describe('The project id, as `prj_...`.'),
      name: z.string().min(1).max(200).optional(),
      description: z.string().max(500).nullable().optional(),
      websiteName: z.string().max(200).nullable().optional(),
      websiteUrl: z.string().max(300).nullable().optional().describe('Display only. Not a CORS allowance.'),
      allowedOrigins: z.array(z.string()).max(20).optional().describe('The complete list. [] removes the restriction.'),
    },
    run: (client, { projectId, ...body }) =>
      client.request(`/v1/projects/${segment(projectId)}`, { method: 'PATCH', body }),
  }),

  defineTool({
    name: 'get_project_summary',
    title: 'Project summary',
    description:
      'Content counts, key count, database mode and recent traffic for one project, in one call. ' +
      'Use this rather than listing everything to answer "what is in here".',
    input: { projectId: z.string().describe('The project id, as `prj_...`.') },
    readOnly: true,
    run: (client, args) => client.request(`/v1/projects/${segment(args.projectId)}/summary`),
  }),
] as const
