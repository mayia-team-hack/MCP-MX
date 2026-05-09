import test from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'path';
import * as loader from '../src/core/loader';
import * as engine from '../src/core/duckdbEngine';

test('sample_data catalog loads the four mock datasets', () => {
  const sampleDataPath = path.resolve(__dirname, '../../sample_data');
  loader.initialize(sampleDataPath);

  const datasets = loader.getAll();
  assert.equal(datasets.length, 4);
  assert.ok(datasets.some((dataset) => dataset.name === 'redmet-2023-05'));
});

test('DuckDB can query a sample CSV dataset through the registered dataset name', async () => {
  const sampleDataPath = path.resolve(__dirname, '../../sample_data');
  loader.initialize(sampleDataPath);

  const datasetPath = loader.getDatasetPath('redmet-2023-05');
  assert.equal(typeof datasetPath, 'string');
  if (typeof datasetPath !== 'string') {
    throw new Error(`Dataset path resolution failed: ${datasetPath.message}`);
  }

  const result = await engine.execute(
    datasetPath,
    'SELECT fecha, TMP FROM "redmet-2023-05" ORDER BY fecha LIMIT 2',
    'redmet-2023-05',
  );

  assert.ok(Array.isArray(result));
  assert.equal(result.length, 2);
  assert.deepEqual(Object.keys(result[0] ?? {}), ['fecha', 'TMP']);
});
