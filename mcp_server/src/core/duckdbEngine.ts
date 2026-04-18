import * as duckdb from 'duckdb';
import { makeError, type McpError } from './loader';

// ── Types ────────────────────────────────────────────────────────────────────

export type QueryResult = Record<string, unknown>[] | McpError;

// ── Helpers ──────────────────────────────────────────────────────────────────

function hasLimit(sql: string): boolean {
  // Match LIMIT keyword outside of string literals (simple heuristic)
  return /\bLIMIT\b/i.test(sql);
}

function normaliseQuery(sql: string): string {
  const trimmed = sql.trim();
  return hasLimit(trimmed) ? trimmed : `${trimmed} LIMIT 100`;
}

function queryAll(
  conn: duckdb.Connection,
  sql: string,
): Promise<Record<string, unknown>[]> {
  return new Promise((resolve, reject) => {
    conn.all(sql, (err: duckdb.DuckDbError | null, rows: duckdb.RowData[]) => {
      if (err) reject(err);
      else resolve(rows as Record<string, unknown>[]);
    });
  });
}

// ── Public API ───────────────────────────────────────────────────────────────

function sanitizeIdentifier(name: string): string {
  if (name.length === 0) throw new Error('Identifier cannot be empty');
  // Double-quoted SQL identifiers support any char except the double-quote itself
  if (name.includes('"')) throw new Error(`Identifier contains illegal character '"': "${name}"`);
  return name;
}

/**
 * Execute a SELECT query against a parquet file.
 *
 * filePath  – absolute path to the .parquet file.
 * query     – SQL that may reference the parquet path directly
 *             (FROM '/abs/path.parquet') or, when viewName is provided,
 *             the registered view name (FROM my_dataset WHERE …).
 * viewName  – optional: create a DuckDB VIEW with this name before running
 *             the query so callers can use `dataset_id` as the table name.
 */
export async function execute(
  filePath: string,
  query: string,
  viewName?: string,
): Promise<QueryResult> {
  const trimmed = query.trim();

  if (!trimmed.toUpperCase().startsWith('SELECT')) {
    return makeError(
      'INVALID_QUERY',
      'Only SELECT queries are permitted',
      'Rewrite your query to start with SELECT',
    );
  }

  const finalQuery = normaliseQuery(trimmed);

  let db: duckdb.Database | undefined;
  let conn: duckdb.Connection | undefined;

  try {
    db = await new Promise<duckdb.Database>((resolve, reject) => {
      const instance = new duckdb.Database(
        ':memory:',
        (err: duckdb.DuckDbError | null) => {
          if (err) reject(err);
          else resolve(instance);
        },
      );
    });

    conn = db.connect();

    if (viewName) {
      const safeName = sanitizeIdentifier(viewName);
      const escapedPath = filePath.replace(/'/g, "''");
      await queryAll(conn, `CREATE VIEW "${safeName}" AS SELECT * FROM '${escapedPath}'`);
    }

    const rows = await queryAll(conn, finalQuery);
    return rows;
  } catch (err) {
    const message = (err as Error).message ?? String(err);
    return makeError(
      'SQL_EXECUTION_ERROR',
      `DuckDB execution error for file "${filePath}": ${message}`,
      'Check your query syntax and column names — use the schema tool to list available columns',
    );
  } finally {
    if (conn) conn.close();
    if (db) await new Promise<void>((resolve) => (db as duckdb.Database).close(() => resolve()));
  }
}
