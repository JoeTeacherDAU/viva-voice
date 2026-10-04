"""Verbatim recognition pass with CrisperWhisper (RESEARCH_PRINCIPLES.md principle 5).

CrisperWhisper (Wagner, Thallinger, and Zusag 2024, arXiv 2408.16589) is an
English Whisper model fine-tuned to keep fillers, false starts, and
repetitions, with word timestamps. run() transcribes each channel of the
archived WAV when someone has installed the model and points VIVA_CRISPERWHISPER
at it, and writes transcripts/{id}/verbatim-A.json and verbatim-B.json. The
app never writes these slots. compute() reads a slot and counts what it holds;
it never writes a score.

The counting rules: a filler is a token such as [UH] or [UM] (brackets
optional) from the list below; a partial word is a token that ends with a
hyphen; a repetition is a non-filler token equal to the one before it. Check
these against the model's actual output before relying on them.
"""

from __future__ import annotations

import importlib.util
import json
import os
import re
import wave
from datetime import datetime, timezone
from pathlib import Path

from .archive import Archive, Context, token
from .base import Unavailable, Value

COMPUTES = [
    "verbatim_filler_count",
    "verbatim_partial_word_count",
    "verbatim_repetition_count",
    "asr_verbatim_word_disagreement",
]
SKIPS: dict[str, str] = {}

NOT_INSTALLED = "CrisperWhisper not installed"
FILLER = re.compile(r"^\[?(uh|um|uhm|er|erm|ah|eh|hmm|mm|mhm)\]?$", re.IGNORECASE)


def model_path() -> str | None:
    """The local model directory, when the model and its Python stack are installed."""
    path = os.environ.get("VIVA_CRISPERWHISPER")
    if not path or not Path(path).exists():
        return None
    if any(importlib.util.find_spec(m) is None for m in ("transformers", "torch", "numpy")):
        return None
    return path


def slot_path(session_id: str, participant: str) -> str:
    return f"transcripts/{session_id}/verbatim-{participant}.json"


def run(archive_root: str | Path, session: dict) -> list[Path]:  # pragma: no cover - needs the model
    """Transcribes both channels of audio/{id}/stereo.wav into the verbatim slots."""
    path = model_path()
    if path is None:
        raise Unavailable(NOT_INSTALLED)
    import numpy as np
    from transformers import pipeline

    root = Path(archive_root)
    with wave.open(str(root / "audio" / session["id"] / "stereo.wav")) as wav:
        rate = wav.getframerate()
        pcm = np.frombuffer(wav.readframes(wav.getnframes()), dtype=np.int16).reshape(-1, 2) / 32768.0
    asr = pipeline("automatic-speech-recognition", model=path, return_timestamps="word")
    cmap = session.get("channelMap") or {"0": "A", "1": "B"}
    written = []
    for ch in (0, 1):
        out = asr({"raw": pcm[:, ch].astype("float32"), "sampling_rate": rate})
        words = [
            {"word": c["text"].strip(), "startMs": round(c["timestamp"][0] * 1000), "endMs": round((c["timestamp"][1] or c["timestamp"][0]) * 1000)}
            for c in out.get("chunks", [])
        ]
        target = root / slot_path(session["id"], cmap[str(ch)])
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps({"model": path, "createdAt": datetime.now(timezone.utc).isoformat(), "words": words}))
        written.append(target)
    return written


def edit_distance(a: list[str], b: list[str]) -> int:
    prev = list(range(len(b) + 1))
    for i, x in enumerate(a, 1):
        cur = [i]
        for j, y in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x != y)))
        prev = cur
    return prev[-1]


def compute(ctx: Context) -> list[Value]:
    slot = ctx.archive.read_json(slot_path(ctx.session["id"], ctx.participant)) if ctx.archive else None
    if slot is None:
        raise Unavailable(NOT_INSTALLED if model_path() is None else "verbatim slot missing; run viva-research verbatim")
    raw = [w["word"].strip() for w in slot.get("words", []) if w.get("word", "").strip()]
    fillers = [t for t in raw if FILLER.match(t)]
    words = [token(t) for t in raw if not FILLER.match(t)]
    partial = sum(1 for t in raw if t.endswith("-"))
    repeats = sum(1 for a, b in zip(words, words[1:]) if a and a == b)
    main = [token(w["word"]) for t in ctx.own_turns for w in t.words if not FILLER.match(w["word"])]
    disagreement = edit_distance(main, words) / len(words) if words else None
    return [
        Value("verbatim_filler_count", len(fillers)),
        Value("verbatim_partial_word_count", partial),
        Value("verbatim_repetition_count", repeats),
        Value("asr_verbatim_word_disagreement", disagreement),
    ]
