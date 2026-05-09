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

// ── Schema (new data contract) ────────────────────────────────────────────────

const ResourceSchema = z.object({
  path: z.string(),
  format: z.string(),
});

const GroupSchema = z.object({
  name: z.string(),
  display_name: z.string(),
});

const TagSchema = z.object({
  name: z.string(),
});

const OrganizationSchema = z.object({
  name: z.string(),
  title: z.string(),
});

const DatasetSchema = z.object({
  source: z.string().optional(),
  id: z.string().optional(),
  name: z.string(),
  title: z.string(),
  description: z.string().optional(),
  metadata_created: z.string().optional(),
  metadata_modified: z.string().optional(),
  groups: z.array(GroupSchema).optional().default([]),
  organization: OrganizationSchema.optional(),
  tags: z.array(TagSchema).optional().default([]),
  resources: z.array(ResourceSchema).optional().default([]),
  source_url: z.string().optional(),
  num_rows: z.number().optional(),
});

const IndexSchema = z
  .object({ datasets: z.array(DatasetSchema).optional().default([]) })
  .passthrough();

export type Dataset = z.infer<typeof DatasetSchema>;
export type DatasetEntry = Dataset & { resolvedPath: string };

// ── State ────────────────────────────────────────────────────────────────────

let registry: Map<string, DatasetEntry> = new Map();

function getPreferredResource(resources: { path: string; format: string }[]): {
  path: string;
  format: string;
} | undefined {
  const preferredFormats = ['parquet', 'csv', 'tsv', 'json'];

  for (const format of preferredFormats) {
    const match = resources.find((resource) => resource.format.toLowerCase() === format);
    if (match) {
      return match;
    }
  }

  return resources[0];
}

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
    type Resource = { path: string; format: string };
    const datasetResource: Resource | undefined = getPreferredResource(dataset.resources);

    if (!datasetResource) {
      throw makeError(
        'FILE_NOT_FOUND',
        `No data resource defined for dataset "${dataset.name}".`,
        `Add a file resource such as csv or parquet to the resources array in index.json for "${dataset.name}"`,
      );
    }

    const resolvedPath = path.resolve(sharedDataPath, datasetResource.path);
    if (!fs.existsSync(resolvedPath)) {
      throw makeError(
        'FILE_NOT_FOUND',
        `Dataset file not found for dataset "${dataset.name}": ${resolvedPath}`,
        `Verify the resource path in index.json for "${dataset.name}"`,
      );
    }

    registry.set(dataset.name, { ...dataset, resolvedPath });
  }
}

export function getAll(): DatasetEntry[] {
  return Array.from(registry.values());
}

/** Returns the resolved absolute parquet path for a dataset name (slug). */
export function getDatasetPath(name: string): string | McpError {
  const entry = registry.get(name);
  if (!entry) {
    return makeError(
      'DATASET_NOT_FOUND',
      `Dataset not found: "${name}"`,
      'Use the listar_fuentes_de_datos tool to see available dataset names',
    );
  }
  return entry.resolvedPath;
}

/** Backward-compat alias so existing tool files continue to compile. */
export const getParquetPath = getDatasetPath;
export const getPath = getDatasetPath;

/** Returns the full entry for a dataset name, or undefined if not registered. */
export function getByName(name: string): DatasetEntry | undefined {
  return registry.get(name);
}
