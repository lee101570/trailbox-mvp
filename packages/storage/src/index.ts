import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import * as path from 'node:path';

const EVENT_FILE = 'events.jsonl';

export interface EventRecord {
  id: string;
  receivedAt: string;
  [key: string]: unknown;
}

export class EventStore {
  private rootDir: string;
  private dataDir: string;
  private filePath: string;

  constructor({ rootDir = process.cwd(), dataDir = '.trailbox-mvp' }: { rootDir?: string; dataDir?: string } = {}) {
    this.rootDir = rootDir;
    this.dataDir = dataDir;
    this.filePath = path.join(this.rootDir, this.dataDir, EVENT_FILE);
  }

  async ensure(): Promise<boolean> {
    const dir = path.dirname(this.filePath);
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }
    return true;
  }

  async append(event: Record<string, unknown>): Promise<EventRecord> {
    await this.ensure();
    const record: EventRecord = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`,
      receivedAt: new Date().toISOString(),
      ...event,
    };
    const serialized = JSON.stringify(record) + '\n';
    await appendFile(this.filePath, serialized, 'utf8');
    return record;
  }

  async list(): Promise<EventRecord[]> {
    await this.ensure();
    const raw = await readFile(this.filePath, 'utf8').catch(() => '');
    if (!raw.trim()) return [];
    return raw
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line) as EventRecord;
        } catch {
          return null;
        }
      })
      .filter((item): item is EventRecord => item !== null)
      .sort((a, b) => new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime());
  }
}
