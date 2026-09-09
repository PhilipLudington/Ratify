// The client's URL grammar, and nothing else.
//
// Hash routing keeps a static Pages deployment free of rewrite rules while
// leaving a record's URL something you can send someone. `recordHref` and
// `parseHash` are inverses, and they live together so they cannot drift apart.
//
// The accepted number form is deliberately the Durable Object's: the same
// `^[1-9]\d*$` that `LogDO.readRecord` applies before it touches storage. A
// hash the client accepts but the server refuses would put an error page
// behind a link the client itself wrote.

/** The route that shows one record. */
export function recordHref(number: number): string {
  return `#/adr/${number}`;
}

/**
 * The record a hash asks for, or `null` for the log. Everything that is not
 * exactly `#/adr/{canonical positive integer}` is the log: `#/`, the empty
 * hash a fresh page load carries, a trailing slash, `#/adr/0`, `#/adr/03`.
 */
export function parseHash(hash: string): number | null {
  const match = /^#\/adr\/([1-9]\d*)$/.exec(hash);
  return match === null ? null : Number(match[1]);
}
