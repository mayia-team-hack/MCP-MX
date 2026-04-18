import * as duckdb from 'duckdb';
import { type DatasetEntry } from './loader';

// ── Types ────────────────────────────────────────────────────────────────────

export interface ColumnInfo {
  column_name: string;
  data_type: string;
}

export interface DatasetMeta {
  columns: ColumnInfo[];
  row_count: number;
}

// ── State ────────────────────────────────────────────────────────────────────

const cache = new Map<string, DatasetMeta>();

// ── Helpers ──────────────────────────────────────────────────────────────────

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

function openDb(filePath: string): Promise<duckdb.Database> {
  return new Promise((resolve, reject) => {
    const db = new duckdb.Database(filePath, (err: duckdb.DuckDbError | null) => {
      if (err) reject(err);
      else resolve(db);
    });
  });
}

async function introspect(filePath: string): Promise<DatasetMeta> {
  const db = await openDb(':memory:');
  const conn = db.connect();

  try {
    const escaped = filePath.replace(/'/g, "''");

    const describeRows = await queryAll(
      conn,
      `DESCRIBE SELECT * FROM '${escaped}'`,
    );

    const columns: ColumnInfo[] = describeRows.map((row) => ({
      column_name: String(row['column_name']),
      data_type: String(row['column_type']),
    }));

    const countRows = await queryAll(
      conn,
      `SELECT COUNT(*) AS cnt FROM '${escaped}'`,
    );
    const row_count = Number((countRows[0] as { cnt: unknown })['cnt'] ?? 0);

    return { columns, row_count };
  } finally {
    conn.close();
    await new Promise<void>((resolve) => db.close(resolve));
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

export async function initialize(datasets: DatasetEntry[]): Promise<void> {
  if (datasets.length === 0) {
    console.warn('[schemaCache] No datasets found in index.json — cache is empty');
    return;
  }

  for (const dataset of datasets) {
    try {
      const meta = await introspect(dataset.resolvedPath);
      cache.set(dataset.dataset_id, meta);
      console.log(
        `[schemaCache] Loaded "${dataset.dataset_id}": ` +
          `${meta.columns.length} columns, ${meta.row_count} rows`,
      );
    } catch (err) {
      console.error(
        `[schemaCache] Failed to introspect "${dataset.dataset_id}": ` +
          `${(err as Error).message}`,
      );
    }
  }
}

export function get(datasetId: string): DatasetMeta | undefined {
  return cache.get(datasetId);
}

export function getColumns(datasetId: string): ColumnInfo[] | undefined {
  return cache.get(datasetId)?.columns;
}

export function getRowCount(datasetId: string): number | undefined {
  return cache.get(datasetId)?.row_count;
}

export function all(): Map<string, DatasetMeta> {
  return cache;
}
