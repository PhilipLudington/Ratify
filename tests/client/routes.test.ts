// The client's URL grammar.
//
// This is the half of the client that needs no DOM at all, and the half that
// has to agree with the server: `parseHash` accepts exactly what
// `LogDO.readRecord` accepts (`^[1-9]\d*$`), so the client never writes a link
// it will then be refused for following.

import { describe, expect, it } from 'vitest';

import { parseHash, recordHref } from '../../src/client/routes';

describe('parseHash', () => {
  it('reads the record out of a record route', () => {
    expect(parseHash('#/adr/3')).toBe(3);
    expect(parseHash('#/adr/42')).toBe(42);
  });

  it('treats the log route and a bare load as the log', () => {
    expect(parseHash('#/')).toBeNull();
    expect(parseHash('')).toBeNull();
    expect(parseHash('#')).toBeNull();
  });

  // The same shapes LogDO refuses with a 400. Accepting any of them here
  // would render an error page for a link the client itself produced.
  it('refuses every non-canonical record number', () => {
    for (const hash of [
      '#/adr/0',
      '#/adr/03',
      '#/adr/-1',
      '#/adr/3.5',
      '#/adr/abc',
      '#/adr/+1',
      '#/adr/1e3',
      '#/adr/',
    ]) {
      expect({ hash, parsed: parseHash(hash) }).toEqual({ hash, parsed: null });
    }
  });

  it('refuses a route with anything after the number', () => {
    expect(parseHash('#/adr/3/')).toBeNull();
    expect(parseHash('#/adr/3/objections')).toBeNull();
    expect(parseHash('#/adr/3?x=1')).toBeNull();
  });

  it('refuses a route that only starts the same way', () => {
    expect(parseHash('#/adrs/3')).toBeNull();
    expect(parseHash('/adr/3')).toBeNull();
    expect(parseHash('#adr/3')).toBeNull();
  });
});

describe('recordHref', () => {
  it('is the inverse of parseHash', () => {
    for (const number of [1, 2, 6, 7, 99, 1000]) {
      expect(parseHash(recordHref(number))).toBe(number);
    }
  });
});
