import bcrypt from 'bcrypt';
import { db } from '../../db';
import { users, userKeys } from '../../db/schema';
import { eq, ne, and, gt, asc } from 'drizzle-orm';
import type { RegisterUserInput, UsersPage } from '@chat-app/shared/contracts';
import { AppError, isUniqueViolation } from '../../http/errors';
import { decodeCursor, encodeCursor } from '../../http/cursor';

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
  }: RegisterUserInput) {
    const existing = await db.query.users.findFirst({
      where: eq(users.username, username),
    });
    if (existing) throw new AppError('USERNAME_TAKEN');

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    // The pre-check above is only a fast path: two concurrent registrations
    // both pass it, and the UNIQUE(username) constraint decides the winner.
    try {
      return await db.transaction(async (tx) => {
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
    } catch (error) {
      if (isUniqueViolation(error)) throw new AppError('USERNAME_TAKEN');
      throw error;
    }
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
    if (!user || !valid) throw new AppError('INVALID_CREDENTIALS');

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

  /**
   * Keyset page ordered by `id ASC` (unique, so the order is total and stable
   * under concurrent inserts). The cursor encodes the last id returned.
   */
  async listUsers(
    excludeUserId: string,
    limit: number,
    cursor?: string,
  ): Promise<UsersPage> {
    const conditions = [ne(users.id, excludeUserId)];
    if (cursor) conditions.push(gt(users.id, decodeCursor('users', cursor)));

    const rows = await db.query.users.findMany({
      where: and(...conditions),
      columns: { id: true, username: true },
      orderBy: [asc(users.id)],
      limit: limit + 1,
    });
    const items = rows.slice(0, limit);
    const last = items.at(-1);
    return {
      items,
      nextCursor:
        rows.length > limit && last ? encodeCursor('users', last.id) : null,
    };
  },

  async getPublicKey(userId: string): Promise<string | null> {
    const row = await db.query.userKeys.findFirst({
      where: eq(userKeys.userId, userId),
    });
    return row?.publicKey ?? null;
  },
};
