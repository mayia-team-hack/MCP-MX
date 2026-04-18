import { type McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as loader from '../core/loader';
import * as schemaCache from '../core/schemaCache';

const RESOURCE_URI = 'mcp://catalogo/esquemas';

export function register(server: McpServer): void {
  // Snapshot generated once at registration time (after schemaCache is populated)
  const catalog = buildCatalog();
  const catalogText = JSON.stringify(catalog, null, 2);

  server.resource('catalogo_esquemas', RESOURCE_URI, async () => ({
    contents: [
      {
        uri: RESOURCE_URI,
        mimeType: 'application/json',
        text: catalogText,
      },
    ],
  }));
}

function buildCatalog(): Record<string, unknown> {
  const datasets = loader.getAll();
  const entries: Record<string, unknown> = {};

  for (const dataset of datasets) {
    const meta = schemaCache.get(dataset.name);
    entries[dataset.name] = {
      title: dataset.title,
      organization: dataset.organization ?? null,
      groups: dataset.groups,
      tags: dataset.tags.map((t) => t.name),
      metadata_modified: dataset.metadata_modified ?? null,
      num_rows: dataset.num_rows ?? null,
      columns: meta?.columns ?? [],
    };
  }

  return { datasets: entries };
}
