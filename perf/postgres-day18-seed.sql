-- Synthetic scale model, not a production export. Fixed IDs and distributions.
-- 250k users, 500k two-person DMs, 1m memberships. IDs are scattered UUIDs;
-- heap insertion order is not UUID/index order. No real passwords or messages.
INSERT INTO users (id, username, password_hash, created_at)
SELECT md5('day18:user:' || n)::uuid,
       'day18_' || lpad(n::text, 6, '0'),
       '$argon2id$v=19$m=19456,t=2,p=1$' || repeat('x', 65),
       timestamp '2026-01-01' + n * interval '1 second'
FROM generate_series(1, 250000) AS n;

INSERT INTO conversations (id, direct_key, created_at)
SELECT md5('day18:conversation:' || n)::uuid, NULL,
       timestamp '2026-01-01' + n * interval '1 second'
FROM generate_series(1, 500000) AS n;

-- 20k DMs for a whale; 80k shared across 100 hubs; 400k across regular users.
-- Recipient selection permutes regular users. Avoid self-conversations.
WITH participants AS (
  SELECT n,
         CASE WHEN n <= 20000 THEN 1
              WHEN n <= 100000 THEN 2 + (n % 100)
              ELSE 102 + (n % 249899) END AS a,
         CASE WHEN n <= 100000 THEN 102 + ((n * 73) % 249899)
              ELSE 102 + ((n + 1 + ((n - 100001) / 249899)) % 249899)
         END AS b
  FROM generate_series(1, 500000) AS n
), pairs AS (
  SELECT n, a,
         CASE WHEN b = a THEN 102 + ((b - 101) % 249899) ELSE b END AS b
  FROM participants
)
INSERT INTO conversation_members (id, conversation_id, user_id)
SELECT md5('day18:membership:' || n || ':' || side)::uuid,
       md5('day18:conversation:' || n)::uuid,
       md5('day18:user:' || member)::uuid
FROM pairs CROSS JOIN LATERAL (VALUES (1, a), (2, b)) AS p(side, member);

-- Complete the same canonical direct-key invariant as the application.
UPDATE conversations c
SET direct_key = p.direct_key
FROM (
  SELECT conversation_id,
         'dm:' || string_agg(user_id::text, ':' ORDER BY user_id::text) AS direct_key
  FROM conversation_members GROUP BY conversation_id
) p
WHERE c.id = p.conversation_id;