import { z } from 'zod';
import { type McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as loader from '../core/loader';

export function register(server: McpServer): void {
  server.tool(
    'listar_fuentes_de_datos',
    'Lista todos los datasets disponibles en el catálogo. Filtra por categoría si se indica.',
    { categoria: z.string().optional() },
    async ({ categoria }) => {
      try {
        let datasets = loader.getAll();

        if (categoria) {
          const cat = categoria.toLowerCase();
          datasets = datasets.filter((d) =>
            d.categories.some((c) => c.toLowerCase().includes(cat)),
          );
        }

        const result = datasets.map(({ dataset_id, title, organization, categories, tags }) => ({
          dataset_id,
          title,
          organization: organization ?? null,
          categories,
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
