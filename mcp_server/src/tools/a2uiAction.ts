import { z } from 'zod';
import { type McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { saveAction } from '../core/uiContextStore';

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
    name: z.string().describe('Nombre del evento A2UI emitido por la interfaz'),
    context: z.record(z.unknown()).optional().default({}),
  };

  const registerTool = server.tool.bind(server) as unknown as ToolRegistrar;

  registerTool(
    'action',
    'Recibe eventos de interaccion emitidos por una superficie A2UI y devuelve una confirmacion textual o una nueva UI.',
    inputSchema,
    async (args: ToolArgs, extra?: { sessionId?: string }) => {
      const { name, context } = args as { name: string; context?: Record<string, unknown> };
      saveAction(extra?.sessionId, { name, context: context ?? {} });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              acknowledged: true,
              event: name,
              context: context ?? {},
            }),
          },
        ],
      };
    },
  );
}
