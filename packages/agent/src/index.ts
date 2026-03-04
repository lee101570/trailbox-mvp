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

type HttpMethod = 'GET' | 'POST';

const server = http.createServer(async (req: IncomingMessage, res: ServerResponse) => {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ status: 'ok', port: PORT, service: 'trailbox-mvp-agent' }));
    return;
  }

  if (req.method === 'GET' && req.url === '/events') {
    const events = await store.list();
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify(events));
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
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ status: 'ok' }));
      } catch {
        const error: ErrorPayload = { message: 'invalid json' };
        res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify(error));
      }
    });
    return;
  }

  const response = { status: 'not_found' };
  res.writeHead(404, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(response));
});

server.listen(PORT, () => {
  console.log(`[trailbox-mvp-agent] listening http://127.0.0.1:${PORT}`);
});
