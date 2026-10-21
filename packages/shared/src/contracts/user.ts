import { z } from 'zod';
import { cursorSchema, pageLimitSchema, pageSchema } from './pagination';

export const wrappedPrivateKeySchema = z.object({
  ciphertext: z.string().min(1).max(256),
  salt: z.string().min(1).max(128),
  nonce: z.string().min(1).max(128),
});

export const registerUserSchema = z.object({
  username: z
    .string()
    .min(3)
    .max(32)
    .regex(/^[\w-]+$/),
  password: z.string().min(8).max(128),
  publicKey: z.string().min(1).max(128),
  wrappedPrivateKey: wrappedPrivateKeySchema,
});
export type RegisterUserInput = z.infer<typeof registerUserSchema>;

export const loginUserSchema = z.object({
  username: z.string().min(1).max(32),
  password: z.string().min(1).max(128),
});
export type LoginUserInput = z.infer<typeof loginUserSchema>;

export const userSummarySchema = z.object({
  id: z.uuid(),
  username: z.string(),
});
export type UserSummary = z.infer<typeof userSummarySchema>;

export const listUsersQuerySchema = z.object({
  limit: pageLimitSchema.default(50),
  cursor: cursorSchema.optional(),
});
export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;

export const usersPageSchema = pageSchema(userSummarySchema);
export type UsersPage = z.infer<typeof usersPageSchema>;

export const userIdParamsSchema = z.object({ id: z.uuid() });
