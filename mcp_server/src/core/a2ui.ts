import { type EmbeddedResource } from '@modelcontextprotocol/sdk/types.js';

export interface A2UIVersionCapabilities {
  supportedCatalogIds?: string[];
  inlineCatalogs?: unknown[];
}

export interface A2UIClientCapabilities {
  'v0.8'?: A2UIVersionCapabilities;
  'v0.9'?: A2UIVersionCapabilities;
}

export interface SessionA2UIState {
  clientCapabilities?: A2UIClientCapabilities;
}

type JsonRpcLike = {
  method?: unknown;
  params?: {
    capabilities?: {
      a2ui?: SessionA2UIState;
    };
    _meta?: {
      a2ui?: SessionA2UIState;
    };
  };
};

export function extractA2UIState(message: unknown): SessionA2UIState | undefined {
  if (!message || typeof message !== 'object') {
    return undefined;
  }

  const payload = message as JsonRpcLike;

  if (payload.method === 'initialize') {
    return payload.params?.capabilities?.a2ui;
  }

  return payload.params?._meta?.a2ui;
}

export function buildA2UIResource(
  uri: string,
  payload: unknown,
): EmbeddedResource {
  return {
    type: 'resource',
    resource: {
      uri,
      mimeType: 'application/json+a2ui',
      text: JSON.stringify(payload),
    },
  };
}
