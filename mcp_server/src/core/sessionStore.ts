import { type A2UIClientCapabilities, type SessionA2UIState } from './a2ui';

export interface ClientDescriptor {
  name?: string;
  version?: string;
}

export interface SessionState {
  sessionId: string;
  createdAt: string;
  clientInfo?: ClientDescriptor;
  a2ui?: SessionA2UIState;
  lastSeenAt?: string;
}

const sessions = new Map<string, SessionState>();

function nowIso(): string {
  return new Date().toISOString();
}

export function open(sessionId: string): SessionState {
  const state: SessionState = {
    sessionId,
    createdAt: nowIso(),
    lastSeenAt: nowIso(),
  };
  sessions.set(sessionId, state);
  return state;
}

export function touch(sessionId: string): void {
  const current = sessions.get(sessionId);
  if (current) {
    current.lastSeenAt = nowIso();
  }
}

export function close(sessionId: string): void {
  sessions.delete(sessionId);
}

export function setClientInfo(sessionId: string, clientInfo?: ClientDescriptor): void {
  const current = sessions.get(sessionId);
  if (!current) {
    return;
  }

  current.clientInfo = clientInfo;
  current.lastSeenAt = nowIso();
}

export function setA2UIState(sessionId: string, a2ui?: SessionA2UIState): void {
  const current = sessions.get(sessionId);
  if (!current || !a2ui) {
    return;
  }

  current.a2ui = a2ui;
  current.lastSeenAt = nowIso();
}

export function get(sessionId: string): SessionState | undefined {
  return sessions.get(sessionId);
}

export function getA2UIClientCapabilities(
  sessionId?: string,
): A2UIClientCapabilities | undefined {
  if (!sessionId) {
    return undefined;
  }

  return sessions.get(sessionId)?.a2ui?.clientCapabilities;
}
