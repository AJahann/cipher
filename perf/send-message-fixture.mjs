import http from 'node:http';
import { createRequire } from 'node:module';

const apiRequire = createRequire(
  new URL('../packages/api/package.json', import.meta.url),
);
const sharedRequire = createRequire(
  new URL('../packages/shared/package.json', import.meta.url),
);
const { Server } = apiRequire('socket.io');
const sodium = sharedRequire('libsodium-wrappers-sumo');

const port = Number(process.env.PERF_API_PORT ?? 4100);
const webOrigin = process.env.PERF_WEB_ORIGIN ?? 'http://127.0.0.1:3000';

await sodium.ready;
const receiverKeys = sodium.crypto_box_keypair();
const receiverPublicKey = sodium.to_base64(receiverKeys.publicKey);

let registeredUser = null;

const receiver = {
  id: 'perf-receiver',
  username: 'perf-contact',
  createdAt: '2026-01-01T00:00:00.000Z',
  publicKey: receiverPublicKey,
  wrappedPrivateKey: { ciphertext: '', salt: '', nonce: '' },
};

function sendJson(response, status, value) {
  response.writeHead(status, {
    'access-control-allow-credentials': 'true',
    'access-control-allow-origin': webOrigin,
    'content-type': 'application/json',
  });
  response.end(JSON.stringify(value));
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);

  if (request.method === 'OPTIONS') {
    response.writeHead(204, {
      'access-control-allow-credentials': 'true',
      'access-control-allow-headers': 'content-type',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
      'access-control-allow-origin': webOrigin,
    });
    response.end();
    return;
  }

  if (request.method === 'GET' && url.pathname === '/health') {
    sendJson(response, 200, { ok: true });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/auth/register') {
    const body = await readJson(request);
    registeredUser = {
      id: 'perf-sender',
      username: body.username,
      createdAt: '2026-01-01T00:00:00.000Z',
      publicKey: body.publicKey,
      wrappedPrivateKey: body.wrappedPrivateKey,
    };
    sendJson(response, 201, registeredUser);
    return;
  }

  if (request.method === 'GET' && url.pathname === '/auth/me') {
    if (!registeredUser) {
      sendJson(response, 401, { error: 'UNAUTHENTICATED' });
      return;
    }
    sendJson(response, 200, registeredUser);
    return;
  }

  if (request.method === 'GET' && url.pathname === '/users') {
    sendJson(response, 200, [receiver]);
    return;
  }

  if (
    request.method === 'GET' &&
    url.pathname === `/users/${receiver.id}/public-key`
  ) {
    sendJson(response, 200, { publicKey: receiver.publicKey });
    return;
  }

  if (
    request.method === 'POST' &&
    url.pathname === '/chat/conversations'
  ) {
    sendJson(response, 201, {
      id: 'perf-conversation',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    return;
  }

  if (request.method === 'GET' && url.pathname === '/chat/messages') {
    sendJson(response, 200, []);
    return;
  }

  if (request.method === 'GET' && url.pathname === '/chat/conversations') {
    sendJson(response, 200, []);
    return;
  }

  sendJson(response, 404, { error: 'NOT_FOUND' });
});

const io = new Server(server, {
  cors: { origin: webOrigin, credentials: true },
});

io.on('connection', (socket) => {
  socket.on('message:send', (_payload, acknowledge) => {
    setTimeout(() => acknowledge({ ok: true }), 250);
  });
});

server.listen(port, '127.0.0.1', () => {
  console.log(`performance fixture listening on http://127.0.0.1:${port}`);
});
