import { z } from 'zod';

export const pageLimitSchema = z.coerce.number().int().min(1).max(100);

/** Opaque cursor. Clients must pass back `nextCursor` verbatim. */
export const cursorSchema = z.string().min(1).max(512);

export const pageSchema = <T extends z.ZodType>(item: T) =>
  z.object({
    items: z.array(item),
    /** `null` when there are no further items. */
    nextCursor: cursorSchema.nullable(),
  });

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}
