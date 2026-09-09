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
const back = el<HTMLAnchorElement>('back');

/** The index, fetched once per session and reused by both views. */
let index: Index | null = null;

/**
 * Which navigation is the live one. A response that arrives after the reader
 * has moved on must not paint over the newer view: the URL and the screen
 * would then disagree, and nothing on the screen would say which one is
 * wrong. (The back link recovers such a screen — see its listener below —
 * but a reader with no reason to distrust the view would not click it.)
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

/**
 * A plain message where the view would have been. Every failure lands here:
 * a blank screen tells the reader nothing and offers nothing, and the panels
 * all ship `hidden`, so nothing renders unless something says so.
 *
 * This is a navigation like any other — it advances the generation, so a
 * response still in flight cannot paint over the message that replaced it.
 */
function showMessage(message: string): void {
  generation += 1;
  gate.hidden = true;
  logPanel.hidden = true;
  recordPanel.hidden = false;
  renderMessage(recordBody, message);
}

/** The server's own words for a failed response, or a plain fallback. */
async function failureMessage(response: Response, fallback: string): Promise<string> {
  const body = (await response.json().catch(() => ({}))) as { error?: string };
  return body.error ?? fallback;
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
    const message = await failureMessage(response, 'That record could not be read.');
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
    // The generation is checked before the error is read, a 401 included. A
    // refusal only describes the session the request was sent under, and a
    // logout-and-login round trip can finish while a record fetch is still in
    // flight: answering that stale 401 would paint the gate over a session
    // the server has just agreed to. Whether the *live* session is gone is
    // the live request's to report, and it will.
    if (!current()) return;
    if (error instanceof NotAuthenticated) return showGate();

    showMessage(error instanceof Error ? error.message : String(error));
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
    gateError.textContent = await failureMessage(response, 'Could not verify that passphrase.');
    gateError.hidden = false;
    passphrase.select();
    return;
  }

  passphrase.value = '';
  await route();
});

el('logout').addEventListener('click', async () => {
  // The cookie is the server's to clear, so a logout the server never heard
  // has ended nothing. Showing the gate would say that it had.
  try {
    const response = await api('/logout', { method: 'POST' });
    if (!response.ok) {
      return showMessage(await failureMessage(response, 'This session could not be ended.'));
    }
  } catch {
    return showMessage('This session could not be ended. Check your connection and try again.');
  }

  showGate();
});

// The back link is the only control a message screen leaves on the page — the
// log panel, and the logout button in it, are hidden behind the message. Its
// `href` fires no `hashchange` when the hash is already the log, so a message
// rendered there would offer nothing but a reload. Route on the click itself.
back.addEventListener('click', () => {
  if (window.location.hash === back.hash) void route();
});

window.addEventListener('hashchange', () => void route());

// Decide which face to show before the user sees either. Nothing has been
// painted yet at this point, so a failure here is the one that costs the most:
// it must say something rather than leave the masthead over an empty page.
async function start(): Promise<void> {
  const unreachable = 'Ratify could not be reached. Check your connection and reload.';

  try {
    const response = await api('/session');
    if (!response.ok) return showMessage(await failureMessage(response, unreachable));

    const session = (await response.json()) as { authenticated: boolean };
    if (session.authenticated) await route();
    else showGate();
  } catch {
    // Whatever the browser calls a failed fetch, the reader needs the plain
    // version: the server is not answering, and reloading is the way back.
    showMessage(unreachable);
  }
}

void start();
