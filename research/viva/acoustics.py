"""Acoustic features (tier 3): pitch, intensity, voice quality, eGeMAPS.

These need Praat through parselmouth and openSMILE over the archived audio,
which version 1 does not install. compute() raises Unavailable with the
missing tool's name; export.py records each id as skipped.
"""

from __future__ import annotations

import importlib.util

from .archive import Context
from .base import Unavailable, Value

COMPUTES = [
    "f0_range_semitones",
    "f0_sd_semitones",
    "f0_slope_per_utterance",
    "intensity_variation_db",
    "egemaps_feature_set",
    "f1_derivative_sd",
    "voice_quality_hnr_jitter_shimmer",
    "speaking_f0_mean",
    "pause_acoustic_vs_asr_agreement",
    "filled_pause_acoustic",
    "laughter_and_nonspeech_events",
]
SKIPS: dict[str, str] = {}


def compute(ctx: Context) -> list[Value]:
    missing = [m for m in ("parselmouth", "opensmile") if importlib.util.find_spec(m) is None]
    if missing:
        raise Unavailable(f"{' and '.join(missing)} not installed; acoustic features are not computed")
    raise Unavailable("parselmouth and openSMILE are installed, but the acoustic wrapper is not built in version 1")
