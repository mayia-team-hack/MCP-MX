import { z } from 'zod';
import { type McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as loader from '../core/loader';
import * as engine from '../core/duckdbEngine';

export function register(server: McpServer): void {
  server.tool(
    'consultar_datos_sql',
    [
      'Ejecuta una query SQL SELECT contra un dataset. Usa dataset_id como nombre de tabla.',
      'LIMIT 100 se aplica automáticamente si no está en la query.',
      'Ejemplo: SELECT col1, col2 FROM delitos_2024 WHERE col1 = \'valor\'',
    ].join(' '),
    {
      dataset_id: z.string(),
      query_sql: z.string(),
    },
    async ({ dataset_id, query_sql }) => {
      try {
        const pathOrErr = loader.getPath(dataset_id);
        if (typeof pathOrErr !== 'string') {
          return { content: [{ type: 'text', text: JSON.stringify(pathOrErr) }], isError: true };
        }

        // Pass dataset_id as viewName so users write: SELECT … FROM delitos_2024
        const result = await engine.execute(pathOrErr, query_sql, dataset_id);

        const isErr = !Array.isArray(result) && result.error;
        return {
          content: [{ type: 'text', text: JSON.stringify(result) }],
          isError: isErr,
        };
      } catch (err) {
        const payload = loader.makeError(
          'SQL_EXECUTION_ERROR',
          `Error ejecutando SQL: ${(err as Error).message}`,
          'Revisa la sintaxis de tu query y los nombres de columnas.',
        );
        return { content: [{ type: 'text', text: JSON.stringify(payload) }], isError: true };
      }
    },
  );
}
