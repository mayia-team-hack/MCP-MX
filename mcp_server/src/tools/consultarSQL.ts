import { z } from 'zod';
import { type McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as loader from '../core/loader';
import * as engine from '../core/duckdbEngine';

type ToolSchema = Record<string, z.ZodTypeAny>;
type ToolArgs = Record<string, unknown>;
type ToolRegistrar = (
  name: string,
  description: string,
  schema: ToolSchema,
  handler: (args: ToolArgs) => Promise<unknown>,
) => void;

export function register(server: McpServer): void {
  const inputSchema: ToolSchema = {
    name: z.string(),
    query_sql: z.string(),
  };

  const registerTool = server.tool.bind(server) as unknown as ToolRegistrar;

  registerTool(
    'consultar_datos_sql',
    [
      'Ejecuta una query SQL SELECT contra un dataset. Usa el name (slug) como nombre de tabla.',
      'LIMIT 100 se aplica automáticamente si no está en la query.',
      'Ejemplo: SELECT col1, col2 FROM "carpetas-de-investigacion-cdmx-2024" WHERE col1 = \'valor\'',
    ].join(' '),
    inputSchema,
    async (args: ToolArgs) => {
      const { name, query_sql } = args as { name: string; query_sql: string };
      try {
        const pathOrErr = loader.getParquetPath(name);
        if (typeof pathOrErr !== 'string') {
          return { content: [{ type: 'text', text: JSON.stringify(pathOrErr) }], isError: true };
        }

        // Pass name as viewName — engine creates a quoted DuckDB view for the slug
        const result = await engine.execute(pathOrErr, query_sql, name);

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
