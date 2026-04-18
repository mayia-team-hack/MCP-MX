# MCP-MX

Servidor MCP para consulta de datos abiertos de la Ciudad de México.

Arquitectura en 3 capas:
1. **data_ingestion/** — pipeline ETL asíncrono que consume la API CKAN de datos.cdmx.gob.mx.
2. **scrapers/** — subcapa de adaptadores para fuentes sin API (ej. MERCOMUNA).
3. **mcp_server/** — servidor MCP que expone los datos indexados a agentes de IA.

## Setup

```bash
uv venv
source .venv/bin/activate
uv sync
```

## Correr el pipeline de ingesta

```bash
./data_ingestion/run_ingestion.sh
```

## Tests

```bash
uv run pytest
```

## Estado del proyecto

En desarrollo. Ver ruta crítica de 9 tareas en docs internos.
