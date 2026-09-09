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

async function api(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`/api${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init.headers },
  });
}

function showGate(): void {
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

async function showRecord(number: number, entries: Index): Promise<void> {
  const response = await api(`/record/${number}`);
  if (response.status === 401) throw new NotAuthenticated();

  gate.hidden = true;
  logPanel.hidden = true;
  recordPanel.hidden = false;

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    renderMessage(recordBody, body.error ?? 'That record could not be read.');
    return;
  }

  // parseRecord is fail-loud by design: text that is not a canonical record is
  // an error to surface, never something to render half of.
  renderRecord(recordBody, parseRecord(await response.text()), entries);
}

/** `#/adr/3` shows one record; everything else is the log. */
function routedRecord(): number | null {
  const match = /^#\/adr\/([1-9]\d*)$/.exec(window.location.hash);
  return match === null ? null : Number(match[1]);
}

async function route(): Promise<void> {
  try {
    const entries = await fetchIndex();
    const number = routedRecord();
    if (number === null) showIndex(entries);
    else await showRecord(number, entries);
  } catch (error) {
    if (error instanceof NotAuthenticated) return showGate();

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
