"""Shared types for the feature modules.

Each module declares COMPUTES (registry ids it computes) and SKIPS (registry
ids it owns but cannot compute yet, each with the reason), and exposes
compute(ctx) -> list[Value]. A module whose tooling is absent raises
Unavailable from compute(); export.py then records every id it owns as
skipped with that message.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Value:
    feature_id: str
    value: float | None
    threshold_ms: int | None = None


class Unavailable(NotImplementedError):
    """Raised by a tier 3 module whose external tool is missing."""


def mean(xs: list[float]) -> float | None:
    return sum(xs) / len(xs) if xs else None


def per_100(count: int, words: int) -> float | None:
    return count / words * 100 if words else None
