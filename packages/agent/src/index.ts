import * as http from 'node:http';
import { IncomingMessage, ServerResponse } from 'node:http';
import { EventStore, ListOptions } from 'trailbox-mvp-storage';

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

interface EventsQuery {
  type?: string;
  limit?: number;
  before?: string;
  after?: string;
}

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
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
  const requestUrl = new URL(req.url || '/', `http://127.0.0.1:${PORT}`);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS_HEADERS);
    res.end();
    return;
  }

  if (req.method === 'GET' && requestUrl.pathname === '/health') {
    writeJson(res, 200, { status: 'ok', port: PORT, service: 'trailbox-mvp-agent' });
    return;
  }

  if (req.method === 'GET' && requestUrl.pathname === '/events') {
    const query = parseEventsQuery(requestUrl);
    const options: ListOptions = {
      type: query.type,
      limit: query.limit,
      before: query.before,
      after: query.after,
    };
    const events = await store.list(options);
    writeJson(res, 200, events);
    return;
  }

  if (req.method === 'DELETE' && requestUrl.pathname === '/events') {
    const query = parseEventsQuery(requestUrl);
    const result = await store.delete({ type: query.type });
    writeJson(res, 200, { status: 'ok', ...result });
    return;
  }

  if (req.method === 'POST' && requestUrl.pathname === '/ingest') {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk.toString();
    });
    req.on('end', async () => {
      try {
        const payload = body ? JSON.parse(body) as unknown : {};
        if (Array.isArray(payload)) {
          const records = payload.filter(isObjectRecord);
          if (records.length === 0) {
            writeJson(res, 400, { message: 'invalid batch payload' });
            return;
          }
          await store.appendMany(records);
          writeJson(res, 200, { status: 'ok', accepted: records.length });
          return;
        }

        if (!isObjectRecord(payload)) {
          writeJson(res, 400, { message: 'invalid payload' });
          return;
        }

        await store.append(payload);
        writeJson(res, 200, { status: 'ok', accepted: 1 });
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

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseEventsQuery(url: URL): EventsQuery {
  const type = normalizeString(url.searchParams.get('type'));
  const before = normalizeString(url.searchParams.get('before'));
  const after = normalizeString(url.searchParams.get('after'));
  const limitRaw = normalizeString(url.searchParams.get('limit'));
  const limit = limitRaw ? parseLimit(limitRaw) : undefined;
  return { type, before, after, limit };
}

function normalizeString(value: string | null): string | undefined {
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}

function parseLimit(value: string): number | undefined {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }
  return Math.min(Math.floor(parsed), 2000);
}
