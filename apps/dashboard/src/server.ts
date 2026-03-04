import * as http from 'node:http';
import { existsSync, readFileSync, createReadStream } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.TRAILBOX_MVP_DASHBOARD_PORT ?? 7466);
const AGENT_URL = process.env.TRAILBOX_MVP_AGENT_URL ?? 'http://127.0.0.1:7465';
const __dirname = fileURLToPath(new URL('.', import.meta.url));
const PUBLIC_DIR = join(__dirname, '..', 'public');

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript',
  '.css': 'text/css',
};

function extOf(pathname: string): string {
  const idx = pathname.lastIndexOf('.');
  return idx >= 0 ? pathname.slice(idx) : '';
}

function sendFile(res: http.ServerResponse, filePath: string): void {
  const ext = extOf(filePath);
  const mime = MIME_TYPES[ext] ?? 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': mime });
  createReadStream(filePath).pipe(res);
}

function sendJson(res: http.ServerResponse, payload: unknown, statusCode = 200): void {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', `http://127.0.0.1:${PORT}`);

  if (req.method === 'GET' && url.pathname === '/health') {
    sendJson(res, { status: 'ok', service: 'trailbox-mvp-dashboard', port: PORT });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/events') {
    const target = createEventsUrl(url);
    proxyJson({
      method: 'GET',
      target,
      res,
      fallbackPayload: [],
    });
    return;
  }

  if (req.method === 'DELETE' && url.pathname === '/api/events') {
    const target = createEventsUrl(url);
    proxyJson({
      method: 'DELETE',
      target,
      res,
      fallbackPayload: { status: 'error', removed: 0, remaining: 0 },
      fallbackStatusCode: 500,
    });
    return;
  }

  const normalized = url.pathname === '/' ? '/index.html' : url.pathname;
  const filePath = join(PUBLIC_DIR, normalized);
  if (existsSync(filePath)) {
    sendFile(res, filePath);
    return;
  }

  sendJson(res, { status: 'not_found' }, 404);
});

server.listen(PORT, () => {
  console.log(`[trailbox-mvp-dashboard] listening http://127.0.0.1:${PORT}`);
});

function ensureBaseUrl(value: string): string {
  return value.endsWith('/') ? value : `${value}/`;
}

function createEventsUrl(url: URL): URL {
  const target = new URL('/events', ensureBaseUrl(AGENT_URL));
  const type = url.searchParams.get('type');
  const limit = url.searchParams.get('limit');
  const before = url.searchParams.get('before');
  const after = url.searchParams.get('after');
  if (type) {
    target.searchParams.set('type', type);
  }
  if (limit) {
    target.searchParams.set('limit', limit);
  }
  if (before) {
    target.searchParams.set('before', before);
  }
  if (after) {
    target.searchParams.set('after', after);
  }
  return target;
}

function proxyJson({
  method,
  target,
  res,
  fallbackPayload,
  fallbackStatusCode = 200,
}: {
  method: 'GET' | 'DELETE';
  target: URL;
  res: http.ServerResponse;
  fallbackPayload: unknown;
  fallbackStatusCode?: number;
}): void {
  const proxyReq = http.request(target, { method }, (agentRes) => {
    let body = '';
    agentRes.on('data', (chunk) => {
      body += chunk.toString();
    });
    agentRes.on('end', () => {
      res.writeHead(agentRes.statusCode ?? 500, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*',
      });
      res.end(body || JSON.stringify(fallbackPayload));
    });
  });
  proxyReq.on('error', () => {
    sendJson(res, fallbackPayload, fallbackStatusCode);
  });
  proxyReq.end();
}
