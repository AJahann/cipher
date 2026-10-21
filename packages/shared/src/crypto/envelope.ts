import { z } from 'zod';
import { E2EEncryption } from './e2e';

export const CHAT_ALGORITHM_V1 = 'cipher-v1-x25519-xsalsa20-poly1305';
const LEGACY_ALGORITHM = 'x25519-xsalsa20-poly1305';
const PREFIX = 'cipher:v1:';
const contextSchema = z
  .object({
    senderId: z.uuid(),
    recipientId: z.uuid(),
    conversationId: z.uuid(),
    clientMessageId: z.uuid(),
  })
  .strict();
export type MessageContext = z.infer<typeof contextSchema>;
const envelopeSchema = contextSchema
  .extend({ version: z.literal(1), text: z.string() })
  .strict();

/** Bind application context inside authenticated encryption, not just beside it. */
export async function encryptChatMessage(
  text: string,
  peerPublicKey: Uint8Array,
  privateKey: Uint8Array,
  context: MessageContext,
) {
  const envelope = envelopeSchema.parse({ ...context, version: 1, text });
  if (new TextEncoder().encode(text).length > 40_000)
    throw new Error('MESSAGE_TOO_LARGE');
  const encrypted = await E2EEncryption.encryptMessage(
    PREFIX + JSON.stringify(envelope),
    peerPublicKey,
    privateKey,
  );
  return { ...encrypted, algorithm: CHAT_ALGORITHM_V1 };
}

export async function decryptChatMessage(
  message: { ciphertext: string; nonce: string; algorithm: string },
  peerPublicKey: Uint8Array,
  privateKey: Uint8Array,
  expected: MessageContext,
) {
  contextSchema.parse(expected);
  if (
    message.algorithm !== CHAT_ALGORITHM_V1 &&
    message.algorithm !== LEGACY_ALGORITHM
  )
    throw new Error('UNSUPPORTED_MESSAGE_ALGORITHM');
  const raw = await E2EEncryption.decryptMessage(
    message.ciphertext,
    message.nonce,
    peerPublicKey,
    privateKey,
  );
  if (message.algorithm === LEGACY_ALGORITHM) {
    if (raw.startsWith(PREFIX)) throw new Error('MESSAGE_VERSION_DOWNGRADE');
    return raw; // Legacy history has no authenticated application context.
  }
  if (!raw.startsWith(PREFIX)) throw new Error('INVALID_MESSAGE_ENVELOPE');
  const envelope = envelopeSchema.parse(JSON.parse(raw.slice(PREFIX.length)));
  for (const key of [
    'senderId',
    'recipientId',
    'conversationId',
    'clientMessageId',
  ] as const) {
    if (envelope[key] !== expected[key])
      throw new Error('MESSAGE_CONTEXT_MISMATCH');
  }
  return envelope.text;
}
