#!/bin/bash
set -e
cd "$(dirname "$0")/.."
uv run python -m data_ingestion.src.pipeline
