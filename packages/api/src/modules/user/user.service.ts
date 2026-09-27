import bcrypt from 'bcrypt';
import { db } from '../../db';
import { users, userKeys } from '../../db/schema';
import { eq, ne, and, gt, asc } from 'drizzle-orm';

const SALT_ROUNDS = 12;

const PUBLIC_COLUMNS = {
  id: true,
  username: true,
  createdAt: true,
} as const;

export const userService = {
  async register({
    username,
    password,
    publicKey,
    wrappedPrivateKey,
  }: {
    username: string;
    password: string;
    publicKey: string;
    wrappedPrivateKey: { ciphertext: string; salt: string; nonce: string };
  }) {
    const existing = await db.query.users.findFirst({
      where: eq(users.username, username),
    });
    if (existing) throw new Error('USERNAME_TAKEN');

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    return db.transaction(async (tx) => {
      const [user] = await tx
        .insert(users)
        .values({ username, passwordHash })
        .returning({
          id: users.id,
          username: users.username,
          createdAt: users.createdAt,
        });

      await tx.insert(userKeys).values({
        userId: user.id,
        publicKey,
        wrappedPrivateKey: JSON.stringify(wrappedPrivateKey),
      });

      return user;
    });
  },

  async login({ username, password }: { username: string; password: string }) {
    const user = await db.query.users.findFirst({
      where: eq(users.username, username),
      with: { key: true },
    });

    const hashToCompare =
      user?.passwordHash ??
      '$2b$12$invalidhashpaddingtopreventimenumeration000000000000000';
    const valid = await bcrypt.compare(password, hashToCompare);
    if (!user || !valid) throw new Error('INVALID_CREDENTIALS');

    const wrappedPrivateKey = user.key?.wrappedPrivateKey
      ? JSON.parse(user.key.wrappedPrivateKey)
      : null;

    return {
      id: user.id,
      username: user.username,
      createdAt: user.createdAt,
      wrappedPrivateKey,
      publicKey: user.key.publicKey,
    };
  },

  findById(id: string) {
    return db.query.users.findFirst({
      where: eq(users.id, id),
      columns: PUBLIC_COLUMNS,
    });
  },

  listUsers(excludeUserId: string, limit: number, after?: string) {
    const conditions = [ne(users.id, excludeUserId)];
    if (after) {
      conditions.push(gt(users.id, after));
    }

    return db.query.users.findMany({
      where: and(...conditions),
      columns: { id: true, username: true },
      orderBy: [asc(users.id)],
      limit,
    });
  },

  async getPublicKey(userId: string): Promise<string | null> {
    const row = await db.query.userKeys.findFirst({
      where: eq(userKeys.userId, userId),
    });
    return row?.publicKey ?? null;
  },
};
