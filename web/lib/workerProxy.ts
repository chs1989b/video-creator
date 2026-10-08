// The browser never talks to the worker directly: /api/worker/* forwards each
// request with the signed-in user as x-owner-id, so the worker shows each demo
// user only their own jobs.

/** Worker URL for a proxied path, or null when a segment tries to climb out. */
export function workerTarget(base: string, segments: string[], search: string): string | null {
  if (segments.some((s) => s === '..' || s === '.' || s === '')) return null;
  return `${base.replace(/\/+$/, '')}/${segments.map(encodeURIComponent).join('/')}${search}`;
}

const REQUEST_HEADERS = ['content-type', 'content-length', 'range', 'accept'];
const RESPONSE_HEADERS = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'content-disposition'];

function pick(from: Headers, names: string[]): Headers {
  const out = new Headers();
  for (const name of names) {
    const value = from.get(name);
    if (value !== null) out.set(name, value);
  }
  return out;
}

/** Only what the worker needs; the owner always comes from the session, never from the browser. */
export function forwardRequestHeaders(incoming: Headers, owner: string): Headers {
  const out = pick(incoming, REQUEST_HEADERS);
  out.set('x-owner-id', owner);
  return out;
}

export function forwardResponseHeaders(incoming: Headers): Headers {
  return pick(incoming, RESPONSE_HEADERS);
}
