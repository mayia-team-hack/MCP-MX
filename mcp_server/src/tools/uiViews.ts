import { z } from 'zod';
import { type McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { buildRenderResult } from '../core/uiRenderer';

type ToolSchema = Record<string, z.ZodTypeAny>;
type ToolArgs = Record<string, unknown>;
type ToolRegistrar = (
  name: string,
  description: string,
  schema: ToolSchema,
  handler: (args: ToolArgs, extra?: { sessionId?: string }) => Promise<unknown>,
) => void;

const metricRowSchema = z.object({
  label: z.string(),
  value: z.union([z.string(), z.number()]),
});

const pointRowSchema = z.object({
  x: z.union([z.string(), z.number()]),
  y: z.number(),
});

const categoryRowSchema = z.object({
  category: z.string(),
  value: z.number(),
});

const mapPointSchema = z.object({
  label: z.string().optional(),
  lat: z.number(),
  lon: z.number(),
  detail: z.string().optional(),
});

const commonSchema = {
  titulo: z.string(),
  surface_id: z.string().optional().default('default'),
};

export function register(server: McpServer): void {
  const registerTool = server.tool.bind(server) as unknown as ToolRegistrar;

  registerTool(
    'mostrar_tarjetas_metricas_ui',
    'Renderiza una superficie A2UI de KPIs resumidos con tarjetas metricas predefinidas.',
    {
      ...commonSchema,
      items: z.array(metricRowSchema),
    },
    async (args: ToolArgs, extra?: { sessionId?: string }) => {
      const { titulo, surface_id, items } = args as {
        titulo: string;
        surface_id: string;
        items: Array<Record<string, unknown>>;
      };
      return buildRenderResult(
        'tarjetas_metricas',
        titulo,
        items,
        surface_id,
        extra?.sessionId,
        'mostrar_tarjetas_metricas_ui',
      );
    },
  );

  registerTool(
    'mostrar_serie_temporal_ui',
    'Renderiza una serie temporal o secuencial en una vista de linea preaprobada.',
    {
      ...commonSchema,
      puntos: z.array(pointRowSchema),
    },
    async (args: ToolArgs, extra?: { sessionId?: string }) => {
      const { titulo, surface_id, puntos } = args as {
        titulo: string;
        surface_id: string;
        puntos: Array<Record<string, unknown>>;
      };
      return buildRenderResult(
        'serie_linea',
        titulo,
        puntos,
        surface_id,
        extra?.sessionId,
        'mostrar_serie_temporal_ui',
      );
    },
  );

  registerTool(
    'mostrar_barras_categorias_ui',
    'Renderiza comparaciones por categoria usando una vista de barras aprobada.',
    {
      ...commonSchema,
      items: z.array(categoryRowSchema),
    },
    async (args: ToolArgs, extra?: { sessionId?: string }) => {
      const { titulo, surface_id, items } = args as {
        titulo: string;
        surface_id: string;
        items: Array<Record<string, unknown>>;
      };
      const rows = items.map((item) => ({
        category: item['category'],
        value: item['value'],
      }));
      return buildRenderResult(
        'barras_categorias',
        titulo,
        rows,
        surface_id,
        extra?.sessionId,
        'mostrar_barras_categorias_ui',
      );
    },
  );

  registerTool(
    'mostrar_tabla_datos_ui',
    'Renderiza una tabla de datos aprobada para exploracion tabular.',
    {
      ...commonSchema,
      filas: z.array(z.record(z.unknown())),
    },
    async (args: ToolArgs, extra?: { sessionId?: string }) => {
      const { titulo, surface_id, filas } = args as {
        titulo: string;
        surface_id: string;
        filas: Array<Record<string, unknown>>;
      };
      return buildRenderResult(
        'tabla_datos',
        titulo,
        filas,
        surface_id,
        extra?.sessionId,
        'mostrar_tabla_datos_ui',
      );
    },
  );

  registerTool(
    'mostrar_mapa_puntos_ui',
    'Renderiza una vista geoespacial simplificada con puntos validados.',
    {
      ...commonSchema,
      puntos: z.array(mapPointSchema),
    },
    async (args: ToolArgs, extra?: { sessionId?: string }) => {
      const { titulo, surface_id, puntos } = args as {
        titulo: string;
        surface_id: string;
        puntos: Array<Record<string, unknown>>;
      };
      return buildRenderResult(
        'mapa_puntos',
        titulo,
        puntos,
        surface_id,
        extra?.sessionId,
        'mostrar_mapa_puntos_ui',
      );
    },
  );
}
