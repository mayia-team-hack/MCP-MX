import { type AllowedView } from './uiCatalog';

export interface SurfaceRenderState {
  surfaceId: string;
  view: AllowedView;
  title: string;
  toolName: string;
  rowCount: number;
  rowsPreview: Record<string, unknown>[];
  lastRenderedAt: string;
}

export interface SurfaceActionState {
  name: string;
  context: Record<string, unknown>;
  receivedAt: string;
}

export interface SurfaceErrorState {
  code: string;
  message: string;
  surfaceId: string;
  receivedAt: string;
}

export interface UiSessionContext {
  sessionId: string;
  surfaces: Record<string, SurfaceRenderState>;
  actions: SurfaceActionState[];
  errors: SurfaceErrorState[];
  updatedAt: string;
}

const sessions = new Map<string, UiSessionContext>();

function nowIso(): string {
  return new Date().toISOString();
}

function getSessionKey(sessionId?: string): string {
  return sessionId ?? 'stateless';
}

function ensureSession(sessionId?: string): UiSessionContext {
  const key = getSessionKey(sessionId);
  const existing = sessions.get(key);
  if (existing) {
    return existing;
  }

  const created: UiSessionContext = {
    sessionId: key,
    surfaces: {},
    actions: [],
    errors: [],
    updatedAt: nowIso(),
  };
  sessions.set(key, created);
  return created;
}

export function saveRender(
  sessionId: string | undefined,
  render: Omit<SurfaceRenderState, 'lastRenderedAt'>,
): void {
  const session = ensureSession(sessionId);
  session.surfaces[render.surfaceId] = {
    ...render,
    lastRenderedAt: nowIso(),
  };
  session.updatedAt = nowIso();
}

export function saveAction(
  sessionId: string | undefined,
  action: Omit<SurfaceActionState, 'receivedAt'>,
): void {
  const session = ensureSession(sessionId);
  session.actions.unshift({
    ...action,
    receivedAt: nowIso(),
  });
  session.actions = session.actions.slice(0, 20);
  session.updatedAt = nowIso();
}

export function saveError(
  sessionId: string | undefined,
  error: Omit<SurfaceErrorState, 'receivedAt'>,
): void {
  const session = ensureSession(sessionId);
  session.errors.unshift({
    ...error,
    receivedAt: nowIso(),
  });
  session.errors = session.errors.slice(0, 20);
  session.updatedAt = nowIso();
}

export function getContext(sessionId?: string): UiSessionContext | undefined {
  return sessions.get(getSessionKey(sessionId));
}
