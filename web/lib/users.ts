import { verifyPassword } from './auth';

// Demo accounts live in web/data/users.json (not committed); add them with
// `node scripts/add-user.mjs <username> <display name> <password>`.

export type User = { username: string; name: string; passwordHash: string };

export const normalizeUsername = (username: string) => username.trim().toLowerCase();

export async function authenticate(users: User[], username: string, password: string): Promise<User | null> {
  const user = users.find((u) => u.username === normalizeUsername(username));
  if (!user) return null;
  return (await verifyPassword(password, user.passwordHash)) ? user : null;
}
