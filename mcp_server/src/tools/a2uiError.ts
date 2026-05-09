import { z } from 'zod';
import { type McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { saveError } from '../core/uiContextStore';

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
    code: z.string(),
    message: z.string(),
    surfaceId: z.string().optional().default('default'),
  };

  const registerTool = server.tool.bind(server) as unknown as ToolRegistrar;

  registerTool(
    'error',
    'Recibe reportes de error del renderer A2UI para permitir fallback, logging o reintentos.',
    inputSchema,
    async (args: ToolArgs, extra?: { sessionId?: string }) => {
      const { code, message, surfaceId } = args as {
        code: string;
        message: string;
        surfaceId?: string;
      };
      saveError(extra?.sessionId, {
        code,
        message,
        surfaceId: surfaceId ?? 'default',
      });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              acknowledged: true,
              code,
              message,
              surfaceId: surfaceId ?? 'default',
            }),
          },
        ],
      };
    },
  );
}
