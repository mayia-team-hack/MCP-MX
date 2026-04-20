import { z } from 'zod';
import { type McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as loader from '../core/loader';
import * as schemaCache from '../core/schemaCache';
import * as engine from '../core/duckdbEngine';

type ToolSchema = Record<string, z.ZodTypeAny>;
type ToolArgs = Record<string, unknown>;
type ToolRegistrar = (
  name: string,
  description: string,
  schema: ToolSchema,
  handler: (args: ToolArgs) => Promise<unknown>,
) => void;

const NUMERIC_TYPE_RE =
  /^(TINYINT|SMALLINT|INTEGER|INT|BIGINT|HUGEINT|FLOAT|DOUBLE|DECIMAL|NUMERIC|REAL|UBIGINT|UINTEGER|USMALLINT|UTINYINT|INT8|INT16|INT32|INT64)/i;

function isNumeric(dataType: string): boolean {
  return NUMERIC_TYPE_RE.test(dataType);
}

export function register(server: McpServer): void {
  const inputSchema: ToolSchema = {
    name: z.string(),
    columna: z.string(),
  };

  const registerTool = server.tool.bind(server) as unknown as ToolRegistrar;

  registerTool(
    'obtener_estadisticas_columna',
    'Calcula estadísticas de una columna: min/max/avg/stddev para numéricas, top valores para categóricas.',
    inputSchema,
    async (args: ToolArgs) => {
      const { name, columna } = args as { name: string; columna: string };
      try {
        const pathOrErr = loader.getParquetPath(name);
        if (typeof pathOrErr !== 'string') {
          return { content: [{ type: 'text', text: JSON.stringify(pathOrErr) }], isError: true };
        }

        const meta = schemaCache.get(name);
        if (!meta) {
          const payload = loader.makeError(
            'DATASET_NOT_FOUND',
            `No se encontró el esquema del dataset "${name}".`,
            'Usa listar_fuentes_de_datos para ver los nombres disponibles.',
          );
          return { content: [{ type: 'text', text: JSON.stringify(payload) }], isError: true };
        }

        const colMeta = meta.columns.find((c) => c.column_name === columna);
        if (!colMeta) {
          const payload = loader.makeError(
            'INVALID_QUERY',
            `Columna desconocida: "${columna}".`,
            `Columnas disponibles: ${meta.columns.map((c) => c.column_name).join(', ')}`,
          );
          return { content: [{ type: 'text', text: JSON.stringify(payload) }], isError: true };
        }

        const escapedPath = pathOrErr.replace(/'/g, "''");
        const col = `"${columna}"`;

        if (isNumeric(colMeta.data_type)) {
          const query =
            `SELECT ` +
            `MIN(${col}) AS min, MAX(${col}) AS max, ` +
            `AVG(${col}) AS avg, STDDEV(${col}) AS stddev, ` +
            `COUNT(${col}) AS count, ` +
            `COUNT(*) - COUNT(${col}) AS null_count ` +
            `FROM '${escapedPath}'`;

          const rows = await engine.execute(pathOrErr, query);
          if (!Array.isArray(rows)) {
            return { content: [{ type: 'text', text: JSON.stringify(rows) }], isError: true };
          }
          return {
            content: [{ type: 'text', text: JSON.stringify({ tipo: 'numerica', stats: rows[0] ?? {} }) }],
          };
        }

        // Categorical
        const distinctQuery = `SELECT COUNT(DISTINCT ${col}) AS total_distinct FROM '${escapedPath}'`;
        const topQuery =
          `SELECT ${col} AS value, COUNT(*) AS count FROM '${escapedPath}' ` +
          `GROUP BY ${col} ORDER BY count DESC LIMIT 20`;

        const [distinctRows, topRows] = await Promise.all([
          engine.execute(pathOrErr, distinctQuery),
          engine.execute(pathOrErr, topQuery),
        ]);

        if (!Array.isArray(distinctRows)) {
          return { content: [{ type: 'text', text: JSON.stringify(distinctRows) }], isError: true };
        }
        if (!Array.isArray(topRows)) {
          return { content: [{ type: 'text', text: JSON.stringify(topRows) }], isError: true };
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                tipo: 'categorica',
                stats: {
                  total_distinct: (distinctRows[0] as { total_distinct: unknown })?.total_distinct ?? 0,
                  top_values: topRows,
                },
              }),
            },
          ],
        };
      } catch (err) {
        const payload = loader.makeError(
          'SQL_EXECUTION_ERROR',
          `Error calculando estadísticas: ${(err as Error).message}`,
          'Verifica el nombre de la columna.',
        );
        return { content: [{ type: 'text', text: JSON.stringify(payload) }], isError: true };
      }
    },
  );
}
