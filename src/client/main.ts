// Phase 0 client shell.
//
// PLAN.md calls for "a placeholder shell page". This is that, with one
// addition that earns its keep: a visible round-trip through the doorman into
// the session's Durable Object, so the Phase 0 gate ("DO storage survives
// across requests within a session") can be checked in a browser rather than
// only in a test.
//
// Phases 1–4 replace the shell section with the real three surfaces. The gate
// stays.

const el = <T extends HTMLElement>(id: string): T => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing element #${id}`);
  return node as T;
};

const gate = el('gate');
const gateForm = el<HTMLFormElement>('gate-form');
const gateError = el('gate-error');
const passphrase = el<HTMLInputElement>('passphrase');

const shell = el('shell');
const pingForm = el<HTMLFormElement>('ping-form');
const note = el<HTMLInputElement>('note');
const pingOutput = el('ping-output');

async function api(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`/api${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init.headers },
  });
}

function showGate(): void {
  gate.hidden = false;
  shell.hidden = true;
  passphrase.focus();
}

function showShell(): void {
  gate.hidden = true;
  shell.hidden = false;
  void readPing();
}

async function readPing(): Promise<void> {
  const response = await api('/ping');
  if (response.status === 401) return showGate();
  pingOutput.textContent = JSON.stringify(await response.json(), null, 2);
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
  showShell();
});

pingForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const response = await api('/ping', {
    method: 'POST',
    body: JSON.stringify({ note: note.value }),
  });
  if (response.status === 401) return showGate();
  pingOutput.textContent = JSON.stringify(await response.json(), null, 2);
});

el('reload').addEventListener('click', () => void readPing());

el('logout').addEventListener('click', async () => {
  await api('/logout', { method: 'POST' });
  pingOutput.textContent = 'not read yet';
  showGate();
});

// Decide which face to show before the user sees either.
async function start(): Promise<void> {
  const session = (await (await api('/session')).json()) as { authenticated: boolean };
  if (session.authenticated) showShell();
  else showGate();
}

void start();
