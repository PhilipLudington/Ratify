// The client shell: the gate, and the log view behind it.
//
// Phase 0's round-trip panel is gone — the thing it stood in for now exists.
// The `/api/ping` route it exercised stays on the Durable Object, because
// `scripts/verify-gate.sh` still uses it to prove the chain in production.
//
// Routing is by hash (`#/`, `#/adr/3`): a static Pages deployment then needs
// no rewrite rule, and a record's URL is still something you can send someone.
// The chat pane and the visible draft arrive in Phase 2 alongside this view.

import { parseRecord } from '../shared/format';
import type { Index } from '../shared/record';
import { renderIndex, renderMessage, renderRecord } from './log-view';
import { parseHash } from './routes';

const el = <T extends HTMLElement>(id: string): T => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing element #${id}`);
  return node as T;
};

const gate = el('gate');
const gateForm = el<HTMLFormElement>('gate-form');
const gateError = el('gate-error');
const passphrase = el<HTMLInputElement>('passphrase');

const logPanel = el('log');
const logIndex = el('log-index');
const logEmpty = el('log-empty');
const recordPanel = el('record');
const recordBody = el('record-body');

/** The index, fetched once per session and reused by both views. */
let index: Index | null = null;

/**
 * Which navigation is the live one. A response that arrives after the reader
 * has moved on must not paint over the newer view: the URL and the screen
 * would disagree, and the way back may be a link to a hash that is already
 * current — which fires no `hashchange`, so nothing would re-route and the
 * view would stay wrong until a reload.
 *
 * Every path that decides what is on screen advances this, `showGate`
 * included: logging out is a navigation like any other, and a record fetch
 * still in flight when the session ends must not land on top of the gate.
 */
let generation = 0;

async function api(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`/api${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init.headers },
  });
}

function showGate(): void {
  generation += 1;
  index = null;
  gate.hidden = false;
  logPanel.hidden = true;
  recordPanel.hidden = true;
  passphrase.focus();
}

/** Thrown when a request comes back unauthenticated; the gate is the answer. */
class NotAuthenticated extends Error {}

async function fetchIndex(): Promise<Index> {
  if (index !== null) return index;

  const response = await api('/log');
  if (response.status === 401) throw new NotAuthenticated();
  if (!response.ok) throw new Error('The log could not be read.');

  const body = (await response.json()) as { index: Index };
  index = body.index;
  return index;
}

function showIndex(entries: Index): void {
  renderIndex(logIndex, entries);
  logEmpty.hidden = entries.length > 0;
  recordPanel.hidden = true;
  gate.hidden = true;
  logPanel.hidden = false;
}

async function showRecord(
  number: number,
  entries: Index,
  current: () => boolean,
): Promise<void> {
  const response = await api(`/record/${number}`);
  if (response.status === 401) throw new NotAuthenticated();

  // Read the whole body before touching the DOM. Every await is another
  // chance for the reader to navigate away, and a view applied halfway is
  // worse than one applied late. parseRecord is fail-loud by design: text
  // that is not a canonical record throws to `route`, never renders in part.
  let render: () => void;
  if (response.ok) {
    const record = parseRecord(await response.text());
    render = () => renderRecord(recordBody, record, entries);
  } else {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    const message = body.error ?? 'That record could not be read.';
    render = () => renderMessage(recordBody, message);
  }

  if (!current()) return;

  gate.hidden = true;
  logPanel.hidden = true;
  recordPanel.hidden = false;
  render();
}

async function route(): Promise<void> {
  const mine = ++generation;
  const current = (): boolean => mine === generation;

  try {
    const entries = await fetchIndex();
    if (!current()) return;

    const number = parseHash(window.location.hash);
    if (number === null) showIndex(entries);
    else await showRecord(number, entries, current);
  } catch (error) {
    // A 401 is answered whatever the generation: the session is gone, and
    // every later request would reach the same conclusion.
    if (error instanceof NotAuthenticated) return showGate();
    if (!current()) return;

    gate.hidden = true;
    logPanel.hidden = true;
    recordPanel.hidden = false;
    renderMessage(recordBody, error instanceof Error ? error.message : String(error));
  }
}

gateForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  gateError.hidden = true;

  const response = await api('/auth', {
    method: 'POST',
    body: JSON.stringify({ passphrase: passphrase.value }),
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    gateError.textContent = body.error ?? 'Could not verify that passphrase.';
    gateError.hidden = false;
    passphrase.select();
    return;
  }

  passphrase.value = '';
  await route();
});

el('logout').addEventListener('click', async () => {
  await api('/logout', { method: 'POST' });
  showGate();
});

window.addEventListener('hashchange', () => void route());

// Decide which face to show before the user sees either.
async function start(): Promise<void> {
  const session = (await (await api('/session')).json()) as { authenticated: boolean };
  if (session.authenticated) await route();
  else showGate();
}

void start();
