// Session cookies for the doorman.
//
// The session ID is the whole identity model (DESIGN.md, Access & Sessions):
// no accounts, no registry. The random ID *is* the sandbox Durable Object's
// address, so it must be unguessable and it must be tamper-proof — a visitor
// who could forge a session ID could address someone else's log. Hence the
// HMAC signature: the cookie carries `<sid>.<sig>` and an unsigned or
// badly-signed cookie is treated as no cookie at all.

export const COOKIE_NAME = 'ratify_session';

// Matches the sandbox idle-expiry window in DESIGN.md (Lifecycle).
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

const SESSION_ID_PATTERN = /^[0-9a-f]{32}$/;

const encoder = new TextEncoder();

/** A fresh 128-bit session ID, rendered as 32 lowercase hex characters. */
export function newSessionId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
}

function toBase64Url(buffer: ArrayBuffer): string {
  let binary = '';
  for (const byte of new Uint8Array(buffer)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Compare without leaking match position through timing. */
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Produce the signed cookie value `<sid>.<base64url-hmac>`. */
export async function signSession(sessionId: string, secret: string): Promise<string> {
  const signature = await crypto.subtle.sign(
    'HMAC',
    await hmacKey(secret),
    encoder.encode(sessionId),
  );
  return `${sessionId}.${toBase64Url(signature)}`;
}

/**
 * Recover the session ID from a signed cookie value, or null if the token is
 * malformed, mis-signed, or carries an ID we would never have issued.
 */
export async function verifySession(token: string, secret: string): Promise<string | null> {
  const separator = token.lastIndexOf('.');
  if (separator <= 0) return null;

  const sessionId = token.slice(0, separator);
  if (!SESSION_ID_PATTERN.test(sessionId)) return null;

  const expected = await signSession(sessionId, secret);
  return constantTimeEqual(token, expected) ? sessionId : null;
}

/** Read the raw (still unverified) session token off a request. */
export function readSessionCookie(request: Request): string | null {
  const header = request.headers.get('Cookie');
  if (!header) return null;

  for (const pair of header.split(';')) {
    const separator = pair.indexOf('=');
    if (separator < 0) continue;
    if (pair.slice(0, separator).trim() !== COOKIE_NAME) continue;
    return pair.slice(separator + 1).trim() || null;
  }
  return null;
}

export function serializeSessionCookie(token: string): string {
  return [
    `${COOKIE_NAME}=${token}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    `Max-Age=${COOKIE_MAX_AGE_SECONDS}`,
  ].join('; ');
}

export function clearSessionCookie(): string {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}
