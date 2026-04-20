import { z } from 'zod';
import { type McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { makeError } from '../core/loader';

type ToolSchema = Record<string, z.ZodTypeAny>;
type ToolArgs = Record<string, unknown>;
type ToolRegistrar = (
  name: string,
  description: string,
  schema: ToolSchema,
  handler: (args: ToolArgs) => Promise<unknown>,
) => void;

// ── Formatters ────────────────────────────────────────────────────────────────

function toMarkdownTable(filas: Record<string, unknown>[], titulo?: string): string {
  if (filas.length === 0) return titulo ? `## ${titulo}\n\n_Sin resultados._` : '_Sin resultados._';

  const headers = Object.keys(filas[0]);
  const sep = headers.map((h) => '-'.repeat(Math.max(h.length, 3)));

  const lines: string[] = [];
  if (titulo) lines.push(`## ${titulo}\n`);
  lines.push(`| ${headers.join(' | ')} |`);
  lines.push(`| ${sep.join(' | ')} |`);
  for (const row of filas) {
    const cells = headers.map((h) => String(row[h] ?? '').replace(/\|/g, '\\|'));
    lines.push(`| ${cells.join(' | ')} |`);
  }
  return lines.join('\n');
}

function toCsv(filas: Record<string, unknown>[]): string {
  if (filas.length === 0) return '';
  const headers = Object.keys(filas[0]);

  function csvCell(val: unknown): string {
    const s = String(val ?? '');
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  }

  const rows = filas.map((row) => headers.map((h) => csvCell(row[h])).join(','));
  return [headers.join(','), ...rows].join('\n');
}

function toResumenNarrativo(
  filas: Record<string, unknown>[],
  titulo?: string,
): string {
  if (filas.length === 0) {
    return `${titulo ? titulo + ': ' : ''}No se encontraron resultados.`;
  }

  const headers = Object.keys(filas[0]);
  const lines: string[] = [];

  if (titulo) lines.push(`${titulo}`);
  lines.push(`Total de filas: ${filas.length}.`);
  lines.push(`Columnas (${headers.length}): ${headers.join(', ')}.`);

  const sample = filas.slice(0, 3);
  lines.push('');
  lines.push('Primeras filas:');
  for (const [i, row] of sample.entries()) {
    const preview = headers
      .slice(0, 5)
      .map((h) => `${h}: ${row[h] ?? 'N/A'}`)
      .join(', ');
    lines.push(`  ${i + 1}. ${preview}`);
  }

  return lines.join('\n');
}

// ── Tool ──────────────────────────────────────────────────────────────────────

export function register(server: McpServer): void {
  const inputSchema: ToolSchema = {
    filas: z.array(z.record(z.unknown())),
    formato: z.enum(['markdown_table', 'csv', 'json_pretty', 'resumen_narrativo']),
    titulo: z.string().optional(),
  };

  const registerTool = server.tool.bind(server) as unknown as ToolRegistrar;

  registerTool(
    'formatear_resultado',
    'Convierte filas de datos a markdown, CSV, JSON indentado o resumen narrativo. Sin llamadas externas.',
    inputSchema,
    async (args: ToolArgs) => {
      const { filas, formato, titulo } = args as {
        filas: Array<Record<string, unknown>>;
        formato: 'markdown_table' | 'csv' | 'json_pretty' | 'resumen_narrativo';
        titulo?: string;
      };
      try {
        let contenido: string;

        switch (formato) {
          case 'markdown_table':
            contenido = toMarkdownTable(filas as Record<string, unknown>[], titulo);
            break;
          case 'csv':
            contenido = toCsv(filas as Record<string, unknown>[]);
            break;
          case 'json_pretty':
            contenido = JSON.stringify(filas, null, 2);
            break;
          case 'resumen_narrativo':
            contenido = toResumenNarrativo(filas as Record<string, unknown>[], titulo);
            break;
          default:
            throw new Error(`Formato desconocido: ${String(formato)}`);
        }

        return {
          content: [{ type: 'text', text: JSON.stringify({ formato, contenido }) }],
        };
      } catch (err) {
        const payload = makeError(
          'INVALID_QUERY',
          `Error formateando resultado: ${(err as Error).message}`,
          'Verifica que las filas sean un arreglo de objetos planos y que el formato sea válido.',
        );
        return { content: [{ type: 'text', text: JSON.stringify(payload) }], isError: true };
      }
    },
  );
}
