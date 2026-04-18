import { z } from 'zod';
import { type McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as loader from '../core/loader';
import * as schemaCache from '../core/schemaCache';
import * as engine from '../core/duckdbEngine';

// ── SQL helpers ───────────────────────────────────────────────────────────────

function escapeStr(v: string): string {
  return `'${v.replace(/'/g, "''")}'`;
}

type Operador = '=' | '>' | '<' | '>=' | '<=' | '!=' | 'LIKE' | 'IN';

function buildCondition(
  columna: string,
  operador: Operador,
  valor: string | number | string[],
): string {
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

const FiltroSchema = z.object({
  columna: z.string(),
  operador: z.enum(['=', '>', '<', '>=', '<=', '!=', 'LIKE', 'IN']),
  valor: z.union([z.string(), z.number(), z.array(z.string())]),
});

const MetricaSchema = z.object({
  columna: z.string(),
  funcion: z.enum(['COUNT', 'SUM', 'AVG', 'MIN', 'MAX']),
});

// ── Tool ──────────────────────────────────────────────────────────────────────

export function register(server: McpServer): void {
  server.tool(
    'agregar_datos',
    'Agrupa y agrega datos de un dataset (GROUP BY). Soporta COUNT, SUM, AVG, MIN, MAX.',
    {
      name: z.string(),
      agrupar_por: z.array(z.string()),
      metricas: z.array(MetricaSchema),
      filtros: z.array(FiltroSchema).optional().default([]),
      limit: z.number().int().positive().optional().default(100),
    },
    async ({ name, agrupar_por, metricas, filtros, limit }) => {
      try {
        const pathOrErr = loader.getParquetPath(name);
        if (typeof pathOrErr !== 'string') {
          return { content: [{ type: 'text', text: JSON.stringify(pathOrErr) }], isError: true };
        }

        // Validate all columns against schema
        const meta = schemaCache.get(name);
        if (meta) {
          const valid = new Set(meta.columns.map((c) => c.column_name));
          for (const col of agrupar_por) {
            if (!valid.has(col)) {
              const payload = loader.makeError(
                'INVALID_QUERY',
                `Columna de agrupación desconocida: "${col}".`,
                `Columnas disponibles: ${[...valid].join(', ')}`,
              );
              return { content: [{ type: 'text', text: JSON.stringify(payload) }], isError: true };
            }
          }
          for (const m of metricas) {
            if (m.columna !== '*' && !valid.has(m.columna)) {
              const payload = loader.makeError(
                'INVALID_QUERY',
                `Columna de métrica desconocida: "${m.columna}".`,
                `Columnas disponibles: ${[...valid].join(', ')}`,
              );
              return { content: [{ type: 'text', text: JSON.stringify(payload) }], isError: true };
            }
          }
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
        }

        const escapedPath = pathOrErr.replace(/'/g, "''");

        const groupCols = agrupar_por.map((c) => `"${c}"`).join(', ');
        const metricExprs = metricas
          .map((m) => {
            const colExpr = m.columna === '*' ? '*' : `"${m.columna}"`;
            const alias = m.columna === '*' ? `${m.funcion}_ALL` : `${m.columna}_${m.funcion}`;
            return `${m.funcion}(${colExpr}) AS "${alias}"`;
          })
          .join(', ');

        const selectCols = [groupCols, metricExprs].filter(Boolean).join(', ');

        const whereParts = filtros.map((f) =>
          buildCondition(f.columna, f.operador as Operador, f.valor),
        );
        const where = whereParts.length > 0 ? `WHERE ${whereParts.join(' AND ')}` : '';

        const query =
          `SELECT ${selectCols} FROM '${escapedPath}' ` +
          `${where} GROUP BY ${groupCols} LIMIT ${limit}`;

        const result = await engine.execute(pathOrErr, query);
        const isErr = !Array.isArray(result) && result.error;
        return {
          content: [{ type: 'text', text: JSON.stringify(result) }],
          isError: isErr,
        };
      } catch (err) {
        const payload = loader.makeError(
          'SQL_EXECUTION_ERROR',
          `Error agregando datos: ${(err as Error).message}`,
          'Verifica los nombres de columna y las métricas.',
        );
        return { content: [{ type: 'text', text: JSON.stringify(payload) }], isError: true };
      }
    },
  );
}
