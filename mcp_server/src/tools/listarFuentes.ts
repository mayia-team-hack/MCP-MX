import { z } from 'zod';
import { type McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as loader from '../core/loader';

type ToolSchema = Record<string, z.ZodTypeAny>;
type ToolArgs = Record<string, unknown>;
type ToolRegistrar = (
  name: string,
  description: string,
  schema: ToolSchema,
  handler: (args: ToolArgs) => Promise<unknown>,
) => void;

export function register(server: McpServer): void {
  const inputSchema: ToolSchema = { grupo: z.string().optional() };
  const registerTool = server.tool.bind(server) as unknown as ToolRegistrar;

  registerTool(
    'listar_fuentes_de_datos',
    'Lista todos los datasets disponibles en el catálogo. Filtra por grupo temático si se indica.',
    inputSchema,
    async (args: ToolArgs) => {
      const { grupo } = args as { grupo?: string };
      try {
        let datasets = loader.getAll();

        if (grupo) {
          const g = grupo.toLowerCase();
          datasets = datasets.filter((d) =>
            d.groups.some((gr) => gr.name.toLowerCase().includes(g)),
          );
        }

        const result = datasets.map(({ name, title, organization, groups, tags }) => ({
          name,
          title,
          organization: organization ? { name: organization.name, title: organization.title } : null,
          groups,
          tags,
        }));

        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      } catch (err) {
        const payload = loader.makeError(
          'DATASET_NOT_FOUND',
          `Error listando fuentes: ${(err as Error).message}`,
          'Verifica que el servidor esté correctamente inicializado.',
        );
        return { content: [{ type: 'text', text: JSON.stringify(payload) }], isError: true };
      }
    },
  );
}
