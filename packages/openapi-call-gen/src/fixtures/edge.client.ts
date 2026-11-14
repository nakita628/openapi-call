import { oc } from 'openapi-call'
import type { Client } from './edge.routes.js'

export const client: Client = oc('/')
