"""
scrapers/meta_builder.py
========================
Módulo de fabricación de metadatos sintéticos 100% compatibles con CKAN.

Responsabilidad única:
    Recibir diccionarios/parámetros y retornar un ``dict`` Python.

Restricción absoluta (Sección 3 — Arquitectura):
    CERO efectos secundarios. Este módulo NUNCA escribe a disco.
    Prohibido: open(), aiofiles, Path.write_text(), json.dump(file), etc.
    Su output es siempre un ``dict`` Python o ``None``.

Contrato de salida (Sección 3.2):
    ``build()`` retorna exactamente 13 campos o ``None``:
        source, id, name, title, description, metadata_created,
        metadata_modified, groups, organization, tags, resources,
        source_url, num_rows.

Uso típico::

    from scrapers.meta_builder import build

    metadata = build(
        scraper_id="mercomuna",
        base_url="https://mercomuna.cdmx.gob.mx",
        scraper_metadata=adapter.get_metadata(),
        groups_yaml=[{"name": "movilidad", "display_name": "Movilidad"}],
        organization_yaml={"name": "cdmx", "title": "Gobierno CDMX"},
        tags_yaml=[{"name": "mercado"}],
        csv_path=Path("shared_data/raw/mercomuna.csv"),
        num_rows=4200,
        existing_created="2025-03-01T00:00:00+00:00",
        df=dataframe,
    )
    # metadata es un dict con 13 campos, o None si csv_path no existe.
"""

from __future__ import annotations

import hashlib
import logging
import re
import unicodedata
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    # Importación condicional para type hints sin crear dependencia
    # en tiempo de ejecución. El módulo opera con duck-typing sobre
    # cualquier DataFrame que exponga `.columns`.
    import polars as pl

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Sección 3.4 — Diccionario de inferencia de tags
# ---------------------------------------------------------------------------

_TAG_KEYWORD_MAP: dict[str, list[str]] = {
    "movilidad": [
        "metro", "autobus", "bicicleta", "vialidad", "transporte", "ruta",
        "estacion", "vehiculo", "trafico", "semaforo", "ecobici", "metrobus",
        "tren", "linea", "parada", "parquimetro", "accidente", "aforo",
        "corredor", "ciclo", "taxi", "moto",
    ],
    "medio-ambiente": [
        "aire", "calidad", "imeca", "contaminacion", "residuo", "reciclaje",
        "verde", "parque", "arbol", "agua", "suelo", "basura", "ecologia",
        "temperatura", "clima", "lluvia", "ozono", "pm25", "pm10",
        "emisiones", "dioxido", "carbono", "flora", "fauna",
    ],
    "salud": [
        "hospital", "medico", "clinica", "enfermedad", "mortalidad",
        "natalidad", "vacuna", "salud", "paciente", "urgencia",
        "defuncion", "nacimiento", "cama", "atencion", "unidad",
        "epidemiologia", "morbilidad", "nutricion",
    ],
    "seguridad": [
        "delito", "robo", "homicidio", "incidente", "policia", "crimen",
        "lesion", "fraude", "extorsion", "secuestro", "denuncia",
        "victima", "carpeta", "fiscalia", "ministerio", "juicio",
        "sentencia", "flagrancia",
    ],
    "desarrollo-urbano": [
        "vivienda", "predio", "colonia", "construccion", "alcaldia",
        "delegacion", "obra", "licencia", "suelo", "lote",
        "edificio", "fraccionamiento", "catastro", "uso", "zonificacion",
        "regularizacion", "intervencion",
    ],
    "inclusion": [
        "social", "pobreza", "discapacidad", "adulto", "menor", "familia",
        "beneficiario", "programa", "subsidio", "pension", "vulnerabilidad",
        "indigena", "genero", "mujer", "igualdad", "diversidad",
    ],
    "turismo": [
        "museo", "monumento", "zona", "hotel", "atractivo",
        "cultural", "historico", "patrimonio", "galeria", "teatro",
        "restaurante", "mercado", "sitio", "recorrido",
    ],
    "participacion-ciudadana": [
        "consulta", "voto", "ciudadano", "queja", "peticion",
        "presupuesto", "participacion", "propuesta", "encuesta",
        "transparencia", "rendicion", "cuenta",
    ],
    "gobierno": [
        "tramite", "servicio", "dependencia", "oficina",
        "secretaria", "direccion", "contrato", "licitacion",
        "gasto", "ejercicio", "fideicomiso", "deuda",
    ],
    "atencion-ciudadana": [
        "queja", "solicitud", "servicio", "linea", "centro",
        "atencion", "reporte", "incidencia", "portal",
    ],
}


# ---------------------------------------------------------------------------
# Helpers internos — sin efectos secundarios
# ---------------------------------------------------------------------------

def _strip_accents(text: str) -> str:
    """
    Elimina diacríticos (acentos y marcas combinatorias) usando ``unicodedata``.

    Aplica descomposición NFKD y descarta los caracteres de la categoría
    "Mn" (Mark, Nonspacing), que son los combinatorios (acentos, tildes, etc.).

    Ejemplo::

        _strip_accents("Tráfico Aéreo") == "Trafico Aereo"
        _strip_accents("Información")   == "Informacion"

    Args:
        text: Cadena de entrada Unicode.

    Returns:
        Cadena equivalente sin diacríticos.
    """
    nfkd_form = unicodedata.normalize("NFKD", text)
    return "".join(ch for ch in nfkd_form if not unicodedata.combining(ch))


def _slugify(text: str) -> str:
    """
    Genera un slug URL-safe y compatible con CKAN (Sección 3.3).

    Algoritmo:
        1. Elimina acentos con ``_strip_accents``.
        2. Convierte a minúsculas.
        3. Reemplaza secuencias de caracteres no alfanuméricos por ``"-"``.
        4. Colapsa guiones múltiples en uno solo.
        5. Elimina guiones en los extremos.

    Ejemplos::

        _slugify("Datos de Tráfico Vial 2024") == "datos-de-trafico-vial-2024"
        _slugify("  Calidad del Aire (IMECA)  ") == "calidad-del-aire-imeca"
        _slugify("") == ""

    Args:
        text: Cadena de entrada (puede contener acentos, espacios, etc.).

    Returns:
        Slug normalizado. Cadena vacía si el input no produce tokens válidos.
    """
    cleaned: str = _strip_accents(text).lower()
    slug: str = re.sub(r"[^a-z0-9]+", "-", cleaned)
    slug = re.sub(r"-{2,}", "-", slug)
    return slug.strip("-")


def _sha1_id(scraper_id: str, base_url: str) -> str:
    """
    Genera un identificador estable y reproducible mediante SHA-1 (Sección 3.3).

    El hash se calcula sobre ``"{scraper_id}|{base_url}"`` en UTF-8.
    La misma combinación de entradas siempre produce el mismo hexdigest,
    garantizando estabilidad del ``id`` entre ejecuciones.

    Args:
        scraper_id: Identificador único del scraper. Ej: ``"mercomuna"``.
        base_url:   URL base de la fuente. Ej: ``"https://example.com"``.

    Returns:
        Cadena hexadecimal de 40 caracteres (SHA-1 digest).
    """
    payload: bytes = f"{scraper_id}|{base_url}".encode("utf-8")
    return hashlib.sha1(payload).hexdigest()  # noqa: S324 (SHA-1 para ID, no criptografía)


def _now_iso() -> str:
    """
    Retorna el timestamp UTC actual en formato ISO 8601 con offset explícito.

    Ejemplo: ``"2025-04-18T22:15:30.123456+00:00"``

    Returns:
        String ISO 8601 del momento actual en UTC.
    """
    return datetime.now(timezone.utc).isoformat()


def _build_resources(
    csv_path: Path,
    scraper_id: str,
    source_url: str,
) -> list[dict[str, str]]:
    """
    Construye la lista de recursos CKAN derivada del CSV del scraper.

    Genera un UUID v5 determinístico a partir de la ruta del CSV, garantizando
    que el ``id`` del recurso sea estable entre ejecuciones sin necesidad de
    persistencia adicional.

    Args:
        csv_path:   Ruta (``pathlib.Path``) al CSV generado por el scraper.
        scraper_id: ID del scraper; se usa como nombre del recurso.
        source_url: URL de la fuente original del dato.

    Returns:
        Lista con un único recurso en formato CKAN::

            [{"id": str, "url": str, "format": "CSV", "name": str}]
    """
    resource_id: str = str(uuid.uuid5(uuid.NAMESPACE_URL, csv_path.as_posix()))
    return [
        {
            "id":     resource_id,
            "url":    source_url,
            "format": "CSV",
            "name":   f"{scraper_id}.csv",
        }
    ]


# ---------------------------------------------------------------------------
# Sección 3.4 — Inferencia de tags desde contenido
# ---------------------------------------------------------------------------

def infer_tags_from_content(df: Any) -> list[dict[str, str]]:
    """
    Infiere tags temáticos analizando los nombres de columna del DataFrame.

    Algoritmo:
        1. Extrae los nombres de columna del DataFrame.
        2. Normaliza cada nombre: elimina acentos, convierte a minúsculas.
        3. Tokeniza por separadores comunes (``_``, ``-``, espacio, ``/``, etc.).
        4. Compara los tokens contra ``_TAG_KEYWORD_MAP``.
        5. Añade el tag si hay al menos una coincidencia en esa categoría.

    Compatibilidad:
        Acepta cualquier DataFrame que exponga ``.columns`` como iterable
        de strings (polars, pandas, etc.). El duck-typing es intencional.

    Robustez:
        Esta función NUNCA propaga excepciones. Ante cualquier fallo
        (DataFrame ``None``, atributo faltante, tipo inesperado) retorna ``[]``
        y emite un ``WARNING`` al logger.
        El llamador no necesita capturar errores de esta función.

    Importante:
        Esta función solo infiere tags; NO decide cuáles conservar del YAML.
        La deduplicación (YAML tiene prioridad) es responsabilidad de ``build()``.

    Args:
        df: DataFrame (polars o cualquier objeto con atributo ``.columns``).
            Puede ser ``None``; en ese caso retorna ``[]`` inmediatamente.

    Returns:
        Lista de tags únicos inferidos, ordenados alfabéticamente::

            [{"name": "movilidad"}, {"name": "seguridad"}, ...]

        Lista vacía si no hay coincidencias, el DF está vacío, o ocurre un error.
    """
    try:
        if df is None:
            return []

        # .columns es list[str] en polars e Index[str] en pandas.
        # Ambos son iterables — cast seguro a list.
        columns: list[str] = list(df.columns)
        if not columns:
            return []

        # Tokenización: normalizar + split por delimitadores
        all_tokens: set[str] = set()
        for col in columns:
            normalized: str = _strip_accents(str(col)).lower()
            # Separadores: espacio, _, -, /, \, |, .
            tokens: list[str] = re.split(r"[\s_\-/\\|.]+", normalized)
            # Solo tokens con >= 3 chars para evitar falsos positivos
            all_tokens.update(t for t in tokens if len(t) >= 3)

        # Coincidencia contra mapa de keywords
        matched: set[str] = set()
        for tag_name, keywords in _TAG_KEYWORD_MAP.items():
            if any(kw in all_tokens for kw in keywords):
                matched.add(tag_name)

        return [{"name": tag} for tag in sorted(matched)]

    except Exception as exc:  # noqa: BLE001
        logger.warning(
            "[meta_builder.infer_tags_from_content] Fallo silencioso: %s — "
            "Se retorna [] para no interrumpir el pipeline.",
            exc,
        )
        return []


# ---------------------------------------------------------------------------
# Helper público — preservación de timestamp de creación
# ---------------------------------------------------------------------------

def load_existing_created(metadata_path: str | Path) -> str | None:
    """
    Extrae el campo ``metadata_created`` de un archivo JSON de metadata
    ya existente, para preservarlo en ejecuciones posteriores.

    IMPORTANTE: Esta función SÍ lee desde disco (es un helper de carga,
    no de escritura). No viola la restricción de efectos secundarios de
    ``build()``, que es quien debe permanecer puro.

    Uso típico en ``BaseScraper.run()``::

        existing_created = load_existing_created(metadata_json_path)
        meta = build(..., existing_created=existing_created)

    Args:
        metadata_path: Ruta al JSON de metadata previo
                       (``shared_data/api_metadata/scraper_<id>_*.json``).

    Returns:
        String ISO 8601 del ``metadata_created`` original, o ``None``
        si el archivo no existe, no es JSON válido, o no tiene ese campo.
    """
    import json  # Import local para mantener los imports del módulo limpios

    path = Path(metadata_path)
    if not path.exists():
        return None

    try:
        with path.open(encoding="utf-8") as fh:
            data: dict[str, Any] = json.load(fh)
        return data.get("metadata_created") or None
    except Exception as exc:  # noqa: BLE001
        logger.warning(
            "[meta_builder.load_existing_created] No se pudo leer '%s': %s",
            path,
            exc,
        )
        return None


# ---------------------------------------------------------------------------
# Sección 3.2 — Función principal
# ---------------------------------------------------------------------------

def build(
    scraper_id: str,
    base_url: str,
    scraper_metadata: dict[str, Any],
    groups_yaml: list[dict[str, str]],
    organization_yaml: dict[str, str],
    tags_yaml: list[dict[str, str]],
    csv_path: str | Path,
    num_rows: int,
    existing_created: str | None = None,
    df: Any = None,
) -> dict[str, Any] | None:
    """
    Construye un diccionario de metadatos sintéticos 100% compatibles con CKAN.

    CONTRATO ABSOLUTO (Sección 3.2):
        - Retorna exactamente 13 campos o ``None``.
        - No escribe nada a disco. Nunca.
        - No propaga excepciones. Los errores se loguean.

    CAMPOS DE SALIDA (13 exactos):

    .. list-table::
       :header-rows: 1

       * - Campo
         - Tipo
         - Descripción
       * - ``source``
         - ``str``
         - Valor fijo: ``"scraper"``
       * - ``id``
         - ``str``
         - SHA-1 de ``scraper_id + base_url``
       * - ``name``
         - ``str``
         - Slug del título (normalizado con unicodedata)
       * - ``title``
         - ``str``
         - Desde ``scraper_metadata["title"]``
       * - ``description``
         - ``str``
         - Desde ``scraper_metadata["description"]``
       * - ``metadata_created``
         - ``str``
         - ISO 8601; preservado si ``existing_created`` se pasa
       * - ``metadata_modified``
         - ``str``
         - ISO 8601; siempre el timestamp UTC actual
       * - ``groups``
         - ``list[dict]``
         - Desde ``groups_yaml``; fallback ``"Sin Clasificar"``
       * - ``organization``
         - ``dict``
         - Desde ``organization_yaml``
       * - ``tags``
         - ``list[dict]``
         - YAML (prioridad) + inferidos del DataFrame (sin duplicados)
       * - ``resources``
         - ``list[dict]``
         - Generados desde ``csv_path``
       * - ``source_url``
         - ``str``
         - Desde ``scraper_metadata["source_url"]`` o ``base_url``
       * - ``num_rows``
         - ``int``
         - Número de filas del dataset

    REGLA DE TAGS (Sección 3.4):
        Los tags del YAML tienen prioridad absoluta y NUNCA se pierden.
        Los tags inferidos del DataFrame solo se añaden si su ``name``
        no aparece ya en ``tags_yaml``.

    REGLA DE ERROR CRÍTICO (Sección 3.6):
        Si ``csv_path`` no existe en disco → ``logger.error`` + ``return None``.
        Ningún otro error en ``build()`` retorna ``None``; se usan fallbacks.

    Args:
        scraper_id:
            Identificador único del scraper. Componente del hash SHA-1.
            Ejemplo: ``"mercomuna"``.
        base_url:
            URL base de la fuente de datos. Componente del hash SHA-1.
            Ejemplo: ``"https://mercomuna.cdmx.gob.mx"``.
        scraper_metadata:
            Dict retornado por ``BaseScraper.get_metadata()``.
            Campos esperados: ``title`` (str), ``description`` (str),
            ``source_url`` (str). Campos adicionales se ignoran.
        groups_yaml:
            Grupos de clasificación temática desde el YAML del scraper.
            Formato: ``[{"name": str, "display_name": str}]``.
            Si viene vacía: fallback a ``[{"name": "sin-clasificar", ...}]``.
        organization_yaml:
            Organización responsable desde el YAML.
            Formato: ``{"name": str, "title": str}``.
        tags_yaml:
            Tags explícitos del YAML. Formato: ``[{"name": str}]``.
            Su presencia bloquea la adición del mismo tag inferido.
        csv_path:
            Ruta al CSV generado por el scraper. **DEBE existir** (Sec. 3.6).
        num_rows:
            Número de filas del dataset para el campo de referencia.
        existing_created:
            ISO 8601 de la creación original del metadata. Si se pasa,
            ``metadata_created`` hereda este valor. Si es ``None``,
            se genera uno nuevo. Usar con ``load_existing_created()``.
        df:
            DataFrame opcional para enriquecer tags por inferencia de contenido.
            Acepta polars o cualquier objeto con ``.columns`` iterable.
            Si es ``None``, la inferencia de tags se omite.

    Returns:
        ``dict`` con exactamente 13 campos si ``csv_path`` existe.
        ``None`` si ``csv_path`` no existe en disco (Sección 3.6).

    Raises:
        Esta función no propaga excepciones. Los errores se emiten al
        logger estándar y se resuelven con fallbacks o ``None``.
    """
    # ------------------------------------------------------------------
    # SECCIÓN 3.6 — Validación de csv_path (única causa de retorno None)
    # ------------------------------------------------------------------
    csv_path = Path(csv_path)
    if not csv_path.exists():
        logger.error(
            "[meta_builder.build] csv_path no existe en disco: '%s'. "
            "No se puede construir metadata para scraper_id='%s'. "
            "Retornando None según Sección 3.6.",
            csv_path,
            scraper_id,
        )
        return None

    # ------------------------------------------------------------------
    # Campos básicos — con fallbacks seguros
    # ------------------------------------------------------------------
    title: str = (scraper_metadata.get("title") or "").strip()
    if not title:
        logger.warning(
            "[meta_builder.build] scraper_id='%s': 'title' ausente o vacío. "
            "Usando scraper_id='%s' como fallback de título.",
            scraper_id,
            scraper_id,
        )
        title = scraper_id

    description: str = (scraper_metadata.get("description") or "").strip()
    if not description:
        logger.warning(
            "[meta_builder.build] scraper_id='%s': 'description' ausente. "
            "El campo quedará vacío.",
            scraper_id,
        )

    source_url: str = (scraper_metadata.get("source_url") or "").strip() or base_url

    # ------------------------------------------------------------------
    # ID estable (SHA-1) y slug normalizado (Sección 3.3)
    # ------------------------------------------------------------------
    dataset_id: str = _sha1_id(scraper_id, base_url)

    name: str = _slugify(title)
    if not name:
        # Fallback: slugify del scraper_id; si también vacío, usar id literal
        name = _slugify(scraper_id) or scraper_id
        logger.warning(
            "[meta_builder.build] scraper_id='%s': slug vacío tras normalizar "
            "título. Usando fallback name='%s'.",
            scraper_id,
            name,
        )

    # ------------------------------------------------------------------
    # Timestamps UTC
    # ------------------------------------------------------------------
    now_str: str = _now_iso()
    metadata_created: str = existing_created if existing_created else now_str
    metadata_modified: str = now_str

    # ------------------------------------------------------------------
    # Groups — fallback "Sin Clasificar" si la lista está vacía (Sec. 3.6)
    # ------------------------------------------------------------------
    if groups_yaml:
        groups: list[dict[str, str]] = [
            {
                "name":         g.get("name", ""),
                "display_name": g.get("display_name", g.get("name", "")),
            }
            for g in groups_yaml
        ]
    else:
        logger.warning(
            "[meta_builder.build] scraper_id='%s': groups_yaml vacío. "
            "Aplicando fallback 'Sin Clasificar'.",
            scraper_id,
        )
        groups = [{"name": "sin-clasificar", "display_name": "Sin Clasificar"}]

    # ------------------------------------------------------------------
    # Organization
    # ------------------------------------------------------------------
    organization: dict[str, str] = {
        "name":  organization_yaml.get("name", ""),
        "title": organization_yaml.get("title", ""),
    }

    # ------------------------------------------------------------------
    # Tags: YAML (prioridad) + inferidos (solo nuevos) — Sección 3.4
    # ------------------------------------------------------------------
    # Conjunto de nombres ya presentes en el YAML (para deduplicación O(1))
    yaml_tag_names: set[str] = {
        t["name"]
        for t in tags_yaml
        if isinstance(t, dict) and "name" in t
    }

    # Inferencia desde DataFrame (falla silenciosamente si df es None o hay error)
    inferred_tags: list[dict[str, str]] = (
        infer_tags_from_content(df) if df is not None else []
    )

    # Solo añadimos los tags inferidos que no están ya en el YAML
    extra_tags: list[dict[str, str]] = [
        t for t in inferred_tags if t.get("name") not in yaml_tag_names
    ]
    tags: list[dict[str, str]] = list(tags_yaml) + extra_tags

    # ------------------------------------------------------------------
    # Resources — generados desde csv_path (ya validado arriba)
    # ------------------------------------------------------------------
    resources: list[dict[str, str]] = _build_resources(csv_path, scraper_id, source_url)

    # ------------------------------------------------------------------
    # Resultado final — exactamente 13 campos (Sección 3.2)
    # ------------------------------------------------------------------
    return {
        "source":            "scraper",
        "id":                dataset_id,
        "name":              name,
        "title":             title,
        "description":       description,
        "metadata_created":  metadata_created,
        "metadata_modified": metadata_modified,
        "groups":            groups,
        "organization":      organization,
        "tags":              tags,
        "resources":         resources,
        "source_url":        source_url,
        "num_rows":          num_rows,
    }
