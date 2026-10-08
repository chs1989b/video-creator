import fs from 'node:fs/promises';
import path from 'node:path';
import type { User } from './users';

// Server-only: reads the demo accounts written by scripts/add-user.mjs.
export const USERS_FILE = path.join(process.cwd(), 'data', 'users.json');

export async function loadUsers(file = USERS_FILE): Promise<User[]> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as User[];
  } catch {
    return [];
  }
}
