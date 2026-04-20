import { z } from 'zod';
import { type McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { makeError } from '../core/loader';
import * as schemaCache from '../core/schemaCache';

type ToolSchema = Record<string, z.ZodTypeAny>;
type ToolArgs = Record<string, unknown>;
type ToolRegistrar = (
  name: string,
  description: string,
  schema: ToolSchema,
  handler: (args: ToolArgs) => Promise<unknown>,
) => void;

export function register(server: McpServer): void {
  const inputSchema: ToolSchema = { name: z.string() };
  const registerTool = server.tool.bind(server) as unknown as ToolRegistrar;

  registerTool(
    'obtener_esquema_dataset',
    'Devuelve los nombres y tipos de columnas de un dataset. Llama a esta tool antes de escribir cualquier query.',
    inputSchema,
    async (args: ToolArgs) => {
      const { name } = args as { name: string };
      try {
        const columns = schemaCache.getColumns(name);

        if (!columns) {
          const payload = makeError(
            'DATASET_NOT_FOUND',
            `No se encontró el esquema para el dataset "${name}".`,
            'Usa listar_fuentes_de_datos para ver los nombres disponibles.',
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
