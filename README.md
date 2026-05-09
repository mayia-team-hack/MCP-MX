# MCP-MX

Servidor MCP para consulta de datos abiertos de la Ciudad de México.

3 capas:
1. **data_ingestion/** — pipeline ETL asíncrono que consume la API CKAN de datos.cdmx.gob.mx.
2. **scrapers/** — adaptadores para fuentes sin API (ej. MERCOMUNA).
3. **mcp_server/** — servidor MCP que expone los datos indexados a agentes de IA.

Habla con los datos de tu ciudad en lenguaje natural a través de Telegram:
👉 [@MCPcdmx](https://t.me/MCPcdmxBot)

## ¿Qué puedes preguntar?

Ejemplos de consultas que puedes enviar al bot:

**Seguridad**
- ¿Cuántos robos se registraron en Iztapalapa durante 2024?
- ¿Cuál es la alcaldía con más carpetas de investigación abiertas?
- ¿Qué tipos de delito son más frecuentes en la colonia Doctores?

**Medio ambiente**
- ¿Cuáles son las estaciones con peores niveles de PM2.5?
- ¿En qué meses del año se registran más días con mala calidad del aire?

**Movilidad**
- ¿Cuántos usuarios usaron el Metro en enero de 2024?
- ¿Qué línea del Metrobús tiene mayor afluencia diaria?

**Gobierno y servicios**
- ¿Cuántos trámites digitales están disponibles en la CDMX?
- ¿Qué dependencia tiene más contratos registrados?

## Usar el MCP directamente

### Opción 1 — npx (sin clonar el repo)

```bash
npx @mcpmx/server --data-path /ruta/a/shared_data
```

Configuración para Claude Desktop (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "mcp-mx": {
      "command": "npx",
      "args": ["-y", "@mcpmx/server"],
      "env": {
        "SHARED_DATA_PATH": "/ruta/a/shared_data"
      }
    }
  }
}
```

### Opción 1.1 — Modo remoto para varios agentes

Si el MCP va a ser consumido por varios agentes a través de una app con AG-UI, conviene ejecutarlo como servidor remoto con `Streamable HTTP` en lugar de `stdio`.

```bash
node dist/index.js --data-path ../shared_data --transport streamable-http --host 127.0.0.1 --port 3001
```

Endpoints principales:

- `POST /mcp` — inicialización y llamadas MCP
- `GET /mcp` — stream/resume de la sesión
- `DELETE /mcp` — cierre de sesión
- `GET /health` — healthcheck simple

Notas:

- Cada cliente/agente obtiene su propia sesión MCP.
- El servidor guarda metadatos de sesión útiles para A2UI, como capacidades declaradas por el cliente durante `initialize`.
- Se mantiene el modo `stdio` para clientes locales que lanzan su propia instancia.
- Si `shared_data/index.json` no contiene datasets, el servidor usa `sample_data/` automáticamente.

### Opción 2 — Clonar el repo

```bash
git clone https://github.com/mayia-team-hack/MCP-MX.git
cd MCP-MX
```

Instalar dependencias de Python (pipeline de ingesta):

```bash
uv venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
uv sync
```

Instalar y compilar el servidor MCP:

```bash
cd mcp_server
npm install
npm run build
```

Correr el pipeline de ingesta para poblar shared_data/:

```bash
./data_ingestion/run_ingestion.sh
```

Iniciar el servidor MCP apuntando a shared_data/:

```bash
node dist/index.js --data-path ../shared_data
```

Iniciar el servidor en modo multiagente por HTTP:

```bash
node dist/index.js --data-path ../shared_data --transport streamable-http --port 3001
```


## Estado del proyecto

En desarrollo activo.
