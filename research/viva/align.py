"""Forced-alignment features (tier 3): rhythm, aligned syllable rate, segmentals.

These need the Montreal Forced Aligner (or WhisperX) run over the archived
48 kHz audio, which version 1 does not install. compute() raises Unavailable
with that message; export.py records each id as skipped.
"""

from __future__ import annotations

import shutil

from .archive import Context
from .base import Unavailable, Value

COMPUTES = [
    "articulation_rate_syllables_aligned",
    "syllable_duration_sd_normalised",
    "npvi_vocalic",
    "percent_v",
    "varco_v",
    "vowel_reduction_ratio",
    "stressed_words_per_minute",
    "vowel_space_area",
    "vowel_pair_pillai_score",
    "vot_voiceless_stops_ms",
    "gop_phone_scores",
]
SKIPS: dict[str, str] = {}


def compute(ctx: Context) -> list[Value]:
    if shutil.which("mfa") is None:
        raise Unavailable("Montreal Forced Aligner (mfa) is not installed; alignment features are not computed")
    raise Unavailable("MFA is installed, but the alignment wrapper is not built in version 1")
