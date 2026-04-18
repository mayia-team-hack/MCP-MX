import { z } from 'zod';
import { type McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as loader from '../core/loader';
import * as schemaCache from '../core/schemaCache';
import * as engine from '../core/duckdbEngine';

export function register(server: McpServer): void {
  server.tool(
    'buscar_valor_en_columna',
    'Busca filas donde una columna contiene un texto (búsqueda parcial, case-insensitive).',
    {
      name: z.string(),
      columna: z.string(),
      texto: z.string(),
      limit: z.number().int().positive().optional().default(50),
    },
    async ({ name, columna, texto, limit }) => {
      try {
        const pathOrErr = loader.getParquetPath(name);
        if (typeof pathOrErr !== 'string') {
          return { content: [{ type: 'text', text: JSON.stringify(pathOrErr) }], isError: true };
        }

        // Validate column exists
        const meta = schemaCache.get(name);
        if (meta) {
          const valid = new Set(meta.columns.map((c) => c.column_name));
          if (!valid.has(columna)) {
            const payload = loader.makeError(
              'INVALID_QUERY',
              `Columna desconocida: "${columna}".`,
              `Columnas disponibles: ${[...valid].join(', ')}`,
            );
            return { content: [{ type: 'text', text: JSON.stringify(payload) }], isError: true };
          }
        }

        const escapedPath = pathOrErr.replace(/'/g, "''");
        const escapedTexto = texto.replace(/'/g, "''");
        const query = `SELECT * FROM '${escapedPath}' WHERE "${columna}" ILIKE '%${escapedTexto}%' LIMIT ${limit}`;

        const result = await engine.execute(pathOrErr, query);
        const isErr = !Array.isArray(result) && result.error;
        return {
          content: [{ type: 'text', text: JSON.stringify(result) }],
          isError: isErr,
        };
      } catch (err) {
        const payload = loader.makeError(
          'SQL_EXECUTION_ERROR',
          `Error buscando valor: ${(err as Error).message}`,
          'Verifica el nombre de la columna y el texto de búsqueda.',
        );
        return { content: [{ type: 'text', text: JSON.stringify(payload) }], isError: true };
      }
    },
  );
}
