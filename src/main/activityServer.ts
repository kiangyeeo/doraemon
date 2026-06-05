import { createServer, type Server } from 'node:http';
import type { BrowserWindow } from 'electron';
import {
  ACTIVITY_IPC_CHANNEL,
  ACTIVITY_SERVER_HOST,
  ACTIVITY_SERVER_PORT,
  isActivityKind,
  type ActivityEvent
} from '../shared/activity';

// Reject absurdly large bodies so a stray client can't buffer memory forever.
const MAX_BODY_BYTES = 16 * 1024;

type WindowGetter = () => BrowserWindow | null;

function log(message: string): void {
  console.log(`[activity] ${message}`);
}

function send(response: import('node:http').ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    // Allow a browser-based agent panel to POST events without a CORS preflight
    // failure. The server only binds to loopback, so this stays local-only.
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  response.end(payload);
}

function readBody(request: import('node:http').IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('body too large'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    request.on('error', reject);
  });
}

// Starts a tiny loopback-only HTTP server that turns inbound coding-activity
// events into IPC messages for the mascot renderer. Editor / agent adapters
// POST `{ "kind": "...", "source": "..." }` to `/activity`.
//
// Returns the server handle (already listening) so callers can close it.
export function startActivityServer(getWindow: WindowGetter): Server {
  const server = createServer((request, response) => {
    const url = request.url ?? '/';
    const method = request.method ?? 'GET';

    if (method === 'OPTIONS') {
      send(response, 204, {});
      return;
    }

    if (method === 'GET' && (url === '/health' || url === '/')) {
      send(response, 200, { ok: true, service: 'doraemon-activity', port: ACTIVITY_SERVER_PORT });
      return;
    }

    if (method === 'POST' && url.split('?')[0] === '/activity') {
      readBody(request)
        .then((raw) => {
          let parsed: unknown;
          try {
            parsed = raw ? JSON.parse(raw) : {};
          } catch {
            send(response, 400, { ok: false, error: 'invalid JSON' });
            return;
          }

          const record = (parsed ?? {}) as Record<string, unknown>;
          if (!isActivityKind(record.kind)) {
            send(response, 400, { ok: false, error: 'missing or unknown "kind"' });
            return;
          }

          const event: ActivityEvent = {
            kind: record.kind,
            source: typeof record.source === 'string' ? record.source.slice(0, 64) : 'unknown',
            receivedAt: Date.now()
          };

          const window = getWindow();
          if (window && !window.isDestroyed()) {
            window.webContents.send(ACTIVITY_IPC_CHANNEL, event);
          }

          log(`${event.source} -> ${event.kind}`);
          send(response, 202, { ok: true, kind: event.kind });
        })
        .catch((error: unknown) => {
          send(response, 413, { ok: false, error: error instanceof Error ? error.message : 'bad request' });
        });
      return;
    }

    send(response, 404, { ok: false, error: 'not found' });
  });

  server.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EADDRINUSE') {
      // Another desktop-pet instance (or something) already owns the port.
      // The single-instance lock normally prevents this; log and carry on so
      // the mascot still runs without the activity feed.
      log(`port ${ACTIVITY_SERVER_PORT} already in use; activity feed disabled`);
    } else {
      log(`server error: ${error.message}`);
    }
  });

  server.listen(ACTIVITY_SERVER_PORT, ACTIVITY_SERVER_HOST, () => {
    log(`listening on http://${ACTIVITY_SERVER_HOST}:${ACTIVITY_SERVER_PORT}`);
  });

  return server;
}
