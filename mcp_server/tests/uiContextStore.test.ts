import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRenderResult } from '../src/core/uiRenderer';
import { getContext } from '../src/core/uiContextStore';

test('buildRenderResult stores surface context for the session', () => {
  const sessionId = 'ui-session-1';
  const surfaceId = 'surface-sales';

  buildRenderResult(
    'barras_categorias',
    'Ventas por alcaldia',
    [
      { category: 'Coyoacan', value: 10 },
      { category: 'Tlalpan', value: 20 },
    ],
    surfaceId,
    sessionId,
    'mostrar_barras_categorias_ui',
  );

  const context = getContext(sessionId);
  assert.ok(context);
  assert.equal(context?.surfaces[surfaceId]?.view, 'barras_categorias');
  assert.equal(context?.surfaces[surfaceId]?.toolName, 'mostrar_barras_categorias_ui');
  assert.equal(context?.surfaces[surfaceId]?.rowCount, 2);
});
