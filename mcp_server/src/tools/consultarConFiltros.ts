import { z } from 'zod';
import { type McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as loader from '../core/loader';
import * as schemaCache from '../core/schemaCache';
import * as engine from '../core/duckdbEngine';

// ── SQL building helpers ──────────────────────────────────────────────────────

const ALLOWED_OPERATORS = new Set(['=', '>', '<', '>=', '<=', '!=', 'LIKE', 'IN'] as const);
type Operador = '=' | '>' | '<' | '>=' | '<=' | '!=' | 'LIKE' | 'IN';

function escapeStr(v: string): string {
  return `'${v.replace(/'/g, "''")}'`;
}

function buildCondition(columna: string, operador: Operador, valor: string | number | string[]): string {
  const col = `"${columna}"`;
  if (operador === 'IN') {
    const vals = (Array.isArray(valor) ? valor : [String(valor)])
      .map((v) => escapeStr(String(v)))
      .join(', ');
    return `${col} IN (${vals})`;
  }
  const val = typeof valor === 'number' ? String(valor) : escapeStr(String(valor));
  return `${col} ${operador} ${val}`;
}

// ── Schema ────────────────────────────────────────────────────────────────────

const OperadorEnum = z.enum(['=', '>', '<', '>=', '<=', '!=', 'LIKE', 'IN']);

const FiltroSchema = z.object({
  columna: z.string(),
  operador: OperadorEnum,
  valor: z.union([z.string(), z.number(), z.array(z.string())]),
});

// ── Tool ──────────────────────────────────────────────────────────────────────

export function register(server: McpServer): void {
  server.tool(
    'consultar_con_filtros',
    'Consulta un dataset aplicando filtros y seleccionando columnas específicas. Más seguro que SQL crudo.',
    {
      dataset_id: z.string(),
      filtros: z.array(FiltroSchema),
      columnas_salida: z.array(z.string()).optional(),
      limit: z.number().int().positive().optional().default(100),
    },
    async ({ dataset_id, filtros, columnas_salida, limit }) => {
      try {
        const pathOrErr = loader.getPath(dataset_id);
        if (typeof pathOrErr !== 'string') {
          return { content: [{ type: 'text', text: JSON.stringify(pathOrErr) }], isError: true };
        }

        // Validate column names against schema to block injection via column names
        const meta = schemaCache.get(dataset_id);
        if (meta) {
          const valid = new Set(meta.columns.map((c) => c.column_name));
          for (const f of filtros) {
            if (!valid.has(f.columna)) {
              const payload = loader.makeError(
                'INVALID_QUERY',
                `Columna desconocida en filtro: "${f.columna}".`,
                `Columnas disponibles: ${[...valid].join(', ')}`,
              );
              return { content: [{ type: 'text', text: JSON.stringify(payload) }], isError: true };
            }
          }
          if (columnas_salida) {
            for (const c of columnas_salida) {
              if (!valid.has(c)) {
                const payload = loader.makeError(
                  'INVALID_QUERY',
                  `Columna de salida desconocida: "${c}".`,
                  `Columnas disponibles: ${[...valid].join(', ')}`,
                );
                return { content: [{ type: 'text', text: JSON.stringify(payload) }], isError: true };
              }
            }
          }
        }

        const selectCols =
          columnas_salida && columnas_salida.length > 0
            ? columnas_salida.map((c) => `"${c}"`).join(', ')
            : '*';

        const escapedPath = pathOrErr.replace(/'/g, "''");
        const whereParts = filtros.map((f) =>
          buildCondition(f.columna, f.operador as Operador, f.valor),
        );
        const where = whereParts.length > 0 ? `WHERE ${whereParts.join(' AND ')}` : '';
        const query = `SELECT ${selectCols} FROM '${escapedPath}' ${where} LIMIT ${limit}`;

        // Execute without viewName — SQL references file path directly
        const result = await engine.execute(pathOrErr, query);
        const isErr = !Array.isArray(result) && result.error;
        return {
          content: [{ type: 'text', text: JSON.stringify(result) }],
          isError: isErr,
        };
      } catch (err) {
        const payload = loader.makeError(
          'SQL_EXECUTION_ERROR',
          `Error consultando con filtros: ${(err as Error).message}`,
          'Verifica los nombres de columna y los valores de los filtros.',
        );
        return { content: [{ type: 'text', text: JSON.stringify(payload) }], isError: true };
      }
    },
  );
}
