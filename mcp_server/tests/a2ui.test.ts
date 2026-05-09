import test from 'node:test';
import assert from 'node:assert/strict';
import { buildA2UIResource, extractA2UIState } from '../src/core/a2ui';

test('extractA2UIState reads capabilities from initialize', () => {
  const state = extractA2UIState({
    method: 'initialize',
    params: {
      capabilities: {
        a2ui: {
          clientCapabilities: {
            'v0.9': {
              supportedCatalogIds: ['https://a2ui.org/specification/v0_9/basic_catalog.json'],
            },
          },
        },
      },
    },
  });

  assert.deepEqual(state, {
    clientCapabilities: {
      'v0.9': {
        supportedCatalogIds: ['https://a2ui.org/specification/v0_9/basic_catalog.json'],
      },
    },
  });
});

test('extractA2UIState reads capabilities from tool-call metadata', () => {
  const state = extractA2UIState({
    method: 'tools/call',
    params: {
      _meta: {
        a2ui: {
          clientCapabilities: {
            'v0.8': {
              supportedCatalogIds: ['catalog-a'],
            },
          },
        },
      },
    },
  });

  assert.deepEqual(state, {
    clientCapabilities: {
      'v0.8': {
        supportedCatalogIds: ['catalog-a'],
      },
    },
  });
});

test('buildA2UIResource produces embedded resource with A2UI mime type', () => {
  const resource = buildA2UIResource('a2ui://demo-surface', [{ version: 'v0.9' }]);

  assert.equal(resource.type, 'resource');
  assert.equal(resource.resource.uri, 'a2ui://demo-surface');
  assert.equal(resource.resource.mimeType, 'application/json+a2ui');
  assert.ok('text' in resource.resource);
  if ('text' in resource.resource) {
    assert.equal(resource.resource.text, JSON.stringify([{ version: 'v0.9' }]));
  }
});
