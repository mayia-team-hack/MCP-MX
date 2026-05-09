import { type McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  MCP_MX_UI_RESOURCE_URI,
  buildUiCatalog,
} from '../core/uiCatalog';

export function register(server: McpServer): void {
  const catalog = buildUiCatalog();
  const text = JSON.stringify(catalog, null, 2);

  server.resource('catalogo_ui_a2ui', MCP_MX_UI_RESOURCE_URI, async () => ({
    contents: [
      {
        uri: MCP_MX_UI_RESOURCE_URI,
        mimeType: 'application/json',
        text,
      },
    ],
  }));
}
