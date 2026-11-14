import { oc } from 'openapi-call'
import { routes } from './edge.aliases.routes.js'
import type { Client } from './edge.aliases.routes.js'

export const client: Client = oc(routes, '/')
