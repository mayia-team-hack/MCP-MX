import * as path from 'path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import * as loader from './core/loader';
import * as schemaCache from './core/schemaCache';

import { register as registerListarFuentes } from './tools/listarFuentes';
import { register as registerObtenerEsquema } from './tools/obtenerEsquema';
import { register as registerConsultarSQL } from './tools/consultarSQL';
import { register as registerObtenerMetadatos } from './tools/obtenerMetadatos';
import { register as registerBuscarDatasets } from './tools/buscarDatasets';
import { register as registerConsultarConFiltros } from './tools/consultarConFiltros';
import { register as registerBuscarValorEnColumna } from './tools/buscarValorEnColumna';
import { register as registerObtenerEstadisticas } from './tools/obtenerEstadisticas';
import { register as registerAgregarDatos } from './tools/agregarDatos';
import { register as registerFormatearResultado } from './tools/formatearResultado';
import { register as registerCatalogo } from './resources/catalogo';
import { register as registerAnalista } from './prompts/analista';

// ── Resolve SHARED_DATA_PATH ─────────────────────────────────────────────────

function resolveSharedDataPath(): string {
  // 1. --data-path <value> or --data-path=<value> CLI flag
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--data-path' && argv[i + 1]) {
      return argv[i + 1];
    }
    if (argv[i].startsWith('--data-path=')) {
      return argv[i].slice('--data-path='.length);
    }
  }

  // 2. SHARED_DATA_PATH environment variable
  if (process.env.SHARED_DATA_PATH) {
    return process.env.SHARED_DATA_PATH;
  }

  // 3. Default: repo root shared_data/
  return path.resolve(__dirname, '../../shared_data');
}

// ── Bootstrap ────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const sharedDataPath = resolveSharedDataPath();
  console.error(`[mcp-mx] SHARED_DATA_PATH = ${sharedDataPath}`);

  try {
    loader.initialize(sharedDataPath);
  } catch (err) {
    console.error('[mcp-mx] Fatal error initialising loader:', err);
    process.exit(1);
  }

  const datasets = loader.getAll();
  console.error(`[mcp-mx] Loaded ${datasets.length} dataset(s) from index.json`);

  await schemaCache.initialize(datasets);

  // ── MCP server ─────────────────────────────────────────────────────────────

  const server = new McpServer({ name: 'mcp-mx', version: '0.1.0' });

  // Tools
  registerListarFuentes(server);
  registerObtenerEsquema(server);
  registerConsultarSQL(server);
  registerObtenerMetadatos(server);
  registerBuscarDatasets(server);
  registerConsultarConFiltros(server);
  registerBuscarValorEnColumna(server);
  registerObtenerEstadisticas(server);
  registerAgregarDatos(server);
  registerFormatearResultado(server);

  // Resource (catalog snapshot — generated after schemaCache is populated)
  registerCatalogo(server);

  // Prompt
  registerAnalista(server);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error('[mcp-mx] MCP server started (STDIO transport)');
}

main().catch((err) => {
  console.error('[mcp-mx] Unhandled error:', err);
  process.exit(1);
});
