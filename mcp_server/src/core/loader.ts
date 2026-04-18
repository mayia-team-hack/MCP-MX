import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';

// ── Error types ──────────────────────────────────────────────────────────────

export type ErrorCode =
  | 'DATASET_NOT_FOUND'
  | 'FILE_NOT_FOUND'
  | 'INVALID_QUERY'
  | 'SQL_EXECUTION_ERROR'
  | 'INDEX_PARSE_ERROR';

export interface McpError {
  error: true;
  code: ErrorCode;
  message: string;
  suggestion: string;
}

export function makeError(
  code: ErrorCode,
  message: string,
  suggestion: string,
): McpError {
  return { error: true, code, message, suggestion };
}

// ── Schema ───────────────────────────────────────────────────────────────────

const DatasetSchema = z.object({
  dataset_id: z.string(),
  file_path: z.string(),
  title: z.string(),
  organization: z.string().optional(),
  categories: z.array(z.string()).optional().default([]),
  tags: z.array(z.string()).optional().default([]),
  last_updated: z.string().optional(),
});

// Accept both the populated format (datasets array) and the current empty
// format produced by the ingestion pipeline scaffold.
const IndexSchema = z.object({
  datasets: z.array(DatasetSchema).optional().default([]),
}).passthrough();

export type Dataset = z.infer<typeof DatasetSchema>;
export type DatasetEntry = Dataset & { resolvedPath: string };

// ── State ────────────────────────────────────────────────────────────────────

let registry: Map<string, DatasetEntry> = new Map();

// ── Public API ───────────────────────────────────────────────────────────────

export function initialize(sharedDataPath: string): void {
  const indexPath = path.join(sharedDataPath, 'index.json');

  let raw: string;
  try {
    raw = fs.readFileSync(indexPath, 'utf-8');
  } catch (err) {
    throw makeError(
      'INDEX_PARSE_ERROR',
      `Cannot read index.json at ${indexPath}: ${(err as Error).message}`,
      `Ensure index.json exists at ${indexPath}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw makeError(
      'INDEX_PARSE_ERROR',
      `index.json contains invalid JSON: ${(err as Error).message}`,
      'Validate JSON syntax in index.json',
    );
  }

  const result = IndexSchema.safeParse(parsed);
  if (!result.success) {
    throw makeError(
      'INDEX_PARSE_ERROR',
      `index.json schema validation failed: ${result.error.message}`,
      'Check the structure of index.json against the expected schema',
    );
  }

  registry = new Map();

  for (const dataset of result.data.datasets) {
    const resolvedPath = path.resolve(sharedDataPath, dataset.file_path);
    if (!fs.existsSync(resolvedPath)) {
      throw makeError(
        'FILE_NOT_FOUND',
        `Parquet file not found for dataset "${dataset.dataset_id}": ${resolvedPath}`,
        `Run the ingestion pipeline or verify file_path in index.json for "${dataset.dataset_id}"`,
      );
    }
    registry.set(dataset.dataset_id, { ...dataset, resolvedPath });
  }
}

export function getAll(): DatasetEntry[] {
  return Array.from(registry.values());
}

export function getPath(datasetId: string): string | McpError {
  const entry = registry.get(datasetId);
  if (!entry) {
    return makeError(
      'DATASET_NOT_FOUND',
      `Dataset not found: "${datasetId}"`,
      'Use the list_datasets tool to see available dataset IDs',
    );
  }
  return entry.resolvedPath;
}
