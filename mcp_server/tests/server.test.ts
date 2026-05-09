import test from 'node:test';
import assert from 'node:assert/strict';
import { createMcpServer } from '../src/server';

test('createMcpServer returns a disconnected MCP server instance', () => {
  const server = createMcpServer();

  assert.ok(server);
  assert.equal(server.isConnected(), false);
});
