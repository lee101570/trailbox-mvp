import * as http from 'node:http';
import { IncomingMessage, ServerResponse } from 'node:http';
import { EventStore } from 'trailbox-mvp-storage';

const PORT = Number(process.env.TRAILBOX_MVP_AGENT_PORT ?? 7465);
const DATA_DIR = process.env.TRAILBOX_MVP_DATA_DIR ?? '.trailbox-mvp';
const store = new EventStore({ rootDir: process.cwd(), dataDir: DATA_DIR });

store.ensure().catch(() => undefined);

interface ErrorPayload {
  message: string;
}

interface IngestPayload {
  type?: string;
  [key: string]: unknown;
}

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '600',
};

function writeJson(res: ServerResponse, statusCode: number, payload: unknown): void {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    ...CORS_HEADERS,
  });
  res.end(JSON.stringify(payload));
}

const server = http.createServer(async (req: IncomingMessage, res: ServerResponse) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS_HEADERS);
    res.end();
    return;
  }

  if (req.method === 'GET' && req.url === '/health') {
    writeJson(res, 200, { status: 'ok', port: PORT, service: 'trailbox-mvp-agent' });
    return;
  }

  if (req.method === 'GET' && req.url === '/events') {
    const events = await store.list();
    writeJson(res, 200, events);
    return;
  }

  if (req.method === 'POST' && req.url === '/ingest') {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk.toString();
    });
    req.on('end', async () => {
      try {
        const payload = body ? (JSON.parse(body) as IngestPayload) : {};
        await store.append(payload);
        writeJson(res, 200, { status: 'ok' });
      } catch {
        const error: ErrorPayload = { message: 'invalid json' };
        writeJson(res, 400, error);
      }
    });
    return;
  }

  writeJson(res, 404, { status: 'not_found' });
});

server.listen(PORT, () => {
  console.log(`[trailbox-mvp-agent] listening http://127.0.0.1:${PORT}`);
});
