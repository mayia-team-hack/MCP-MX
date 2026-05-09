import test from 'node:test';
import assert from 'node:assert/strict';
import * as sessionStore from '../src/core/sessionStore';

test('sessionStore tracks and clears A2UI capabilities per session', () => {
  const sessionId = 'session-test-1';

  sessionStore.open(sessionId);
  sessionStore.setClientInfo(sessionId, { name: 'ag-ui-client', version: '1.0.0' });
  sessionStore.setA2UIState(sessionId, {
    clientCapabilities: {
      'v0.9': {
        supportedCatalogIds: ['catalog-main'],
      },
    },
  });

  const session = sessionStore.get(sessionId);
  assert.ok(session);
  assert.equal(session?.clientInfo?.name, 'ag-ui-client');
  assert.deepEqual(sessionStore.getA2UIClientCapabilities(sessionId), {
    'v0.9': {
      supportedCatalogIds: ['catalog-main'],
    },
  });

  sessionStore.close(sessionId);
  assert.equal(sessionStore.get(sessionId), undefined);
  assert.equal(sessionStore.getA2UIClientCapabilities(sessionId), undefined);
});
