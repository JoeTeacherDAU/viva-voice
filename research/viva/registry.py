"""Reads lib/registry/features.json, the one feature registry the app and this layer share."""

from __future__ import annotations

import json
import os
from functools import lru_cache
from pathlib import Path

DEFAULT_PATH = Path(__file__).resolve().parents[2] / "lib" / "registry" / "features.json"


@lru_cache(maxsize=None)
def load(path: str | None = None) -> dict:
    p = Path(path or os.environ.get("VIVA_REGISTRY", DEFAULT_PATH))
    return json.loads(p.read_text(encoding="utf-8"))


def features(path: str | None = None) -> dict[str, dict]:
    return {f["id"]: f for f in load(path)["features"]}


def version(path: str | None = None) -> str:
    return load(path)["registryVersion"]
