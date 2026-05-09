import { buildA2UIResource } from './a2ui';
import { saveRender } from './uiContextStore';
import {
  MCP_MX_A2UI_VERSION,
  MCP_MX_UI_CATALOG_ID,
  type AllowedView,
} from './uiCatalog';

function encodeHtml(html: string): string {
  return `url_encoded:${encodeURIComponent(html)}`;
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildMetricsHtml(title: string, rows: Record<string, unknown>[]): string {
  const cards = rows
    .map((row) => {
      const label = escapeHtml(row['label'] ?? row['name'] ?? row['categoria'] ?? 'Metrica');
      const value = escapeHtml(row['value'] ?? row['valor'] ?? row['total'] ?? '');
      return `<article class="metric"><span>${label}</span><strong>${value}</strong></article>`;
    })
    .join('');

  return `
    <section class="shell">
      <h1>${escapeHtml(title)}</h1>
      <div class="metrics">${cards}</div>
    </section>
  `;
}

function buildBarOrLineHtml(
  title: string,
  rows: Record<string, unknown>[],
  kind: 'bar' | 'line',
): string {
  const points = rows
    .map((row) => ({
      label: String(row['x'] ?? row['category'] ?? row['label'] ?? ''),
      value: Number(row['y'] ?? row['value'] ?? row['valor'] ?? 0),
    }))
    .filter((row) => Number.isFinite(row.value));

  const max = Math.max(...points.map((point) => point.value), 1);

  const content = points
    .map((point, index) => {
      const ratio = Math.max(2, Math.round((point.value / max) * 100));
      const label = escapeHtml(point.label);
      if (kind === 'bar') {
        return `<div class="row"><span>${label}</span><div class="bar"><i style="width:${ratio}%"></i></div><strong>${point.value}</strong></div>`;
      }

      const left = points.length === 1 ? 0 : Math.round((index / (points.length - 1)) * 100);
      const top = 100 - ratio;
      return `<div class="point" style="left:${left}%;top:${top}%"><b>${label}</b><span>${point.value}</span></div>`;
    })
    .join('');

  return kind === 'bar'
    ? `
      <section class="shell">
        <h1>${escapeHtml(title)}</h1>
        <div class="chart bars">${content}</div>
      </section>
    `
    : `
      <section class="shell">
        <h1>${escapeHtml(title)}</h1>
        <div class="chart line">${content}</div>
      </section>
    `;
}

function buildTableHtml(title: string, rows: Record<string, unknown>[]): string {
  const headers = Object.keys(rows[0] ?? {});
  const head = headers.map((header) => `<th>${escapeHtml(header)}</th>`).join('');
  const body = rows
    .slice(0, 30)
    .map((row) => `<tr>${headers.map((header) => `<td>${escapeHtml(row[header])}</td>`).join('')}</tr>`)
    .join('');

  return `
    <section class="shell">
      <h1>${escapeHtml(title)}</h1>
      <table>
        <thead><tr>${head}</tr></thead>
        <tbody>${body}</tbody>
      </table>
    </section>
  `;
}

function buildMapHtml(title: string, rows: Record<string, unknown>[]): string {
  const body = rows
    .slice(0, 50)
    .map((row) => {
      const label = escapeHtml(
        row['label'] ?? row['name'] ?? row['colonia'] ?? row['alcaldia'] ?? 'Punto',
      );
      const lat = escapeHtml(row['lat'] ?? row['latitude'] ?? row['latitud'] ?? '');
      const lon = escapeHtml(row['lon'] ?? row['lng'] ?? row['longitud'] ?? '');
      return `<li><strong>${label}</strong><span>${lat}, ${lon}</span></li>`;
    })
    .join('');

  return `
    <section class="shell">
      <h1>${escapeHtml(title)}</h1>
      <ol class="map-list">${body}</ol>
    </section>
  `;
}

function wrapMcpAppDocument(innerHtml: string): string {
  return `
    <!doctype html>
    <html lang="es">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <style>
          :root { color-scheme: light; --bg:#f6f3eb; --ink:#15202b; --muted:#5b6470; --card:#ffffff; --line:#d9d2c4; --accent:#0b6bcb; }
          body { margin:0; font-family: Georgia, "Times New Roman", serif; background:linear-gradient(180deg,#f8f4ec 0%,#f2efe8 100%); color:var(--ink); }
          .shell { padding:20px; }
          h1 { margin:0 0 16px; font-size:22px; }
          .metrics { display:grid; grid-template-columns:repeat(auto-fit,minmax(140px,1fr)); gap:12px; }
          .metric, table, .chart, .map-list { background:var(--card); border:1px solid var(--line); border-radius:14px; }
          .metric { padding:14px; display:flex; flex-direction:column; gap:8px; }
          .metric span { color:var(--muted); font-size:13px; }
          .metric strong { font-size:24px; }
          .chart.bars { padding:14px; display:flex; flex-direction:column; gap:10px; }
          .row { display:grid; grid-template-columns:160px 1fr 80px; gap:10px; align-items:center; }
          .bar { height:12px; background:#edf1f5; border-radius:999px; overflow:hidden; }
          .bar i { display:block; height:100%; background:linear-gradient(90deg,#0b6bcb,#59a5f5); border-radius:999px; }
          .chart.line { position:relative; min-height:260px; padding:20px; }
          .chart.line::before { content:""; position:absolute; left:20px; right:20px; bottom:28px; top:20px; border-left:1px solid var(--line); border-bottom:1px solid var(--line); }
          .point { position:absolute; transform:translate(-50%,-50%); display:flex; flex-direction:column; align-items:center; gap:4px; }
          .point::before { content:""; width:10px; height:10px; border-radius:50%; background:var(--accent); display:block; box-shadow:0 0 0 4px rgba(11,107,203,.12); }
          .point b { font-size:11px; color:var(--muted); font-weight:600; }
          .point span { font-size:12px; background:#fff; padding:2px 6px; border:1px solid var(--line); border-radius:999px; }
          table { width:100%; border-collapse:collapse; overflow:hidden; }
          th, td { padding:10px 12px; border-bottom:1px solid #eee7db; text-align:left; font-size:13px; }
          th { background:#fbf8f2; }
          .map-list { list-style:none; padding:0; margin:0; }
          .map-list li { padding:12px 14px; display:flex; justify-content:space-between; gap:12px; border-bottom:1px solid #eee7db; }
          .map-list li:last-child { border-bottom:none; }
        </style>
      </head>
      <body>${innerHtml}</body>
    </html>
  `;
}

function buildHtmlForView(
  view: AllowedView,
  title: string,
  rows: Record<string, unknown>[],
): string {
  switch (view) {
    case 'tarjetas_metricas':
      return buildMetricsHtml(title, rows);
    case 'serie_linea':
      return buildBarOrLineHtml(title, rows, 'line');
    case 'barras_categorias':
      return buildBarOrLineHtml(title, rows, 'bar');
    case 'tabla_datos':
      return buildTableHtml(title, rows);
    case 'mapa_puntos':
      return buildMapHtml(title, rows);
  }
}

export function buildA2UIPayload(
  view: AllowedView,
  title: string,
  rows: Record<string, unknown>[],
  surfaceId: string,
): unknown[] {
  const documentHtml = wrapMcpAppDocument(buildHtmlForView(view, title, rows));

  return [
    {
      version: MCP_MX_A2UI_VERSION,
      createSurface: {
        surfaceId,
        catalogId: MCP_MX_UI_CATALOG_ID,
      },
    },
    {
      version: MCP_MX_A2UI_VERSION,
      updateComponents: {
        surfaceId,
        components: [
          {
            id: 'root',
            component: 'McpApp',
            title,
            content: encodeHtml(documentHtml),
          },
        ],
      },
    },
  ];
}

export function buildRenderResult(
  view: AllowedView,
  title: string,
  rows: Record<string, unknown>[],
  surfaceId: string,
  sessionId: string | undefined,
  toolName: string,
): {
  content: Array<Record<string, unknown>>;
} {
  saveRender(sessionId, {
    surfaceId,
    view,
    title,
    toolName,
    rowCount: rows.length,
    rowsPreview: rows.slice(0, 5),
  });

  const uri = `a2ui://${view}`;
  const resource = buildA2UIResource(uri, buildA2UIPayload(view, title, rows, surfaceId));

  return {
    content: [
      {
        type: 'text',
        text: `Renderizando vista A2UI aprobada: ${view}`,
      },
      resource,
    ],
  };
}
