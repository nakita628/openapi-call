import { text } from './value.js'

/** A path parameter in a template: `{id}`, without nested braces. */
const PARAM = /\{([^{}]+)\}/g

/**
 * The chain segments of a path template: `/users/{id}` is `users`, `:id`; `/` is `index`. A
 * segment that is more than one parameter (`{name}.json`, `{a}-{b}`) stays as written.
 */
export function chainOf(template: string): string[] {
  return template
    .replace(/^\//, '')
    .split('/')
    .map((segment) => (segment === '' ? 'index' : segment.replace(/^\{([^{}]+)\}$/, ':$1')))
}

/** A parameter's value as a path segment (encoded). */
function valueOf(param: Readonly<Record<string, unknown>> | undefined, name: string): string {
  return encodeURIComponent(text(param?.[name] ?? ''))
}

/**
 * The path of a call from its chain segments: `:id` and every `{name}` inside a segment filled in
 * (encoded), `index` for `/`.
 */
export function pathOf(segments: readonly string[], param: Readonly<Record<string, unknown>> | undefined): string {
  return segments
    .map((segment) =>
      segment === 'index'
        ? ''
        : segment.startsWith(':')
          ? valueOf(param, segment.slice(1))
          : segment.includes('{')
            ? segment.replace(PARAM, (_match, name: string) => valueOf(param, name))
            : segment,
    )
    .join('/')
}
