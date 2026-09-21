import { keyTools } from './keys.js'
import { postTools } from './posts.js'
import { taxonomyTools } from './taxonomy.js'
import { workspaceTools } from './workspace.js'
import type { AnyTool } from './register.js'

/**
 * Every tool, in the order an assistant meeting a workspace for the first time
 * would want them: find out where you are, then what is here, then change it.
 *
 * Media is deliberately absent. Uploading goes to object storage through a
 * presigned URL, so it is two calls and a byte stream, and an assistant that
 * cannot see the file has nothing useful to send. When it is added it belongs
 * here as its own file.
 */
export const allTools = [
  ...workspaceTools,
  ...taxonomyTools,
  ...postTools,
  ...keyTools,
] as readonly AnyTool[]

export { registerTools } from './register.js'
