// The doorman.
//
// DESIGN.md, System Topology: "stateless request handler. Checks the
// passphrase gate, issues/validates the session cookie, derives the Durable
// Object address from the session, and forwards requests. Holds no state and
// makes no decisions."
//
// Everything that constitutes a decision — storage, numbering, the agent, the
// precedent check — belongs to LogDO. If logic starts accumulating here, it is
// in the wrong file.

import {
  clearSessionCookie,
  constantTimeEqual,
  newSessionId,
  readSessionCookie,
  serializeSessionCookie,
  signSession,
  verifySession,
} from './session';

export interface DoormanEnv {
  LOG: DurableObjectNamespace;
  /** Shared secret for the demo gate. Travels in submission notes, never in git. */
  DEMO_PASSPHRASE: string;
  /** HMAC key for session cookies. */
  SESSION_SECRET: string;

  // Injected by Pages into every Function. Public build metadata, not secrets.
  CF_PAGES_URL?: string;
  CF_PAGES_COMMIT_SHA?: string;
  CF_PAGES_BRANCH?: string;
}

/**
 * Durable Object hostname for forwarded requests. Never resolved over the
 * network — the DO stub intercepts — but URLs must still parse, so it needs
 * to look like one.
 */
const DO_ORIGIN = 'https://log.ratify.internal';

function json(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify(body), { ...init, headers });
}

/**
 * Address the sandbox log for a session. The namespace prefix keeps session
 * sandboxes from ever colliding with the owner's named logs (`log:phil-main`),
 * which are addressed by a stable name rather than a session ID.
 */
function sandboxStub(env: DoormanEnv, sessionId: string): DurableObjectStub {
  return env.LOG.get(env.LOG.idFromName(`sandbox:${sessionId}`));
}

/** The verified session ID on this request, or null if there isn't one. */
async function currentSession(request: Request, env: DoormanEnv): Promise<string | null> {
  const token = readSessionCookie(request);
  return token ? verifySession(token, env.SESSION_SECRET) : null;
}

async function handleAuth(request: Request, env: DoormanEnv): Promise<Response> {
  let submitted = '';
  try {
    const body = (await request.json()) as { passphrase?: unknown };
    if (typeof body.passphrase === 'string') submitted = body.passphrase;
  } catch {
    return json({ error: 'Expected a JSON body.' }, { status: 400 });
  }

  // Both sides are trimmed before comparison. A passphrase whose meaning
  // depends on a leading or trailing space is a passphrase nobody can type
  // reliably, and the ways one arrives are many: a newline captured by an
  // interactive `wrangler secret put` prompt, a space picked up copying the
  // value out of submission notes. Trimming costs nothing real and removes a
  // failure that is indistinguishable from a wrong passphrase at the door.
  if (!submitted.trim() || !constantTimeEqual(submitted.trim(), env.DEMO_PASSPHRASE.trim())) {
    // Deliberately uniform: no distinction between empty and wrong.
    return json({ error: 'That passphrase is not recognised.' }, { status: 401 });
  }

  const token = await signSession(newSessionId(), env.SESSION_SECRET);
  return json({ authenticated: true }, { headers: { 'Set-Cookie': serializeSessionCookie(token) } });
}

/**
 * Hand a request to this session's log. `/api/log` arrives at the DO as
 * `/log`; the DO never sees the `/api` prefix or the public hostname.
 */
async function forwardToLog(
  request: Request,
  env: DoormanEnv,
  sessionId: string,
  path: string,
  search: string,
): Promise<Response> {
  const forwarded = new Request(`${DO_ORIGIN}${path}${search}`, request);
  forwarded.headers.set('X-Ratify-Session', sessionId);
  return sandboxStub(env, sessionId).fetch(forwarded);
}

export async function handleRequest(request: Request, env: DoormanEnv): Promise<Response> {
  // A missing secret must fail loudly rather than quietly opening the gate.
  // The response names which secrets are absent but never their values: the
  // names are already public in this repository, and a deploy that silently
  // refuses every request without saying why costs far more than it protects.
  const missing = (['DEMO_PASSPHRASE', 'SESSION_SECRET'] as const).filter(
    (name) => !env[name]?.trim(),
  );
  if (missing.length > 0) {
    return json(
      { error: 'Server is not configured.', missing },
      { status: 500 },
    );
  }

  const url = new URL(request.url);
  const path = url.pathname.startsWith('/api') ? url.pathname.slice(4) || '/' : url.pathname;

  // Which build is actually serving this request. Answered before the config
  // check, so it still works on a deployment that is refusing everything else,
  // and ungated, because it reveals nothing a public repository does not.
  // A hostname alias can point at an older deployment than the one just
  // pushed, which otherwise looks exactly like a wrong passphrase.
  if (path === '/version' && request.method === 'GET') {
    return json({
      deployment: env.CF_PAGES_URL ?? null,
      commit: env.CF_PAGES_COMMIT_SHA ?? null,
      branch: env.CF_PAGES_BRANCH ?? null,
      secretsPresent: {
        DEMO_PASSPHRASE: Boolean(env.DEMO_PASSPHRASE),
        SESSION_SECRET: Boolean(env.SESSION_SECRET),
      },
    });
  }

  if (path === '/auth' && request.method === 'POST') {
    return handleAuth(request, env);
  }

  if (path === '/logout' && request.method === 'POST') {
    return json({ authenticated: false }, { headers: { 'Set-Cookie': clearSessionCookie() } });
  }

  const sessionId = await currentSession(request, env);

  // Whether a session exists is not itself gated — the client asks this on
  // load to decide between the passphrase form and the app.
  if (path === '/session' && request.method === 'GET') {
    return json({ authenticated: sessionId !== null });
  }

  if (sessionId === null) {
    return json({ error: 'Not authenticated.' }, { status: 401 });
  }

  return forwardToLog(request, env, sessionId, path, url.search);
}
