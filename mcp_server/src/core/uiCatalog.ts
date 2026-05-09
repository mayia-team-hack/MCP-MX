export const MCP_MX_A2UI_VERSION = 'v0.9';
export const MCP_MX_UI_CATALOG_ID = 'mcp://catalogs/mcp-mx-mcp-apps-v1';
export const MCP_MX_UI_RESOURCE_URI = 'mcp://a2ui/catalogo-ui';

export const ALLOWED_VIEWS = [
  'tarjetas_metricas',
  'serie_linea',
  'barras_categorias',
  'tabla_datos',
  'mapa_puntos',
] as const;

export type AllowedView = (typeof ALLOWED_VIEWS)[number];

export function buildUiCatalog(): Record<string, unknown> {
  return {
    catalogId: MCP_MX_UI_CATALOG_ID,
    version: MCP_MX_A2UI_VERSION,
    rendererStrategy: 'mcp-app-in-a2ui',
    customComponents: [
      {
        name: 'McpApp',
        description:
          'Sandboxed MCP App container used to render approved MCP MX interactive views inside A2UI.',
        properties: {
          title: { type: 'string', required: true },
          content: {
            type: 'string',
            required: true,
            encoding: 'url_encoded_html',
          },
        },
      },
    ],
    allowedViews: [
      {
        name: 'tarjetas_metricas',
        description: 'Resumen compacto de KPIs.',
        requiredDataShape: 'Array de objetos con label y value.',
      },
      {
        name: 'serie_linea',
        description: 'Serie temporal o secuencial con eje X e Y.',
        requiredDataShape: 'Array de objetos con x y y.',
      },
      {
        name: 'barras_categorias',
        description: 'Comparacion entre categorias discretas.',
        requiredDataShape: 'Array de objetos con category y value.',
      },
      {
        name: 'tabla_datos',
        description: 'Tabla de exploracion para registros tabulares.',
        requiredDataShape: 'Array de objetos planos.',
      },
      {
        name: 'mapa_puntos',
        description: 'Listado geoespacial simplificado para puntos con latitud/longitud.',
        requiredDataShape: 'Array de objetos con lat y lon.',
      },
    ],
    protocol: {
      negotiation: {
        recommended: 'initialize.capabilities.a2ui.clientCapabilities',
        statelessFallback: 'tools/call.params._meta.a2ui.clientCapabilities',
      },
      actionTool: 'action',
      errorTool: 'error',
    },
    examples: {
      supportedCatalogIds: [MCP_MX_UI_CATALOG_ID],
      renderTool: 'renderizar_interfaz_generativa',
    },
  };
}
