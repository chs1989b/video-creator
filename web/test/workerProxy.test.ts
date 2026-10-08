import { describe, expect, it } from 'vitest';
import { workerTarget, forwardRequestHeaders, forwardResponseHeaders } from '../lib/workerProxy';

describe('workerTarget', () => {
  it('maps the proxied path and query onto the worker', () => {
    expect(workerTarget('http://localhost:4000', ['jobs', 'abc', 'result'], '?x=1')).toBe('http://localhost:4000/jobs/abc/result?x=1');
    expect(workerTarget('http://localhost:4000/', ['jobs'], '')).toBe('http://localhost:4000/jobs');
  });

  it('refuses path tricks', () => {
    expect(workerTarget('http://localhost:4000', ['jobs', '..', 'config'], '')).toBeNull();
    expect(workerTarget('http://localhost:4000', ['jobs', 'a/b'], '')).toBe('http://localhost:4000/jobs/a%2Fb');
  });
});

describe('headers', () => {
  it('forwards body and range headers, sets the owner from the session and drops the rest', () => {
    const incoming = new Headers({
      'content-type': 'multipart/form-data; boundary=x', range: 'bytes=0-', cookie: 'vc_session=secret',
      'x-owner-id': 'someone-else', host: 'localhost:3000',
    });
    const out = forwardRequestHeaders(incoming, 'chris');
    expect(out.get('content-type')).toBe('multipart/form-data; boundary=x');
    expect(out.get('range')).toBe('bytes=0-');
    expect(out.get('x-owner-id')).toBe('chris');
    expect(out.get('cookie')).toBeNull();
    expect(out.get('host')).toBeNull();
  });

  it('passes back what a video player needs', () => {
    const res = forwardResponseHeaders(new Headers({
      'content-type': 'video/mp4', 'content-length': '10', 'content-range': 'bytes 0-9/100', 'accept-ranges': 'bytes',
      'x-powered-by': 'Express', 'access-control-allow-origin': '*',
    }));
    expect([...res.keys()].sort()).toEqual(['accept-ranges', 'content-length', 'content-range', 'content-type']);
  });
});
