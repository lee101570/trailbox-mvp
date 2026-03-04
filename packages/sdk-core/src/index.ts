import { createEvent, EventType } from '@trailbox-mvp/protocol';

interface TrailboxOptions {
  endpoint?: string;
  appName?: string;
  sampleRate?: number;
  mask?: boolean;
  captureBodies?: boolean;
  captureHeaders?: boolean;
  maxBodyLength?: number;
}

type NetworkPayload = {
  url: string;
  method: string;
  status?: number;
  durationMs: number;
  requestHeaders?: Record<string, string>;
  responseHeaders?: Record<string, string>;
  requestBody?: string;
  requestBodyTruncated?: boolean;
  responseBody?: string;
  responseBodyTruncated?: boolean;
  error?: string;
};

type XhrTrailboxState = {
  method: string;
  url: string;
  requestHeaders: Record<string, string>;
  requestBody?: string;
  requestBodyTruncated?: boolean;
};

declare global {
  interface Window {
    __trailboxMvpInstalled?: boolean;
  }
  interface XMLHttpRequest {
    __trailboxState?: XhrTrailboxState;
  }
}

const SENSITIVE_HEADER_SET = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'proxy-authorization',
  'x-api-key',
]);

const SENSITIVE_QUERY_KEYS = [
  'token',
  'access_token',
  'id_token',
  'auth',
  'authorization',
  'password',
  'apikey',
  'api_key',
  'secret',
];

export function initTrailboxMvp({
  endpoint = 'http://127.0.0.1:7465/ingest',
  appName = 'unknown',
  sampleRate = 1,
  mask = true,
  captureBodies = true,
  captureHeaders = true,
  maxBodyLength = 10_000,
}: TrailboxOptions = {}): void {
  if (typeof window === 'undefined' || window.__trailboxMvpInstalled) {
    return;
  }
  window.__trailboxMvpInstalled = true;

  const send = async (event: unknown): Promise<void> => {
    if (Math.random() > sampleRate) {
      return;
    }
    try {
      await fetch(endpoint, {
        method: 'POST',
        mode: 'cors',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(event),
      });
    } catch {
      // swallow networking errors intentionally
    }
  };

  const capture = (
    type: string,
    severity: string,
    message: string,
    payload: Record<string, unknown> = {}
  ): void => {
    void send(
      createEvent({
        type: type as (typeof EventType)[keyof typeof EventType],
        severity,
        message,
        payload,
        appName,
      })
    );
  };

  const normalize = (...args: unknown[]): string => args.map((arg) => stringifyUnknown(arg, mask, maxBodyLength)).join(' ');

  ['error', 'warn'].forEach((level) => {
    const original = console[level as 'error' | 'warn'] as (...args: unknown[]) => void;
    const patched = (...items: unknown[]) => {
      original.apply(console, items);
      capture(
        EventType.CONSOLE,
        level === 'error' ? 'error' : 'warning',
        normalize(...items),
        { level }
      );
    };
    (console as unknown as Record<string, (...args: unknown[]) => void>)[level] = patched;
  });

  window.addEventListener('error', (event) => {
    capture(
      EventType.ERROR,
      'error',
      event.message || 'window error',
      {
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
        error: stringifyUnknown(event.error, mask, maxBodyLength),
      }
    );
  });

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason as unknown;
    capture(
      EventType.PROMISE_REJECTION,
      'error',
      normalize(reason),
      { reason: normalize(reason) }
    );
  });

  if (typeof window.fetch === 'function') {
    patchFetch(capture, {
      mask,
      captureBodies,
      captureHeaders,
      maxBodyLength,
    });
  }

  if (window.XMLHttpRequest) {
    patchXhr(capture, {
      mask,
      captureBodies,
      captureHeaders,
      maxBodyLength,
    });
  }
}

function patchFetch(
  capture: (type: string, severity: string, message: string, payload: Record<string, unknown>) => void,
  opts: Required<Pick<TrailboxOptions, 'mask' | 'captureBodies' | 'captureHeaders' | 'maxBodyLength'>>
): void {
  const originalFetch = window.fetch.bind(window);

  window.fetch = async (...args: Parameters<typeof window.fetch>) => {
    const started = performance.now();
    const input = args[0];
    const init = args[1] || {};
    const method = ((init as RequestInit).method || (isRequest(input) ? input.method : 'GET') || 'GET').toUpperCase();
    const rawUrl = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;
    const url = sanitizeUrl(rawUrl, opts.mask);

    const requestHeaders = opts.captureHeaders
      ? normalizeHeaders((init as RequestInit).headers || (isRequest(input) ? input.headers : undefined), opts.mask)
      : undefined;
    const requestBody = opts.captureBodies
      ? captureFetchRequestBody(input, init, opts.mask, opts.maxBodyLength)
      : Promise.resolve(undefined);

    try {
      const response = await originalFetch(...args);
      const responseHeaders = opts.captureHeaders ? normalizeHeaders(response.headers, opts.mask) : undefined;
      const bodyResult = opts.captureBodies
        ? await captureFetchResponseBody(response, opts.mask, opts.maxBodyLength)
        : undefined;
      const reqBodyResult = await requestBody;

      const payload: NetworkPayload = {
        url,
        method,
        status: response.status,
        durationMs: Math.round(performance.now() - started),
        requestHeaders,
        responseHeaders,
        requestBody: reqBodyResult?.body,
        requestBodyTruncated: reqBodyResult?.truncated,
        responseBody: bodyResult?.body,
        responseBodyTruncated: bodyResult?.truncated,
      };

      capture(
        EventType.NETWORK,
        response.ok ? 'info' : 'warning',
        `${method} ${url}`,
        payload as unknown as Record<string, unknown>
      );

      return response;
    } catch (error: unknown) {
      const reqBodyResult = await requestBody;
      const payload: NetworkPayload = {
        url,
        method,
        durationMs: Math.round(performance.now() - started),
        requestHeaders,
        requestBody: reqBodyResult?.body,
        requestBodyTruncated: reqBodyResult?.truncated,
        error: stringifyUnknown(error, opts.mask, opts.maxBodyLength),
      };
      capture(
        EventType.NETWORK,
        'error',
        `${method} ${url}`,
        payload as unknown as Record<string, unknown>
      );
      throw error;
    }
  };
}

function patchXhr(
  capture: (type: string, severity: string, message: string, payload: Record<string, unknown>) => void,
  opts: Required<Pick<TrailboxOptions, 'mask' | 'captureBodies' | 'captureHeaders' | 'maxBodyLength'>>
): void {
  const originalOpen = window.XMLHttpRequest.prototype.open;
  const originalSend = window.XMLHttpRequest.prototype.send;
  const originalSetRequestHeader = window.XMLHttpRequest.prototype.setRequestHeader;

  window.XMLHttpRequest.prototype.open = function (
    this: XMLHttpRequest,
    method: string,
    url: string,
    async?: boolean,
    user?: string | null,
    password?: string | null
  ): void {
    this.__trailboxState = {
      method: String(method || 'GET').toUpperCase(),
      url: sanitizeUrl(url, opts.mask),
      requestHeaders: {},
    };
    originalOpen.call(this, method, url, async ?? true, user || null, password || null);
  };

  window.XMLHttpRequest.prototype.setRequestHeader = function (
    this: XMLHttpRequest,
    name: string,
    value: string
  ): void {
    if (this.__trailboxState && opts.captureHeaders) {
      this.__trailboxState.requestHeaders[name.toLowerCase()] = sanitizeHeaderValue(name, value, opts.mask);
    }
    originalSetRequestHeader.call(this, name, value);
  };

  window.XMLHttpRequest.prototype.send = function (
    this: XMLHttpRequest,
    body?: Document | XMLHttpRequestBodyInit | null
  ): void {
    const started = performance.now();
    const state = this.__trailboxState;

    if (state && opts.captureBodies) {
      const requestBody = serializeBody(body, opts.mask, opts.maxBodyLength);
      if (requestBody) {
        state.requestBody = requestBody.body;
        state.requestBodyTruncated = requestBody.truncated;
      }
    }

    this.addEventListener('loadend', () => {
      const current = this.__trailboxState;
      if (!current) {
        return;
      }
      const responseHeaders = opts.captureHeaders
        ? parseRawHeaders(this.getAllResponseHeaders(), opts.mask)
        : undefined;
      const responseBody = opts.captureBodies
        ? captureXhrResponseBody(this, opts.mask, opts.maxBodyLength)
        : undefined;

      const payload: NetworkPayload = {
        url: current.url,
        method: current.method,
        status: this.status,
        durationMs: Math.round(performance.now() - started),
        requestHeaders: opts.captureHeaders ? current.requestHeaders : undefined,
        responseHeaders,
        requestBody: current.requestBody,
        requestBodyTruncated: current.requestBodyTruncated,
        responseBody: responseBody?.body,
        responseBodyTruncated: responseBody?.truncated,
      };

      const severity = this.status >= 400 ? 'warning' : 'info';
      capture(
        EventType.NETWORK,
        severity,
        `${current.method} ${current.url}`,
        payload as unknown as Record<string, unknown>
      );
    });
    originalSend.call(this, body);
  };
}

function captureFetchRequestBody(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  mask: boolean,
  maxBodyLength: number
): Promise<{ body: string; truncated: boolean } | undefined> {
  if (init && init.body !== undefined) {
    return Promise.resolve(serializeBody(init.body, mask, maxBodyLength));
  }
  if (isRequest(input)) {
    return input.clone().text()
      .then((text) => serializeBody(text, mask, maxBodyLength))
      .catch(() => undefined);
  }
  return Promise.resolve(undefined);
}

async function captureFetchResponseBody(
  response: Response,
  mask: boolean,
  maxBodyLength: number
): Promise<{ body: string; truncated: boolean } | undefined> {
  const contentType = (response.headers.get('content-type') || '').toLowerCase();
  const contentLengthRaw = response.headers.get('content-length');
  if (isLikelyBinaryContent(contentType)) {
    return { body: `[binary:${contentType || 'unknown'}]`, truncated: false };
  }
  if (contentLengthRaw) {
    const contentLength = Number(contentLengthRaw);
    if (Number.isFinite(contentLength) && contentLength > maxBodyLength * 10) {
      return { body: `[skipped:content-length ${contentLength}]`, truncated: true };
    }
  }
  try {
    const text = await response.clone().text();
    return serializeBody(text, mask, maxBodyLength);
  } catch {
    return undefined;
  }
}

function captureXhrResponseBody(
  xhr: XMLHttpRequest,
  mask: boolean,
  maxBodyLength: number
): { body: string; truncated: boolean } | undefined {
  if (xhr.responseType === '' || xhr.responseType === 'text') {
    return serializeBody(xhr.responseText || '', mask, maxBodyLength);
  }
  if (xhr.responseType === 'json') {
    return serializeBody(xhr.response, mask, maxBodyLength);
  }
  return {
    body: `[responseType:${xhr.responseType || 'unknown'}]`,
    truncated: false,
  };
}

function normalizeHeaders(
  headers: HeadersInit | undefined,
  mask: boolean
): Record<string, string> | undefined {
  if (!headers) {
    return undefined;
  }
  const out: Record<string, string> = {};
  const set = (key: string, value: string): void => {
    out[key.toLowerCase()] = sanitizeHeaderValue(key, value, mask);
  };
  if (headers instanceof Headers) {
    headers.forEach((value, key) => set(key, value));
    return out;
  }
  if (Array.isArray(headers)) {
    for (const [key, value] of headers) {
      set(key, String(value));
    }
    return out;
  }
  for (const [key, value] of Object.entries(headers)) {
    set(key, String(value));
  }
  return out;
}

function parseRawHeaders(raw: string, mask: boolean): Record<string, string> | undefined {
  if (!raw.trim()) {
    return undefined;
  }
  const out: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }
    const idx = line.indexOf(':');
    if (idx <= 0) {
      continue;
    }
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    out[key] = sanitizeHeaderValue(key, value, mask);
  }
  return out;
}

function sanitizeHeaderValue(name: string, value: string, mask: boolean): string {
  if (!mask) {
    return value;
  }
  if (SENSITIVE_HEADER_SET.has(name.toLowerCase())) {
    return '[REDACTED]';
  }
  return redactText(value);
}

function sanitizeUrl(rawUrl: string, mask: boolean): string {
  if (!mask) {
    return rawUrl;
  }
  try {
    const normalized = new URL(rawUrl, window.location.origin);
    for (const key of SENSITIVE_QUERY_KEYS) {
      if (normalized.searchParams.has(key)) {
        normalized.searchParams.set(key, '[REDACTED]');
      }
    }
    return normalized.toString();
  } catch {
    return rawUrl.replace(
      /(token|access_token|id_token|auth|authorization|password|apikey|api_key|secret)=([^&]+)/gi,
      '$1=[REDACTED]'
    );
  }
}

function serializeBody(
  value: unknown,
  mask: boolean,
  maxBodyLength: number
): { body: string; truncated: boolean } | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value === 'string') {
    return truncateBody(mask ? redactText(value) : value, maxBodyLength);
  }
  if (value instanceof URLSearchParams) {
    return truncateBody(mask ? redactText(value.toString()) : value.toString(), maxBodyLength);
  }
  if (typeof FormData !== 'undefined' && value instanceof FormData) {
    const out: Record<string, string> = {};
    value.forEach((item, key) => {
      if (typeof item === 'string') {
        out[key] = mask ? redactText(item) : item;
      } else {
        out[key] = `[file:${item.name};${item.size}]`;
      }
    });
    return truncateBody(JSON.stringify(out), maxBodyLength);
  }
  if (typeof Blob !== 'undefined' && value instanceof Blob) {
    return {
      body: `[blob:${value.type || 'unknown'};${value.size}]`,
      truncated: false,
    };
  }
  if (value instanceof ArrayBuffer) {
    return {
      body: `[arraybuffer:${value.byteLength}]`,
      truncated: false,
    };
  }
  if (ArrayBuffer.isView(value)) {
    return {
      body: `[typedarray:${value.byteLength}]`,
      truncated: false,
    };
  }
  return truncateBody(stringifyUnknown(value, mask, maxBodyLength), maxBodyLength);
}

function truncateBody(value: string, maxBodyLength: number): { body: string; truncated: boolean } {
  if (value.length <= maxBodyLength) {
    return { body: value, truncated: false };
  }
  return {
    body: `${value.slice(0, maxBodyLength)}...[truncated]`,
    truncated: true,
  };
}

function stringifyUnknown(value: unknown, mask: boolean, maxBodyLength: number): string {
  if (value instanceof Error) {
    return truncateBody(
      JSON.stringify({
        name: value.name,
        message: mask ? redactText(value.message) : value.message,
        stack: value.stack,
      }),
      maxBodyLength
    ).body;
  }
  if (typeof value === 'string') {
    return truncateBody(mask ? redactText(value) : value, maxBodyLength).body;
  }
  try {
    const raw = JSON.stringify(value);
    return truncateBody(mask ? redactText(raw) : raw, maxBodyLength).body;
  } catch {
    return truncateBody(String(value), maxBodyLength).body;
  }
}

function redactText(value: string): string {
  return value
    .replace(
      /(token|access_token|id_token|password|apikey|api_key|secret)\s*[:=]\s*["']?([^"'&\s]+)/gi,
      '$1=[REDACTED]'
    )
    .replace(/(authorization)\s*[:=]\s*["']?([^"'&\s]+)/gi, '$1=[REDACTED]');
}

function isLikelyBinaryContent(contentType: string): boolean {
  if (!contentType) {
    return false;
  }
  return contentType.startsWith('image/')
    || contentType.startsWith('audio/')
    || contentType.startsWith('video/')
    || contentType.includes('application/octet-stream')
    || contentType.includes('application/pdf');
}

function isRequest(input: RequestInfo | URL): input is Request {
  return typeof Request !== 'undefined' && input instanceof Request;
}
