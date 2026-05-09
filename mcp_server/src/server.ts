import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
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
import { register as registerCatalogoUI } from './resources/catalogoUI';
import { register as registerAnalista } from './prompts/analista';
import { register as registerRenderizarUI } from './tools/renderizarUI';
import { register as registerA2UIAction } from './tools/a2uiAction';
import { register as registerA2UIError } from './tools/a2uiError';


let bootstrapped = false;

export function bootstrapData(sharedDataPath: string): void {
  if (bootstrapped) {
    return;
  }

  loader.initialize(sharedDataPath);

  const datasets = loader.getAll();
  console.error(`[mcp-mx] Loaded ${datasets.length} dataset(s) from index.json`);

  bootstrapped = true;
}

export async function warmSchemaCache(): Promise<void> {
  const datasets = loader.getAll();
  await schemaCache.initialize(datasets);
}

export function createMcpServer(): McpServer {
  const server = new McpServer(
    {
      name: 'mcp-mx',
      version: '0.1.0',
    },
    {
      capabilities: {
        logging: {},
      },
    },
  );

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
  registerCatalogo(server);
  registerCatalogoUI(server);
  registerAnalista(server);
  registerRenderizarUI(server);
  registerA2UIAction(server);
  registerA2UIError(server);


  return server;
}
