import { z } from 'zod';

export const registerUserSchema = z.object({
  username: z
    .string()
    .min(3)
    .max(32)
    .regex(/^[\w-]+$/i),
  password: z.string().min(8).max(128),
  publicKey: z.string().min(1),
  wrappedPrivateKey: z.object({
    ciphertext: z.string().min(1),
    salt: z.string().min(1),
    nonce: z.string().min(1),
  }),
});

export const loginUserSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});
