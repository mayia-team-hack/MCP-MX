import { z } from 'zod';
import { type McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as loader from '../core/loader';

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[\s,;.]+/)
    .filter(Boolean);
}

function scoreDataset(
  tokens: string[],
  title: string,
  tags: string[],
  categories: string[],
): number {
  const haystack = [title, ...tags, ...categories].join(' ').toLowerCase();
  let score = 0;
  for (const token of tokens) {
    if (haystack.includes(token)) score += 1;
  }
  // bonus for phrase match in title
  const phrase = tokens.join(' ');
  if (title.toLowerCase().includes(phrase)) score += 2;
  return score;
}

export function register(server: McpServer): void {
  server.tool(
    'buscar_datasets_por_texto',
    'Busca datasets por texto libre en título, tags y categorías. Útil cuando no conoces el dataset_id.',
    {
      texto: z.string(),
      top_k: z.number().int().positive().optional().default(5),
    },
    async ({ texto, top_k }) => {
      try {
        const datasets = loader.getAll();

        if (datasets.length === 0) {
          return { content: [{ type: 'text', text: JSON.stringify([]) }] };
        }

        const tokens = tokenize(texto);
        const scored = datasets
          .map((d) => ({
            dataset_id: d.dataset_id,
            title: d.title,
            categories: d.categories,
            score: scoreDataset(tokens, d.title, d.tags, d.categories),
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
