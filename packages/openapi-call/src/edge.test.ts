/** Edge cases of paths, response bodies and errors. */

import { describe, expect, expectTypeOf, it } from 'vite-plus/test'
import * as z from 'zod'

import { createRoute, DetailedError, oc, parseResponse } from './index.js'

/** A response; with `type` null it has no `Content-Type` (a string body would get `text/plain`). */
const json = (body: string, status = 200, type: string | null = 'application/json') =>
  type === null
    ? new Response(body === '' ? null : new TextEncoder().encode(body), { status })
    : new Response(body, { status, headers: { 'content-type': type } })

/** A `fetch` that records the URL and answers with `response()`. */
function recorder(response: () => Response = () => json('{}')) {
  const urls: string[] = []
  const fetch = (url: string, init: RequestInit) => {
    urls.push(`${init.method} ${url}`)
    return response()
  }
  return { urls, fetch }
}

describe('paths', () => {
  const fileRoute = createRoute({
    method: 'get',
    path: '/files/{name}.json',
    request: { params: z.object({ name: z.string() }) },
    responses: { 200: { description: 'OK' } },
  })
  const rangeRoute = createRoute({
    method: 'get',
    path: '/range/{from}-{to}',
    request: { params: z.object({ from: z.string(), to: z.string() }) },
    responses: { 200: { description: 'OK' } },
  })
  const routes = { fileRoute, rangeRoute }

  it('fills a parameter that is part of a segment', async () => {
    const { urls, fetch } = recorder()
    const client = oc(routes, 'http://localhost', { fetch })
    await client['files']['{name}.json'].$get({ param: { name: 'a b' } })
    expect(urls).toEqual(['GET http://localhost/files/a%20b.json'])
  })

  it('fills several parameters of one segment', async () => {
    const { urls, fetch } = recorder()
    const client = oc(routes, 'http://localhost', { fetch })
    await client['range']['{from}-{to}'].$get({ param: { from: '1', to: '9' } })
    expect(urls).toEqual(['GET http://localhost/range/1-9'])
    expect(client['range']['{from}-{to}'].$path({ param: { from: '1', to: '9' } })).toBe('/range/1-9')
  })

  it('keys such segments as written', () => {
    type Keys = keyof ReturnType<typeof oc<typeof routes>>['range']
    expectTypeOf<Keys>().toEqualTypeOf<'{from}-{to}'>()
  })
})

describe('$url()', () => {
  const route = createRoute({ method: 'get', path: '/todos', responses: { 200: { description: 'OK' } } })

  it('resolves a relative base URL against the location', () => {
    const globals = globalThis as { location?: { href: string } }
    globals.location = { href: 'https://example.com/app/' }
    try {
      expect(oc({ route }, '/').todos.$url().href).toBe('https://example.com/todos')
      expect(oc({ route }, '/api').todos.$url().href).toBe('https://example.com/api/todos')
    } finally {
      delete globals.location
    }
  })

  it('says why a relative base URL fails without a location', () => {
    expect(() => oc({ route }, '/').todos.$url()).toThrow(/absolute base URL/)
  })
})

describe('response bodies', () => {
  const Item = z.object({ id: z.string() })
  const updateRoute = createRoute({
    method: 'put',
    path: '/items',
    responses: { default: { description: 'Item', content: { 'application/json': { schema: Item } } } },
  })
  const headRoute = createRoute({
    method: 'head',
    path: '/items',
    responses: { 200: { description: 'Item', content: { 'application/json': { schema: Item } } } },
  })
  const exportRoute = createRoute({
    method: 'get',
    path: '/export',
    responses: {
      200: {
        description: 'Items',
        content: { 'application/json': { schema: z.array(Item) }, 'text/csv': { schema: z.string() } },
      },
    },
  })
  const routes = { updateRoute, headRoute, exportRoute }

  it('accepts 204 for a JSON response declared by `default`', async () => {
    const client = oc(routes, 'http://localhost', { fetch: () => new Response(null, { status: 204 }) })
    expect((await client.items.$put()).status).toBe(204)
  })

  it('accepts an empty untyped body', async () => {
    const client = oc(routes, 'http://localhost', { fetch: () => json('', 200, null) })
    expect((await client.items.$put()).status).toBe(200)
  })

  it('accepts a HEAD response, which has no body', async () => {
    const client = oc(routes, 'http://localhost', {
      fetch: () => new Response(null, { status: 200, headers: { 'content-type': 'application/json' } }),
    })
    expect((await client.items.$head()).status).toBe(200)
  })

  it('accepts another media type the route declares', async () => {
    const client = oc(routes, 'http://localhost', { fetch: () => json('id\na', 200, 'text/csv; charset=utf-8') })
    const res = await client.export.$get()
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('id\na')
  })

  it('still rejects an undeclared media type, keeping the body readable', async () => {
    const client = oc(routes, 'http://localhost', { fetch: () => json('<p>hi</p>', 200, 'text/html') })
    expect((await client.export.$get()).status).toBe(502)
    const untyped = oc(routes, 'http://localhost', { fetch: () => json('oops', 200, null) })
    expect((await untyped.items.$put()).status).toBe(502)
  })
})

describe('bodies that are not JSON', () => {
  const route = createRoute({
    method: 'get',
    path: '/thing',
    operationId: 'getThing',
    responses: { 200: { description: 'OK' }, 500: { description: 'Error' } },
  })

  it('keeps a failed response’s body as text in its DetailedError', async () => {
    const client = oc({ route }, 'http://localhost', { fetch: () => json('<html>oops</html>', 500) })
    const error = await client.getThing().catch((error: unknown) => error)
    expect(error).toBeInstanceOf(DetailedError)
    expect(error).toMatchObject({ statusCode: 500, alias: 'getThing', detail: { data: '<html>oops</html>' } })
  })

  it('throws DetailedError for a successful response that is not JSON', async () => {
    const client = oc({ route }, 'http://localhost', { fetch: () => json('{"trunc', 200) })
    const error = await client.getThing().catch((error: unknown) => error)
    expect(error).toBeInstanceOf(DetailedError)
    expect(error).toMatchObject({ statusCode: 200, alias: 'getThing' })
  })

  it('parseResponse reads an empty JSON body as undefined', async () => {
    expect(await parseResponse(json('', 202))).toBeUndefined()
  })

  it('parseResponse keeps the status of a failed response that is not JSON', async () => {
    const error = await parseResponse(json('Bad Gateway', 502)).catch((error: unknown) => error)
    expect(error).toMatchObject({ statusCode: 502, detail: { data: 'Bad Gateway' } })
  })
})
