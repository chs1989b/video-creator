// Demo login primitives on Web Crypto only, so the same code runs in the
// Next.js middleware (edge runtime) and in route handlers (Node).

export const SESSION_COOKIE = 'vc_session';
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

export type Session = { sub: string; name: string; exp: number };

const ITERATIONS = 100_000;
const enc = new TextEncoder();
const dec = new TextDecoder();

function toB64url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(text: string): Uint8Array<ArrayBuffer> {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function pbkdf2(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
  return new Uint8Array(bits);
}

/** `pbkdf2$<iterations>$<salt>$<hash>`, all base64url. */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${ITERATIONS}$${toB64url(salt)}$${toB64url(await pbkdf2(password, salt, ITERATIONS))}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, iter, salt, hash] = stored.split('$');
  const iterations = Number(iter);
  if (scheme !== 'pbkdf2' || !Number.isInteger(iterations) || !salt || !hash) return false;
  return sameBytes(await pbkdf2(password, fromB64url(salt), iterations), fromB64url(hash));
}

async function hmac(secret: string, data: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
}

/** `<payload>.<signature>`: readable by anyone, unforgeable without the secret. */
export async function signSession(session: Session, secret: string): Promise<string> {
  const body = toB64url(enc.encode(JSON.stringify(session)));
  return `${body}.${toB64url(await hmac(secret, body))}`;
}

export async function verifySession(token: string | undefined, secret: string, now = Date.now()): Promise<Session | null> {
  if (!token) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  try {
    if (!sameBytes(await hmac(secret, body), fromB64url(sig))) return null;
    const session = JSON.parse(dec.decode(fromB64url(body))) as Session;
    if (typeof session.sub !== 'string' || typeof session.exp !== 'number' || session.exp < now) return null;
    return session;
  } catch {
    return null;
  }
}

const DEV_SECRET = 'video-creator-dev-only-secret';

/**
 * AUTH_SECRET from web/.env.local. Without it, development falls back to a
 * fixed, public value (the middleware and the route handlers run in separate
 * runtimes, so a random per-process value would not match between them).
 */
export function authSecret(): string {
  const configured = process.env.AUTH_SECRET;
  if (configured) return configured;
  if (process.env.NODE_ENV === 'production') throw new Error('AUTH_SECRET is not set');
  return DEV_SECRET;
}
