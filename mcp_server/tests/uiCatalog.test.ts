import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ALLOWED_VIEWS,
  MCP_MX_A2UI_VERSION,
  MCP_MX_UI_CATALOG_ID,
  buildUiCatalog,
} from '../src/core/uiCatalog';

test('buildUiCatalog exposes restricted catalog metadata for agents', () => {
  const catalog = buildUiCatalog() as {
    catalogId: string;
    version: string;
    allowedViews: Array<{ name: string }>;
    protocol: { actionTool: string; errorTool: string };
  };

  assert.equal(catalog.catalogId, MCP_MX_UI_CATALOG_ID);
  assert.equal(catalog.version, MCP_MX_A2UI_VERSION);
  assert.deepEqual(
    catalog.allowedViews.map((view) => view.name),
    Array.from(ALLOWED_VIEWS),
  );
  assert.equal(catalog.protocol.actionTool, 'action');
  assert.equal(catalog.protocol.errorTool, 'error');
});
