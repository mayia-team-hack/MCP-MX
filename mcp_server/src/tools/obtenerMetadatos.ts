import { z } from 'zod';
import { type McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as loader from '../core/loader';
import * as schemaCache from '../core/schemaCache';

export function register(server: McpServer): void {
  server.tool(
    'obtener_metadatos_dataset',
    'Devuelve metadatos completos de un dataset: origen, organización, fechas, tamaño (filas/columnas).',
    { name: z.string() },
    async ({ name }) => {
      try {
        const entry = loader.getByName(name);

        if (!entry) {
          const payload = loader.makeError(
            'DATASET_NOT_FOUND',
            `Dataset no encontrado: "${name}".`,
            'Usa listar_fuentes_de_datos para ver los nombres disponibles.',
          );
          return { content: [{ type: 'text', text: JSON.stringify(payload) }], isError: true };
        }

        const result = {
          name: entry.name,
          title: entry.title,
          description: entry.description ?? null,
          organization: entry.organization ?? null,
          groups: entry.groups,
          tags: entry.tags,
          source_url: entry.source_url ?? null,
          metadata_created: entry.metadata_created ?? null,
          metadata_modified: entry.metadata_modified ?? null,
          num_rows: entry.num_rows ?? null,
          column_count: schemaCache.getColumnCount(name) ?? null,
        };

        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      } catch (err) {
        const payload = loader.makeError(
          'DATASET_NOT_FOUND',
          `Error obteniendo metadatos: ${(err as Error).message}`,
          'Verifica el name del dataset.',
        );
        return { content: [{ type: 'text', text: JSON.stringify(payload) }], isError: true };
      }
    },
  );
}
