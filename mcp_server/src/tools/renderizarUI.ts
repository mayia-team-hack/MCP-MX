import { z } from 'zod';
import { type McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  ALLOWED_VIEWS,
  type AllowedView,
} from '../core/uiCatalog';
import { buildRenderResult } from '../core/uiRenderer';

type ToolSchema = Record<string, z.ZodTypeAny>;
type ToolArgs = Record<string, unknown>;
type ToolRegistrar = (
  name: string,
  description: string,
  schema: ToolSchema,
  handler: (args: ToolArgs, extra?: { sessionId?: string }) => Promise<unknown>,
) => void;

export function register(server: McpServer): void {
  const inputSchema: ToolSchema = {
    vista: z.enum(ALLOWED_VIEWS).describe('Tipo de vista permitida por el catalogo UI del MCP.'),
    titulo: z.string().describe('Titulo visible para la superficie A2UI.'),
    filas: z.array(z.record(z.unknown())).describe('Datos tabulares normalizados que alimentaran la vista.'),
    surface_id: z.string().optional().default('default').describe('Identificador de la superficie A2UI.'),
  };

  const registerTool = server.tool.bind(server) as unknown as ToolRegistrar;

  registerTool(
    'renderizar_interfaz_generativa',
    'Renderiza una vista A2UI restringida al catalogo UI del MCP. Usa solo vistas aprobadas; no permite componentes arbitrarios.',
    inputSchema,
    async (args: ToolArgs, extra?: { sessionId?: string }) => {
      const { vista, titulo, filas, surface_id } = args as {
        vista: AllowedView;
        titulo: string;
        filas: Array<Record<string, unknown>>;
        surface_id: string;
      };

      try {
        return buildRenderResult(
          vista,
          titulo,
          filas,
          surface_id,
          extra?.sessionId,
          'renderizar_interfaz_generativa',
        );
      } catch (err) {
        return {
          content: [{ type: 'text', text: `Error preparando recurso A2UI: ${(err as Error).message}` }],
          isError: true,
        };
      }
    },
  );
}
