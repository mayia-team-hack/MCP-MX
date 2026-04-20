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

function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function tokenize(text: string): string[] {
  return stripAccents(text)
    .toLowerCase()
    .split(/[\s,;.\-_]+/)
    .filter(Boolean);
}

function scoreDataset(
  tokens: string[],
  title: string,
  tags: Array<{ name: string }>,
  groups: Array<{ name: string; display_name: string }>,
): number {
  const tagNames = tags.map((t) => t.name);
  const groupNames = groups.flatMap((g) => [g.name, g.display_name]);
  const haystack = stripAccents([title, ...tagNames, ...groupNames].join(' ')).toLowerCase();
  let score = 0;
  for (const token of tokens) {
    if (haystack.includes(token)) score += 1;
  }
  // bonus for phrase match in title
  const phrase = tokens.join(' ');
  if (stripAccents(title).toLowerCase().includes(phrase)) score += 2;
  return score;
}

export function register(server: McpServer): void {
  const inputSchema: ToolSchema = {
    texto: z.string(),
    top_k: z.number().int().positive().optional().default(5),
  };

  const registerTool = server.tool.bind(server) as unknown as ToolRegistrar;

  registerTool(
    'buscar_datasets_por_texto',
    'Busca datasets por texto libre en título, tags y grupos. Útil cuando no conoces el name del dataset.',
    inputSchema,
    async (args: ToolArgs) => {
      const { texto, top_k } = args as { texto: string; top_k: number };
      try {
        const datasets = loader.getAll();

        if (datasets.length === 0) {
          return { content: [{ type: 'text', text: JSON.stringify([]) }] };
        }

        const tokens = tokenize(texto);
        const scored = datasets
          .map((d) => ({
            name: d.name,
            title: d.title,
            groups: d.groups,
            score: scoreDataset(tokens, d.title, d.tags, d.groups),
          }))
          .filter((d) => d.score > 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, top_k);

        return { content: [{ type: 'text', text: JSON.stringify(scored) }] };
      } catch (err) {
        const payload = loader.makeError(
          'DATASET_NOT_FOUND',
          `Error buscando datasets: ${(err as Error).message}`,
          'Verifica que el servidor esté correctamente inicializado.',
        );
        return { content: [{ type: 'text', text: JSON.stringify(payload) }], isError: true };
      }
    },
  );
}
