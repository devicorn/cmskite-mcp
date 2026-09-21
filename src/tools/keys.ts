import { z } from 'zod'
import { segment } from '../client.js'
import { defineTool } from './register.js'

/**
 * The credential a website actually ships with.
 *
 * An assistant could create the project, write every post and wire up the
 * frontend, and then had to stop and ask a person to open the dashboard and
 * mint the one key the site needed. Until they did, the working credential was
 * the agent token itself -- which can write and delete content. The path of
 * least resistance was therefore to put a destructive credential in a
 * production environment, which is exactly backwards.
 *
 * A project key is strictly weaker than the token creating it: one project,
 * read-only, published content only, and it cannot revoke anything. Nothing is
 * being escalated here; something safe is being made easy.
 */
export const keyTools = [
  defineTool({
    name: 'list_api_keys',
    title: 'List a project’s API keys',
    description:
      'The read-only keys a website uses to read this project. Names, creation dates and the ' +
      'last four characters only — a whole key is shown once, when it is created, and never ' +
      'again. Requires the apikey.read grant.',
    input: { projectId: z.string().describe('The project id, as `prj_...`.') },
    readOnly: true,
    run: (client, args) => client.request(`/v1/projects/${segment(args.projectId)}/api-keys`),
  }),

  defineTool({
    name: 'create_api_key',
    title: 'Create a read-only API key',
    description:
      'Mints the credential a website reads this project with. ' +
      'IMPORTANT: the response carries the whole key exactly once. Show it to the person and ' +
      'tell them to put it in their environment — it cannot be retrieved afterwards. ' +
      'The key is read-only and returns published content only, so it is safe in a server ' +
      'environment; it is NOT safe in browser code unless the project has an allowed-origins ' +
      'list configured. Prefer this over handing a site the agent token, which can write and ' +
      'delete. Requires the apikey.write grant.',
    input: {
      projectId: z.string().describe('The project id, as `prj_...`.'),
      name: z
        .string()
        .min(1)
        .max(120)
        .describe('What this key is for, so a list of them is readable a year later.'),
    },
    run: (client, args) =>
      client.request(`/v1/projects/${segment(args.projectId)}/api-keys`, {
        method: 'POST',
        body: { name: args.name },
      }),
  }),
] as const
