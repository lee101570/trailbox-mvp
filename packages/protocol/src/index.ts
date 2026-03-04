export const EventType = {
  CONSOLE: 'console',
  ERROR: 'error',
  PROMISE_REJECTION: 'promise_rejection',
  NETWORK: 'network',
} as const;

export type EventTypeValues = (typeof EventType)[keyof typeof EventType];

export interface TrailboxEvent {
  type: EventTypeValues;
  severity: string;
  message: string;
  payload: Record<string, unknown>;
  appName: string;
  source: 'web';
  occurredAt: string;
}

export function createEvent({
  type,
  severity = 'info',
  message = '',
  payload = {},
  appName = 'unknown',
  source = 'web',
}: {
  type: EventTypeValues;
  severity?: string;
  message?: string;
  payload?: Record<string, unknown>;
  appName?: string;
  source?: 'web';
}): TrailboxEvent {
  return {
    type,
    severity,
    message,
    payload,
    appName,
    source,
    occurredAt: new Date().toISOString(),
  };
}

