"""
data_ingestion/src/indexer.py
==============================
"El Cartógrafo" — Genera el índice centralizado del pipeline ETL MCP-MX.

Pipeline ETL — Sección 4:
    1. Carga config/settings.yaml (sin hardcoding de rutas).
    2. Lee api_metadata/*.json → diccionario maestro de recursos en memoria.
    3. Escanea processed/*.parquet → lista de archivos físicos.
    4. Cruza cada Parquet con su dataset por prefijo de resource_id (8 chars).
    5. Agrupa datasets con Parquets emparejados por categoría oficial (groups).
    6. Escribe index.json de forma atómica: tmp → os.replace() → destino final.

Restricciones absolutas:
    - Sin peticiones HTTP. 100 % offline.
    - Sin hardcoding de rutas. Todas se leen desde settings.yaml.
    - Escritura atómica para compatibilidad con lectura concurrente del MCP.
    - No propaga excepciones de parsing; archivos corruptos → WARNING y se omiten.
"""

from __future__ import annotations

import json
import logging
import logging.handlers
import os
import time
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import yaml

# ---------------------------------------------------------------------------
# Constante pública — categoría de fallback
# ---------------------------------------------------------------------------

UNCLASSIFIED: str = "Sin Clasificar"


# ---------------------------------------------------------------------------
# Configuración del logger
# ---------------------------------------------------------------------------


def _setup_logger(log_config: dict[str, Any], log_dir: Path) -> logging.Logger:
    """
    Configura y retorna el logger del módulo con RotatingFileHandler + StreamHandler.

    Idempotente: si el logger ya tiene handlers no los duplica. Esto permite
    llamar a ``build_index()`` varias veces en el mismo proceso (ej. tests).

    Args:
        log_config: Sub-dict ``logging`` extraído de settings.yaml.
        log_dir:    Ruta al directorio de archivos de log.

    Returns:
        Logger ``"mcp_mx.indexer"`` configurado.
    """
    logger = logging.getLogger("mcp_mx.indexer")

    if logger.handlers:
        return logger  # Ya inicializado — evitar duplicados

    level_name: str = log_config.get("level", "INFO")
    level: int = getattr(logging, level_name.upper(), logging.INFO)
    fmt: str = log_config.get(
        "format",
        "%(asctime)s | %(name)s | %(levelname)s | %(message)s",
    )
    max_bytes: int = int(log_config.get("max_file_size_mb", 10)) * 1_048_576
    backup_count: int = int(log_config.get("backup_count", 5))

    log_dir.mkdir(parents=True, exist_ok=True)
    log_path = log_dir / "indexer.log"

    formatter = logging.Formatter(fmt)

    fh = logging.handlers.RotatingFileHandler(
        log_path,
        maxBytes=max_bytes,
        backupCount=backup_count,
        encoding="utf-8",
    )
    fh.setFormatter(formatter)

    sh = logging.StreamHandler()
    sh.setFormatter(formatter)

    logger.setLevel(level)
    logger.addHandler(fh)
    logger.addHandler(sh)

    return logger


# ---------------------------------------------------------------------------
# Carga de configuración
# ---------------------------------------------------------------------------


def _load_config(config_path: Path) -> dict[str, Any]:
    """
    Carga el archivo YAML de configuración y lo retorna como dict.

    Args:
        config_path: Ruta al archivo settings.yaml (absoluta o relativa al CWD).

    Returns:
        Dict con la configuración completa.

    Raises:
        FileNotFoundError: Si el archivo no existe en disco.
        yaml.YAMLError:    Si el archivo tiene sintaxis YAML inválida.
    """
    if not config_path.exists():
        raise FileNotFoundError(
            f"Archivo de configuración no encontrado: {config_path.resolve()}"
        )
    with config_path.open(encoding="utf-8") as fh:
        data: Any = yaml.safe_load(fh)
    return data or {}


def _resolve_project_root(config_path: Path) -> Path:
    """
    Deriva la raíz del proyecto a partir de la ruta del config.

    Asume la estructura canónica del repositorio::

        <project_root>/
          data_ingestion/
            config/
              settings.yaml   ← config_path

    Esto implica que ``<project_root>`` es el tercer ancestro del archivo:
    ``config_path.parent.parent.parent``.

    Args:
        config_path: Ruta al settings.yaml (se resuelve a absoluta primero).

    Returns:
        ``Path`` absoluto de la raíz del proyecto.
    """
    # settings.yaml → config/ → data_ingestion/ → <root>/
    return config_path.resolve().parent.parent.parent


# ---------------------------------------------------------------------------
# Paso 1 — Carga del caché de metadatos
# ---------------------------------------------------------------------------


def _load_metadata_cache(
    api_metadata_dir: Path,
    logger: logging.Logger,
) -> dict[str, dict[str, Any]]:
    """
    Carga todos los archivos ``.json`` de ``api_metadata_dir`` en un diccionario
    maestro indexado por prefijo de resource_id (primeros 8 chars del UUID).

    Cada archivo .json representa un dataset con 13 campos CKAN. El campo
    ``resources`` es una lista de recursos; cada recurso tiene un ``id`` (UUID v5).
    Se extrae el prefijo de 8 caracteres de cada UUID para permitir el cruce
    con los nombres de los archivos Parquet generados por el downloader.

    Estructura retornada::

        {
          "550e8400": {
            "dataset": {<13 campos CKAN>},
            "resource": {"id": "550e8400-...", "url": "...", "format": "CSV", ...},
          },
          ...
        }

    Colisiones de prefijo (extremadamente improbables con UUID v5) se resuelven
    conservando la primera entrada y emitiendo WARNING.

    Args:
        api_metadata_dir: Directorio que contiene los JSON de metadatos.
        logger:           Logger configurado del módulo.

    Returns:
        Diccionario de recursos indexados. Puede estar vacío si no hay JSONs
        o si todos los archivos fallaron al parsear.
    """
    resource_index: dict[str, dict[str, Any]] = {}

    if not api_metadata_dir.is_dir():
        logger.warning(
            "Directorio api_metadata no existe: %s — el índice estará vacío.",
            api_metadata_dir,
        )
        return resource_index

    json_files: list[Path] = sorted(api_metadata_dir.glob("*.json"))
    logger.info(
        "Encontrados %d archivos JSON en api_metadata/",
        len(json_files),
    )

    loaded_datasets = 0
    loaded_resources = 0

    for json_path in json_files:
        try:
            with json_path.open(encoding="utf-8") as fh:
                dataset: dict[str, Any] = json.load(fh)
        except (json.JSONDecodeError, OSError) as exc:
            logger.warning(
                "No se pudo leer '%s': %s — omitido.", json_path.name, exc
            )
            continue

        resources: list[dict[str, Any]] = dataset.get("resources") or []
        if not resources:
            logger.warning(
                "'%s' no tiene recursos definidos — dataset omitido del índice.",
                json_path.name,
            )
            continue

        loaded_datasets += 1

        for resource in resources:
            # Soportamos tanto "id" como "resource_id" por compatibilidad
            rid: str = (resource.get("id") or resource.get("resource_id") or "").strip()
            if not rid:
                logger.warning(
                    "'%s': recurso sin campo 'id' — omitido.",
                    json_path.name,
                )
                continue

            # UUID formato: xxxxxxxx-xxxx-... → los primeros 8 chars son hex puros
            # No se elimina el guión porque no aparece en los primeros 8 caracteres.
            prefix: str = rid[:8]

            if prefix in resource_index:
                existing_name = resource_index[prefix]["dataset"].get("name", "?")
                current_name = dataset.get("name", "?")
                logger.warning(
                    "Colisión de prefijo '%s': datasets '%s' vs '%s' — "
                    "se conserva '%s'.",
                    prefix,
                    existing_name,
                    current_name,
                    existing_name,
                )
                continue

            resource_index[prefix] = {"dataset": dataset, "resource": resource}
            loaded_resources += 1

    logger.info(
        "Caché cargada: %d datasets, %d entradas de recurso.",
        loaded_datasets,
        loaded_resources,
    )
    return resource_index


# ---------------------------------------------------------------------------
# Paso 2 — Escaneo de Parquets
# ---------------------------------------------------------------------------


def _scan_parquet_files(
    processed_dir: Path,
    logger: logging.Logger,
) -> list[Path]:
    """
    Escanea recursivamente ``processed_dir`` buscando archivos ``.parquet``.

    Args:
        processed_dir: Directorio raíz de los Parquets generados por el downloader.
        logger:        Logger configurado.

    Returns:
        Lista ordenada de rutas absolutas a todos los Parquets encontrados.
        Lista vacía si el directorio no existe o no tiene Parquets.
    """
    if not processed_dir.is_dir():
        logger.warning(
            "Directorio processed/ no existe: %s — no se encontrarán Parquets.",
            processed_dir,
        )
        return []

    parquet_files: list[Path] = sorted(processed_dir.rglob("*.parquet"))
    logger.info(
        "Encontrados %d archivos Parquet en processed/",
        len(parquet_files),
    )
    return parquet_files


# ---------------------------------------------------------------------------
# Paso 3 — Cruce Parquet ↔ Recurso
# ---------------------------------------------------------------------------


def _extract_resource_prefix(parquet_path: Path) -> str:
    """
    Extrae el prefijo de resource_id (últimos 8 caracteres del stem) del Parquet.

    El downloader nombra los archivos Parquet siguiendo la convención::

        <nombre-base>-<8-chars-resource-id>.parquet

    Ejemplos::

        afluencia-diaria-metro-550e8400.parquet  →  "550e8400"
        dataset_movilidad_abc12345.parquet       →  "abc12345"
        550e8400.parquet                         →  "550e8400"

    Args:
        parquet_path: Ruta al archivo Parquet.

    Returns:
        Cadena de 8 caracteres correspondiente al prefijo del resource_id.
    """
    return parquet_path.stem[-8:]


def _match_parquets(
    parquet_files: list[Path],
    resource_index: dict[str, dict[str, Any]],
    logger: logging.Logger,
) -> tuple[dict[str, list[dict[str, Any]]], list[Path]]:
    """
    Cruza cada archivo Parquet con su entrada en el índice maestro.

    Para cada Parquet extrae el prefijo de 8 chars del stem y lo busca en
    ``resource_index``. Los que tienen match se agrupan por ``dataset_id``;
    los que no tienen match se marcan como huérfanos → "Sin Clasificar".

    Args:
        parquet_files:  Lista de rutas a archivos Parquet físicos.
        resource_index: Índice maestro ``{prefix: {dataset, resource}}``.
        logger:         Logger configurado.

    Returns:
        Tupla ``(dataset_map, orphans)``:

        - ``dataset_map``: ``{dataset_id: [resource_entry, ...]}``, donde
          cada ``resource_entry`` incluye los campos del recurso CKAN más
          la ruta física del Parquet emparejado.
        - ``orphans``: Lista de Paths de Parquets sin match en el índice.
    """
    dataset_map: dict[str, list[dict[str, Any]]] = defaultdict(list)
    orphans: list[Path] = []

    for parquet_path in parquet_files:
        prefix: str = _extract_resource_prefix(parquet_path)
        match: dict[str, Any] | None = resource_index.get(prefix)

        if match is None:
            logger.warning(
                "[%s] Parquet '%s' (prefijo '%s') no tiene match en metadatos "
                "— asignado a '%s'.",
                UNCLASSIFIED,
                parquet_path.name,
                prefix,
                UNCLASSIFIED,
            )
            orphans.append(parquet_path)
            continue

        dataset: dict[str, Any] = match["dataset"]
        resource: dict[str, Any] = match["resource"]

        # Clave única del dataset: preferimos "id" (SHA-1), fallback al "name"
        dataset_id: str = dataset.get("id") or dataset.get("name") or parquet_path.stem

        dataset_map[dataset_id].append(
            {
                "resource_id":     resource.get("id") or resource.get("resource_id", ""),
                "resource_name":   resource.get("name", ""),
                "resource_format": resource.get("format", ""),
                "resource_url":    resource.get("url", ""),
                "parquet_path":    str(parquet_path),
            }
        )

    return dict(dataset_map), orphans


# ---------------------------------------------------------------------------
# Paso 4 — Agrupación por categoría oficial
# ---------------------------------------------------------------------------


def _get_categories(dataset: dict[str, Any]) -> list[str]:
    """
    Extrae los nombres de categoría del campo ``groups`` del dataset.

    Cada elemento del campo ``groups`` tiene la forma ``{"name": "movilidad"}``.
    Si la lista es vacía, ausente, o todos los nombres están en blanco, retorna
    ``[UNCLASSIFIED]``.

    Args:
        dataset: Dict con los 13 campos CKAN.

    Returns:
        Lista de nombres de categoría; mínimo ``["Sin Clasificar"]``.
    """
    groups: list[dict[str, str]] = dataset.get("groups") or []
    names: list[str] = [
        g.get("name", "").strip()
        for g in groups
        if isinstance(g, dict) and g.get("name", "").strip()
    ]
    return names if names else [UNCLASSIFIED]


def _build_entry(
    dataset: dict[str, Any],
    matched_resources: list[dict[str, Any]],
) -> dict[str, Any]:
    """
    Construye la entrada de dataset para el índice agrupado.

    Incluye todos los campos relevantes de presentación (id, name, title,
    description, organization, tags, groups, source_url, num_rows,
    timestamps) más la lista de recursos físicos (Parquets) emparejados.

    Args:
        dataset:           Dict con los 13 campos CKAN del dataset.
        matched_resources: Lista de dicts ``{resource_id, parquet_path, ...}``.

    Returns:
        Dict serializable listo para incluir en el índice JSON.
    """
    return {
        "id":                dataset.get("id", ""),
        "name":              dataset.get("name", ""),
        "title":             dataset.get("title", ""),
        "description":       dataset.get("description", ""),
        "organization":      dataset.get("organization", {}),
        "tags":              dataset.get("tags", []),
        "groups":            dataset.get("groups", []),
        "source_url":        dataset.get("source_url", ""),
        "num_rows":          dataset.get("num_rows", 0),
        "metadata_created":  dataset.get("metadata_created", ""),
        "metadata_modified": dataset.get("metadata_modified", ""),
        "resources":         matched_resources,
    }


def _group_by_category(
    dataset_map: dict[str, list[dict[str, Any]]],
    resource_index: dict[str, dict[str, Any]],
    orphans: list[Path],
    logger: logging.Logger,
) -> dict[str, list[dict[str, Any]]]:
    """
    Construye el índice agrupado por categoría oficial a partir del cruce.

    Algoritmo:
      - Construye una tabla inversa ``dataset_id → dataset_dict`` del
        ``resource_index`` para evitar iterar el índice completo por cada
        dataset emparejado.
      - Para cada dataset con Parquets emparejados:
        - Recupera sus categorías (groups[].name o "Sin Clasificar").
        - Añade su entrada a cada categoría (un dataset multi-grupo aparece
          en todas sus categorías).
      - Para cada Parquet huérfano:
        - Añade una entrada mínima a "Sin Clasificar".
      - Ordena el resultado: categorías con nombre primero (alfabético),
        "Sin Clasificar" siempre al final.

    Args:
        dataset_map:    Mapa ``{dataset_id: [matched_resources]}``.
        resource_index: Índice maestro (fuente de metadata de datasets).
        orphans:        Parquets sin match en el índice maestro.
        logger:         Logger configurado.

    Returns:
        Dict ``{category_name: [dataset_entry, ...]}``.
    """
    # Tabla inversa para lookup O(1): dataset_id → dataset_dict
    id_to_dataset: dict[str, dict[str, Any]] = {}
    for entry in resource_index.values():
        ds: dict[str, Any] = entry["dataset"]
        did: str = ds.get("id") or ds.get("name") or ""
        if did and did not in id_to_dataset:
            id_to_dataset[did] = ds

    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)

    # Datasets con Parquets emparejados
    for dataset_id, matched_resources in dataset_map.items():
        dataset = id_to_dataset.get(dataset_id)

        if dataset is None:
            # Inconsistencia interna: dataset_id existe en dataset_map pero
            # no en id_to_dataset. Muy improbable; se maneja defensivamente.
            logger.warning(
                "dataset_id '%s' no encontrado en el índice maestro — "
                "se asigna a '%s'.",
                dataset_id,
                UNCLASSIFIED,
            )
            grouped[UNCLASSIFIED].append(
                {
                    "id": dataset_id,
                    "resources": matched_resources,
                    "note": "Metadata no disponible en caché",
                }
            )
            continue

        categories: list[str] = _get_categories(dataset)
        entry: dict[str, Any] = _build_entry(dataset, matched_resources)

        for category in categories:
            grouped[category].append(entry)

    # Parquets huérfanos → "Sin Clasificar"
    for orphan in orphans:
        grouped[UNCLASSIFIED].append(
            {
                "id":                None,
                "name":              orphan.stem,
                "title":             orphan.stem,
                "description":       "",
                "organization":      {},
                "tags":              [],
                "groups":            [],
                "source_url":        "",
                "num_rows":          0,
                "metadata_created":  "",
                "metadata_modified": "",
                "resources": [
                    {
                        "resource_id":     None,
                        "resource_name":   orphan.name,
                        "resource_format": "PARQUET",
                        "resource_url":    "",
                        "parquet_path":    str(orphan),
                    }
                ],
                "note": "Sin metadata — archivo huérfano",
            }
        )

    # Ordenar: categorías con nombre primero (alfa), "Sin Clasificar" al final
    sorted_grouped: dict[str, list[dict[str, Any]]] = {
        k: grouped[k]
        for k in sorted(k for k in grouped if k != UNCLASSIFIED)
    }
    if UNCLASSIFIED in grouped:
        sorted_grouped[UNCLASSIFIED] = grouped[UNCLASSIFIED]

    return sorted_grouped


# ---------------------------------------------------------------------------
# Paso 5 — Escritura atómica
# ---------------------------------------------------------------------------


def _write_atomic(data: dict[str, Any], dest_path: Path) -> None:
    """
    Serializa ``data`` como JSON y lo escribe atómicamente en ``dest_path``.

    Patrón: escribe en un archivo temporal (mismo directorio que ``dest_path``)
    y luego usa ``os.replace()`` para moverlo al destino final. Dado que ambas
    rutas están en el mismo filesystem, ``os.replace()`` es una operación
    atómica del SO — el MCP server siempre verá un JSON completo o el anterior,
    nunca uno a medio escribir.

    El PID se incluye en el nombre del tmp para evitar conflictos si varios
    procesos ejecutan el indexer simultáneamente.

    Args:
        data:      Dict Python a serializar (debe ser JSON-serializable).
        dest_path: Ruta final de ``index.json``.

    Raises:
        OSError: Si falla la escritura del tmp o el rename. Se limpia el tmp
                 antes de re-lanzar la excepción.
    """
    logger = logging.getLogger("mcp_mx.indexer")
    dest_path.parent.mkdir(parents=True, exist_ok=True)

    tmp_path = dest_path.parent / f"{dest_path.stem}_tmp_{os.getpid()}.json"

    try:
        with tmp_path.open("w", encoding="utf-8") as fh:
            json.dump(data, fh, ensure_ascii=False, indent=2, default=str)
        os.replace(tmp_path, dest_path)
        logger.info("Índice escrito atómicamente → %s", dest_path)
    except Exception:
        if tmp_path.exists():
            try:
                tmp_path.unlink()
            except OSError:
                pass  # Ya hay un error más grave; no enmascararlo
        raise


# ---------------------------------------------------------------------------
# Interfaz pública principal
# ---------------------------------------------------------------------------


def build_index(
    config_path: str | Path = "config/settings.yaml",
) -> dict[str, Any]:
    """
    Orquesta los 5 pasos de "El Cartógrafo" para generar el índice del pipeline.

    Flujo completo:

    1. Carga ``config_path`` (settings.yaml) con pyyaml.
    2. Resuelve todas las rutas de trabajo desde ``paths.*`` del YAML.
    3. Lee ``api_metadata/*.json`` → índice maestro de recursos en memoria.
    4. Escanea ``processed/*.parquet`` → lista de archivos físicos.
    5. Cruza cada Parquet con su dataset por prefijo de resource_id (8 chars).
    6. Agrupa datasets por categoría oficial (groups[].name).
       Si un Parquet no tiene match o el dataset no tiene grupos →
       categoría ``"Sin Clasificar"`` + WARNING al logger.
    7. Escribe el documento de índice atómicamente en ``paths.index``.

    Uso típico (desde el directorio ``data_ingestion/``)::

        from data_ingestion.src.indexer import build_index
        index = build_index()  # usa config/settings.yaml relativo al CWD

    Uso con ruta explícita::

        index = build_index("/abs/path/to/MCP-MX/data_ingestion/config/settings.yaml")

    Args:
        config_path:
            Ruta al archivo settings.yaml. Se admite ruta relativa al CWD
            o ruta absoluta. El default ``"config/settings.yaml"`` es
            conveniente al ejecutar desde ``data_ingestion/``.

    Returns:
        El documento de índice completo como dict Python. Contiene:
          - ``generated_at``: timestamp UTC de generación.
          - ``duration_seconds``: tiempo total de ejecución.
          - ``total_datasets``: número de datasets con al menos un Parquet.
          - ``total_parquet_files``: total de Parquets escaneados.
          - ``unmatched_parquets``: Parquets sin match en metadatos.
          - ``categories_count``: número de categorías en el índice.
          - ``categories``: ``{category_name: [dataset_entry, ...]}``.

    Raises:
        FileNotFoundError: Si ``config_path`` no existe.
        yaml.YAMLError:    Si el YAML está mal formado.
        OSError:           Si falla la escritura atómica del índice.
    """
    t_start = time.perf_counter()

    # ── 1. Cargar configuración ───────────────────────────────────────────────
    config_path = Path(config_path)
    config: dict[str, Any] = _load_config(config_path)

    project_root: Path = _resolve_project_root(config_path)
    raw_paths: dict[str, str] = config.get("paths", {})

    api_metadata_dir: Path = project_root / raw_paths.get(
        "api_metadata", "shared_data/api_metadata"
    )
    processed_dir: Path = project_root / raw_paths.get(
        "processed", "shared_data/processed"
    )
    index_path: Path = project_root / raw_paths.get(
        "index", "shared_data/index.json"
    )
    logs_dir: Path = project_root / raw_paths.get(
        "logs_dir", "logs/ingestion"
    )

    # ── 2. Logger ─────────────────────────────────────────────────────────────
    logger: logging.Logger = _setup_logger(config.get("logging", {}), logs_dir)
    logger.info("=" * 60)
    logger.info("build_index() — inicio")
    logger.info("  Raíz del proyecto : %s", project_root)
    logger.info("  api_metadata/     : %s", api_metadata_dir)
    logger.info("  processed/        : %s", processed_dir)
    logger.info("  index.json        : %s", index_path)
    logger.info("=" * 60)

    # ── 3. Caché de metadatos ─────────────────────────────────────────────────
    resource_index: dict[str, dict[str, Any]] = _load_metadata_cache(
        api_metadata_dir, logger
    )

    # ── 4. Escaneo de Parquets ────────────────────────────────────────────────
    parquet_files: list[Path] = _scan_parquet_files(processed_dir, logger)

    # ── 5. Cruce Parquet ↔ Dataset ────────────────────────────────────────────
    dataset_map, orphans = _match_parquets(parquet_files, resource_index, logger)

    logger.info(
        "Cruce completado: %d datasets emparejados, %d Parquets huérfanos.",
        len(dataset_map),
        len(orphans),
    )

    # ── 6. Agrupación por categoría ───────────────────────────────────────────
    grouped: dict[str, list[dict[str, Any]]] = _group_by_category(
        dataset_map, resource_index, orphans, logger
    )

    # ── 7. Documento de índice ────────────────────────────────────────────────
    duration: float = round(time.perf_counter() - t_start, 3)

    index_doc: dict[str, Any] = {
        "generated_at":        datetime.now(timezone.utc).isoformat(),
        "duration_seconds":    duration,
        "total_datasets":      len(dataset_map),
        "total_parquet_files": len(parquet_files),
        "unmatched_parquets":  len(orphans),
        "categories_count":    len(grouped),
        "categories":          grouped,
    }

    # ── 8. Escritura atómica ──────────────────────────────────────────────────
    _write_atomic(index_doc, index_path)

    logger.info(
        "build_index() — DONE | %.3fs | %d datasets | %d Parquets | %d categorías",
        duration,
        len(dataset_map),
        len(parquet_files),
        len(grouped),
    )
    logger.info("=" * 60)

    return index_doc
