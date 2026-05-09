import { z } from 'zod';
import { type McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getContext } from '../core/uiContextStore';

type ToolSchema = Record<string, z.ZodTypeAny>;
type ToolArgs = Record<string, unknown>;
type ToolRegistrar = (
  name: string,
  description: string,
  schema: ToolSchema,
  handler: (args: ToolArgs, extra?: { sessionId?: string }) => Promise<unknown>,
) => void;

export function register(server: McpServer): void {
  const registerTool = server.tool.bind(server) as unknown as ToolRegistrar;

  registerTool(
    'obtener_contexto_ui',
    'Devuelve el contexto de superficies renderizadas, acciones y errores A2UI para la sesion actual.',
    {
      session_id: z.string().optional(),
    },
    async (args: ToolArgs, extra?: { sessionId?: string }) => {
      const { session_id } = args as { session_id?: string };
      const context = getContext(session_id ?? extra?.sessionId) ?? null;

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(context),
          },
        ],
      };
    },
  );
}
