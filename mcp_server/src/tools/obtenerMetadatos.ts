import { z } from 'zod';
import { type McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as loader from '../core/loader';
import * as schemaCache from '../core/schemaCache';

export function register(server: McpServer): void {
  server.tool(
    'obtener_metadatos_dataset',
    'Devuelve metadatos completos de un dataset: origen, organización, fechas, tamaño (filas/columnas).',
    { dataset_id: z.string() },
    async ({ dataset_id }) => {
      try {
        const all = loader.getAll();
        const entry = all.find((d) => d.dataset_id === dataset_id);

        if (!entry) {
          const payload = loader.makeError(
            'DATASET_NOT_FOUND',
            `Dataset no encontrado: "${dataset_id}".`,
            'Usa listar_fuentes_de_datos para ver los dataset_id disponibles.',
          );
          return { content: [{ type: 'text', text: JSON.stringify(payload) }], isError: true };
        }

        const meta = schemaCache.get(dataset_id);

        const result = {
          dataset_id: entry.dataset_id,
          title: entry.title,
          organization: entry.organization ?? null,
          categories: entry.categories,
          tags: entry.tags,
          last_updated: entry.last_updated ?? null,
          file_path: entry.file_path,
          row_count: meta?.row_count ?? null,
          column_count: meta?.columns.length ?? null,
        };

        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      } catch (err) {
        const payload = loader.makeError(
          'DATASET_NOT_FOUND',
          `Error obteniendo metadatos: ${(err as Error).message}`,
          'Verifica el dataset_id.',
        );
        return { content: [{ type: 'text', text: JSON.stringify(payload) }], isError: true };
      }
    },
  );
}
