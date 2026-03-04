import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import * as path from 'node:path';

const EVENT_FILE = 'events.jsonl';

export interface EventRecord {
  id: string;
  receivedAt: string;
  [key: string]: unknown;
}

export interface ListOptions {
  type?: string | string[];
  limit?: number;
  before?: string;
  after?: string;
}

export interface DeleteOptions {
  type?: string | string[];
}

export interface DeleteResult {
  removed: number;
  remaining: number;
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

  async appendMany(events: Record<string, unknown>[]): Promise<EventRecord[]> {
    if (events.length === 0) {
      return [];
    }
    await this.ensure();
    const records = events.map((event) => ({
      id: `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`,
      receivedAt: new Date().toISOString(),
      ...event,
    }));
    const serialized = records.map((record) => JSON.stringify(record)).join('\n') + '\n';
    await appendFile(this.filePath, serialized, 'utf8');
    return records;
  }

  async list(options: ListOptions = {}): Promise<EventRecord[]> {
    await this.ensure();
    const raw = await readFile(this.filePath, 'utf8').catch(() => '');
    if (!raw.trim()) {
      return [];
    }

    const parsed = raw
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

    const types = normalizeTypeFilter(options.type);
    const beforeTs = toEpoch(options.before);
    const afterTs = toEpoch(options.after);
    const filtered = parsed.filter((event) => {
      if (types && !types.has(String(event.type ?? ''))) {
        return false;
      }

      const eventTs = toEpoch(String(event.receivedAt ?? event.occurredAt ?? ''));
      if (beforeTs !== null && eventTs !== null && eventTs >= beforeTs) {
        return false;
      }
      if (afterTs !== null && eventTs !== null && eventTs <= afterTs) {
        return false;
      }
      return true;
    });

    const limit = normalizeLimit(options.limit);
    if (limit === null) {
      return filtered;
    }
    return filtered.slice(0, limit);
  }

  async delete(options: DeleteOptions = {}): Promise<DeleteResult> {
    await this.ensure();
    const records = await this.readAll();
    if (records.length === 0) {
      return { removed: 0, remaining: 0 };
    }

    const types = normalizeTypeFilter(options.type);
    if (!types) {
      await writeFile(this.filePath, '', 'utf8');
      return { removed: records.length, remaining: 0 };
    }

    const remainingRecords = records.filter((event) => !types.has(String(event.type ?? '')));
    const removed = records.length - remainingRecords.length;
    const serialized = remainingRecords.length > 0
      ? `${remainingRecords.map((record) => JSON.stringify(record)).join('\n')}\n`
      : '';
    await writeFile(this.filePath, serialized, 'utf8');
    return { removed, remaining: remainingRecords.length };
  }

  private async readAll(): Promise<EventRecord[]> {
    const raw = await readFile(this.filePath, 'utf8').catch(() => '');
    if (!raw.trim()) {
      return [];
    }
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
      .filter((item): item is EventRecord => item !== null);
  }
}

function normalizeTypeFilter(value: string | string[] | undefined): Set<string> | null {
  if (!value) {
    return null;
  }
  const tokens = Array.isArray(value)
    ? value
    : value.split(',');
  const normalized = tokens
    .map((item) => item.trim())
    .filter(Boolean);
  return normalized.length > 0 ? new Set(normalized) : null;
}

function normalizeLimit(value: number | undefined): number | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }
  return Math.min(Math.floor(value), 2000);
}

function toEpoch(value: string | undefined): number | null {
  if (!value) {
    return null;
  }
  const ts = Date.parse(value);
  return Number.isFinite(ts) ? ts : null;
}
