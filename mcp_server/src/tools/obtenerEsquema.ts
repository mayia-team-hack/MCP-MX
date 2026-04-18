import { z } from 'zod';
import { type McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { makeError } from '../core/loader';
import * as schemaCache from '../core/schemaCache';

export function register(server: McpServer): void {
  server.tool(
    'obtener_esquema_dataset',
    'Devuelve los nombres y tipos de columnas de un dataset. Llama a esta tool antes de escribir cualquier query.',
    { dataset_id: z.string() },
    async ({ dataset_id }) => {
      try {
        const columns = schemaCache.getColumns(dataset_id);

        if (!columns) {
          const payload = makeError(
            'DATASET_NOT_FOUND',
            `No se encontró el esquema para el dataset "${dataset_id}".`,
            'Usa listar_fuentes_de_datos para ver los dataset_id disponibles.',
          );
          return { content: [{ type: 'text', text: JSON.stringify(payload) }], isError: true };
        }

        return { content: [{ type: 'text', text: JSON.stringify(columns) }] };
      } catch (err) {
        const payload = makeError(
          'SQL_EXECUTION_ERROR',
          `Error obteniendo esquema: ${(err as Error).message}`,
          'Verifica que el servidor esté correctamente inicializado.',
        );
        return { content: [{ type: 'text', text: JSON.stringify(payload) }], isError: true };
      }
    },
  );
}
