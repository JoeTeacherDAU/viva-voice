"""Free phone recognition (RESEARCH_PRINCIPLES.md principles 4 and 5).

run() transcribes each channel of the archived WAV into phone strings with a
wav2vec2 model fine-tuned on eSpeak phone labels
(facebook/wav2vec2-xlsr-53-espeak-cv-ft) when someone has installed it and
points VIVA_PHONES_MODEL at it, and writes phones/{id}/A.json and B.json. The
app never writes these slots. A free phone recognizer reports the phones it
hears without forcing them into English words; the CMU dictionary form serves
only as a coordinate for locating variants. This module writes phone strings
and spans, never a score.

Version 1 stores phone strings but does not yet code variants against the
dictionary form, so the variant features stay skipped even when slots exist.
"""

from __future__ import annotations

import importlib.util
import json
import os
import wave
from datetime import datetime, timezone
from pathlib import Path

from .archive import Context
from .base import Unavailable, Value

MODEL = "facebook/wav2vec2-xlsr-53-espeak-cv-ft"
COMPUTES = [
    "realized_phone_sequence",
    "vowel_epenthesis_rate",
    "nasalization_variant_rate",
    "consonant_variant_inventory",
    "korean_filler_candidates",
]
SKIPS: dict[str, str] = {}

NOT_INSTALLED = f"{MODEL} not installed"
NOT_BUILT = "phone-variant coding against the CMU dictionary form is not built in version 1; phone strings stay in the phones slots"


def model_path() -> str | None:
    path = os.environ.get("VIVA_PHONES_MODEL")
    if not path or not Path(path).exists():
        return None
    if any(importlib.util.find_spec(m) is None for m in ("transformers", "torch", "numpy")):
        return None
    return path


def slot_path(session_id: str, participant: str) -> str:
    return f"phones/{session_id}/{participant}.json"


def run(archive_root: str | Path, session: dict) -> list[Path]:  # pragma: no cover - needs the model
    path = model_path()
    if path is None:
        raise Unavailable(NOT_INSTALLED)
    import numpy as np
    from transformers import pipeline

    root = Path(archive_root)
    with wave.open(str(root / "audio" / session["id"] / "stereo.wav")) as wav:
        rate = wav.getframerate()
        pcm = np.frombuffer(wav.readframes(wav.getnframes()), dtype=np.int16).reshape(-1, 2) / 32768.0
    asr = pipeline("automatic-speech-recognition", model=path, return_timestamps="char")
    cmap = session.get("channelMap") or {"0": "A", "1": "B"}
    written = []
    for ch in (0, 1):
        out = asr({"raw": pcm[:, ch].astype("float32"), "sampling_rate": rate})
        segments = [
            {"phones": c["text"], "startMs": round(c["timestamp"][0] * 1000), "endMs": round((c["timestamp"][1] or c["timestamp"][0]) * 1000)}
            for c in out.get("chunks", [])
        ]
        target = root / slot_path(session["id"], cmap[str(ch)])
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps({"model": path, "createdAt": datetime.now(timezone.utc).isoformat(), "segments": segments}))
        written.append(target)
    return written


def compute(ctx: Context) -> list[Value]:
    slot = ctx.archive.read_json(slot_path(ctx.session["id"], ctx.participant)) if ctx.archive else None
    if slot is None and model_path() is None:
        raise Unavailable(NOT_INSTALLED)
    raise Unavailable(NOT_BUILT)
