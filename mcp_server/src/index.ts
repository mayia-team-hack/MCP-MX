import * as path from 'path';
import { randomUUID } from 'crypto';
import { type IncomingMessage, type ServerResponse } from 'http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { createMcpServer, bootstrapData, warmSchemaCache } from './server';
import { extractA2UIState } from './core/a2ui';
import * as sessionStore from './core/sessionStore';

// ── Resolve SHARED_DATA_PATH ─────────────────────────────────────────────────

function resolveSharedDataPath(): string {
  // 1. --data-path <value> or --data-path=<value> CLI flag
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--data-path' && argv[i + 1]) {
      return argv[i + 1];
    }
    if (argv[i].startsWith('--data-path=')) {
      return argv[i].slice('--data-path='.length);
    }
  }

  // 2. SHARED_DATA_PATH environment variable
  if (process.env.SHARED_DATA_PATH) {
    return process.env.SHARED_DATA_PATH;
  }

  // 3. Default: repo root shared_data/
  return path.resolve(__dirname, '../../shared_data');
}

type TransportMode = 'stdio' | 'streamable-http';

interface RuntimeOptions {
  sharedDataPath: string;
  transportMode: TransportMode;
  host: string;
  port: number;
}

interface StatefulConnection {
  server: McpServer;
  transport: StreamableHTTPServerTransport;
}

type HttpRequestLike = IncomingMessage & { body?: unknown };
type HttpResponseLike = ServerResponse;

function sendJson(res: HttpResponseLike, statusCode: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.end(body);
}

function sendText(res: HttpResponseLike, statusCode: number, payload: string): void {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.end(payload);
}

function resolveArgValue(name: string): string | undefined {
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === name && argv[i + 1]) {
      return argv[i + 1];
    }

    if (argv[i].startsWith(`${name}=`)) {
      return argv[i].slice(name.length + 1);
    }
  }

  return undefined;
}

function resolveTransportMode(): TransportMode {
  const cliValue = resolveArgValue('--transport');
  const envValue = process.env.MCP_TRANSPORT;
  const raw = (cliValue ?? envValue ?? 'stdio').toLowerCase();

  if (raw === 'streamable-http' || raw === 'http') {
    return 'streamable-http';
  }

  return 'stdio';
}

function resolveRuntimeOptions(): RuntimeOptions {
  const host = resolveArgValue('--host') ?? process.env.MCP_HOST ?? '127.0.0.1';
  const rawPort = resolveArgValue('--port') ?? process.env.MCP_PORT ?? '3001';
  const port = Number.parseInt(rawPort, 10);

  return {
    sharedDataPath: resolveSharedDataPath(),
    transportMode: resolveTransportMode(),
    host,
    port: Number.isFinite(port) ? port : 3001,
  };
}

function isInitializeRequest(body: unknown): body is {
  method: 'initialize';
  params?: {
    clientInfo?: { name?: string; version?: string };
  };
} {
  return !!body && typeof body === 'object' && (body as { method?: unknown }).method === 'initialize';
}

async function startStdioMode(): Promise<void> {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error('[mcp-mx] MCP server started (STDIO transport)');
}

async function startStreamableHttpMode(options: RuntimeOptions): Promise<void> {
  const app = createMcpExpressApp({ host: options.host });
  const connections = new Map<string, StatefulConnection>();
  const closingSessions = new Set<string>();

  const closeConnection = async (sessionId: string): Promise<void> => {
    if (closingSessions.has(sessionId)) {
      return;
    }

    const current = connections.get(sessionId);
    if (!current) {
      sessionStore.close(sessionId);
      return;
    }

    closingSessions.add(sessionId);
    connections.delete(sessionId);
    sessionStore.close(sessionId);

    try {
      await current.transport.close();
      await current.server.close();
    } finally {
      closingSessions.delete(sessionId);
    }
  };

  app.post('/mcp', async (req: HttpRequestLike, res: HttpResponseLike) => {
    const body = req.body;
    const headerSessionId = typeof req.headers['mcp-session-id'] === 'string'
      ? req.headers['mcp-session-id']
      : undefined;

    try {
      if (isInitializeRequest(body)) {
        const server = createMcpServer();
        const pendingKey = `pending-${randomUUID()}`;
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (sessionId) => {
            sessionStore.open(sessionId);
            sessionStore.setClientInfo(sessionId, body.params?.clientInfo);
            sessionStore.setA2UIState(sessionId, extractA2UIState(body));
          },
          onsessionclosed: async (sessionId) => {
            await closeConnection(sessionId);
          },
        });

        connections.set(pendingKey, { server, transport });
        await server.connect(transport);
        await transport.handleRequest(req, res, body);

        if (transport.sessionId) {
          connections.delete(pendingKey);
          connections.set(transport.sessionId, { server, transport });
        } else {
          connections.delete(pendingKey);
        }

        return;
      }

      if (!headerSessionId) {
        sendJson(res, 400, {
          jsonrpc: '2.0',
          error: {
            code: -32000,
            message: 'Missing MCP session ID',
          },
          id: null,
        });
        return;
      }

      const connection = connections.get(headerSessionId);
      if (!connection) {
        sendJson(res, 404, {
          jsonrpc: '2.0',
          error: {
            code: -32001,
            message: `Unknown MCP session: ${headerSessionId}`,
          },
          id: null,
        });
        return;
      }

      sessionStore.touch(headerSessionId);
      sessionStore.setA2UIState(headerSessionId, extractA2UIState(body));
      await connection.transport.handleRequest(req, res, body);
    } catch (error) {
      console.error('[mcp-mx] Error handling POST /mcp:', error);
      if (!res.headersSent) {
        sendJson(res, 500, {
          jsonrpc: '2.0',
          error: {
            code: -32603,
            message: 'Internal server error',
          },
          id: null,
        });
      }
    }
  });

  app.get('/mcp', async (req: HttpRequestLike, res: HttpResponseLike) => {
    const sessionId = typeof req.headers['mcp-session-id'] === 'string'
      ? req.headers['mcp-session-id']
      : undefined;

    if (!sessionId) {
      sendText(res, 400, 'Missing MCP session ID');
      return;
    }

    const connection = connections.get(sessionId);
    if (!connection) {
      sendText(res, 404, 'Session not found');
      return;
    }

    sessionStore.touch(sessionId);
    await connection.transport.handleRequest(req, res);
  });

  app.delete('/mcp', async (req: HttpRequestLike, res: HttpResponseLike) => {
    const sessionId = typeof req.headers['mcp-session-id'] === 'string'
      ? req.headers['mcp-session-id']
      : undefined;

    if (!sessionId) {
      sendText(res, 400, 'Missing MCP session ID');
      return;
    }

    const connection = connections.get(sessionId);
    if (!connection) {
      sendText(res, 404, 'Session not found');
      return;
    }

    await connection.transport.handleRequest(req, res);
  });

  app.get('/health', (_req: HttpRequestLike, res: HttpResponseLike) => {
    sendJson(res, 200, {
      name: 'mcp-mx',
      transport: 'streamable-http',
      sessions: connections.size,
      status: 'ok',
    });
  });

  const shutdown = async (): Promise<void> => {
    for (const sessionId of Array.from(connections.keys())) {
      await closeConnection(sessionId);
    }
    process.exit(0);
  };

  process.on('SIGINT', () => {
    void shutdown();
  });

  process.on('SIGTERM', () => {
    void shutdown();
  });

  app.listen(options.port, options.host, () => {
    console.error(
      `[mcp-mx] MCP server started (Streamable HTTP transport) on http://${options.host}:${options.port}/mcp`,
    );
  });
}

// ── Bootstrap ────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const options = resolveRuntimeOptions();
  console.error(`[mcp-mx] SHARED_DATA_PATH = ${options.sharedDataPath}`);

  try {
    bootstrapData(options.sharedDataPath);
  } catch (err) {
    console.error('[mcp-mx] Fatal error initialising loader:', err);
    process.exit(1);
  }

  await warmSchemaCache();

  if (options.transportMode === 'streamable-http') {
    await startStreamableHttpMode(options);
    return;
  }

  await startStdioMode();
}

main().catch((err) => {
  console.error('[mcp-mx] Unhandled error:', err);
  process.exit(1);
});
