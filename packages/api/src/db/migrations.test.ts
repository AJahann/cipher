import { readFileSync } from 'node:fs';
import { generateDrizzleJson, generateMigration } from 'drizzle-kit/api';
import { describe, expect, it } from 'vitest';
import * as schema from './schema';

const migrationFile = (path: string) =>
  readFileSync(new URL(`../../drizzle/${path}`, import.meta.url), 'utf8');
const journal = JSON.parse(migrationFile('meta/_journal.json'));
const previous = JSON.parse(migrationFile('meta/0006_snapshot.json'));
const outbox = JSON.parse(migrationFile('meta/0007_snapshot.json'));

describe('Drizzle migration generator continuity', () => {
  it('links the outbox snapshot to 0006 and the existing 0007 journal entry', () => {
    expect(outbox.prevId).toBe(previous.id);
    expect(outbox.id).not.toBe(previous.id);
    expect(
      journal.entries.find((entry: { idx: number }) => entry.idx === 7).tag,
    ).toBe('0007_notification_outbox');
  });

  it('generates no SQL from the latest snapshot to the exported schema', async () => {
    const index = String(journal.entries.at(-1).idx).padStart(4, '0');
    const latest = JSON.parse(migrationFile(`meta/${index}_snapshot.json`));
    const current = generateDrizzleJson(schema, latest.id);
    await expect(generateMigration(latest, current)).resolves.toEqual([]);
  });

  it('records SQL checks and the existing foreign key name without removing legacy backfill', () => {
    const table = outbox.tables['public.notification_outbox'];
    expect(Object.keys(table.checkConstraints).sort()).toEqual([
      'notification_outbox_attempts_check',
      'notification_outbox_generation_check',
      'notification_outbox_status_check',
    ]);
    expect(table.foreignKeys.notification_outbox_message_id_fkey.onDelete).toBe(
      'cascade',
    );
    const sql = migrationFile('0007_notification_outbox.sql');
    expect(sql).toContain("CHECK (status IN ('pending','completed','failed'))");
    expect(sql).toContain('CHECK (generation >= 0)');
    expect(sql).toContain('CHECK (attempts BETWEEN 0 AND 3)');
    expect(sql).toContain(
      "SELECT id, 'completed', now(), 'LEGACY_NO_DISPATCH' FROM messages;",
    );
  });
});
