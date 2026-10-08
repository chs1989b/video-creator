import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword, signSession, verifySession } from '../lib/auth';
import { authenticate, type User } from '../lib/users';

describe('passwords', () => {
  it('verifies the right password and rejects others', async () => {
    const stored = await hashPassword('demo1234');
    expect(stored).toMatch(/^pbkdf2\$\d+\$[\w-]+\$[\w-]+$/);
    expect(await verifyPassword('demo1234', stored)).toBe(true);
    expect(await verifyPassword('demo12345', stored)).toBe(false);
    expect(await verifyPassword('demo1234', 'garbage')).toBe(false);
  });

  it('salts each hash', async () => {
    expect(await hashPassword('same')).not.toBe(await hashPassword('same'));
  });
});

describe('sessions', () => {
  const secret = 'test-secret';
  const now = 1_000_000;

  it('round-trips a signed session until it expires', async () => {
    const token = await signSession({ sub: 'chris', name: 'Chris', exp: now + 1000 }, secret);
    expect(await verifySession(token, secret, now)).toEqual({ sub: 'chris', name: 'Chris', exp: now + 1000 });
    expect(await verifySession(token, secret, now + 1001)).toBeNull();
  });

  it('rejects a tampered token, a wrong secret and junk', async () => {
    const token = await signSession({ sub: 'chris', name: 'Chris', exp: now + 1000 }, secret);
    const [body, sig] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ sub: 'juwon', name: 'J', exp: now + 1000 })).toString('base64url');
    expect(await verifySession(`${forged}.${sig}`, secret, now)).toBeNull();
    expect(await verifySession(`${body}.${sig}`, 'other-secret', now)).toBeNull();
    expect(await verifySession('nope', secret, now)).toBeNull();
    expect(await verifySession(undefined, secret, now)).toBeNull();
  });
});

describe('authenticate', () => {
  it('finds the user by case-insensitive username and checks the password', async () => {
    const users: User[] = [{ username: 'chris', name: 'Chris', passwordHash: await hashPassword('pw-chris') }];
    expect((await authenticate(users, ' Chris ', 'pw-chris'))?.username).toBe('chris');
    expect(await authenticate(users, 'chris', 'wrong')).toBeNull();
    expect(await authenticate(users, 'juwon', 'pw-chris')).toBeNull();
  });
});

import { hashPassword as scriptHash } from '../scripts/add-user.mjs';

it('the add-user script writes hashes the login accepts', async () => {
  expect(await verifyPassword('pw-juwon', await scriptHash('pw-juwon'))).toBe(true);
});
