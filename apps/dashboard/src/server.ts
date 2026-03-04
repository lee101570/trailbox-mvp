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
    const target = `${AGENT_URL}/events`;
    const proxyReq = http.get(target, (agentRes) => {
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
        res.end(body || JSON.stringify([]));
      });
    });
    proxyReq.on('error', () => {
      sendJson(res, []);
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
