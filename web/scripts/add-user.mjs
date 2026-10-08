#!/usr/bin/env node
// Add or update a demo account in web/data/users.json (not committed).
//   node scripts/add-user.mjs <username> "<display name>" <password>
// Hash format matches lib/auth.ts verifyPassword: pbkdf2$<iterations>$<salt>$<hash>.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ITERATIONS = 100_000;
const b64url = (bytes) => Buffer.from(bytes).toString('base64url');

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITERATIONS }, key, 256);
  return `pbkdf2$${ITERATIONS}$${b64url(salt)}$${b64url(new Uint8Array(bits))}`;
}

async function main() {
  const [username, name, password] = process.argv.slice(2);
  if (!username || !name || !password) {
    console.error('usage: node scripts/add-user.mjs <username> "<display name>" <password>');
    process.exit(1);
  }
  const file = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'users.json');
  await fs.mkdir(path.dirname(file), { recursive: true });
  const users = JSON.parse(await fs.readFile(file, 'utf8').catch(() => '[]'));
  const entry = { username: username.trim().toLowerCase(), name, passwordHash: await hashPassword(password) };
  const next = [...users.filter((u) => u.username !== entry.username), entry];
  await fs.writeFile(file, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  console.log(`saved ${entry.username} (${name}) to ${file}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
