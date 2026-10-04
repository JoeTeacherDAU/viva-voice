"""Reads a local copy of the private Blob archive (same layout as PLAN.md section 10).

The research layer never reads the roster: read_json refuses any path under roster/.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from pathlib import Path

FILLERS_DEFAULT = ["uh", "um"]
BACKCHANNELS_DEFAULT = ["mhmm", "mm-mm", "uh-huh", "uh-uh", "nuh-uh", "yeah", "right", "okay", "really"]
CLAUSE_FINAL = re.compile(r"[.?!,;]$")


class RosterAccessError(PermissionError):
    pass


def token(word: str) -> str:
    return re.sub(r"[^a-z0-9'-]", "", word.lower())


class Archive:
    def __init__(self, root: str | Path):
        self.root = Path(root)

    def read_json(self, pathname: str):
        if pathname.startswith("roster/") or "/roster/" in pathname:
            raise RosterAccessError("The research layer never reads roster files (CLAUDE.md).")
        p = self.root / pathname
        return json.loads(p.read_text(encoding="utf-8")) if p.exists() else None

    def sessions(self, exam_id: str) -> list[dict]:
        out = []
        for p in sorted((self.root / "sessions").glob("*.json")):
            rec = self.read_json(f"sessions/{p.name}")
            if rec and rec.get("examId") == exam_id:
                out.append(rec)
        return out

    def transcript(self, session_id: str) -> tuple[list[dict], str]:
        """Pass two is the record of account; pass one stands in when pass two is missing."""
        for n in (2, 1):
            t = self.read_json(f"transcripts/{session_id}/pass{n}.json")
            if t is not None:
                words = t["words"] if isinstance(t, dict) else t
                return words, f"pass{n}"
        return [], "none"

    def instructor(self, exam_id: str) -> dict | None:
        return self.read_json(f"instructor/{exam_id}.json")


@dataclass
class Turn:
    channel: int
    words: list[dict]

    @property
    def start(self) -> float:
        return self.words[0]["startMs"]

    @property
    def end(self) -> float:
        return self.words[-1]["endMs"]


@dataclass
class Context:
    """One participant in one session, with both channels' turns for interaction features."""

    session: dict
    participant: str
    channel: int
    words: list[dict]
    turns: list[Turn]
    fillers: set[str] = field(default_factory=set)
    backchannels: set[str] = field(default_factory=set)
    pause_thresholds: list[int] = field(default_factory=lambda: [200, 350])

    @property
    def own_turns(self) -> list[Turn]:
        return [t for t in self.turns if t.channel == self.channel]

    def pruned(self, words: list[dict]) -> list[dict]:
        """Same pruning rule as the app (docs/OPERATIONAL_DEFINITIONS.md)."""
        nf = [w for w in words if token(w["word"]) not in self.fillers]
        t = [token(w["word"]) for w in nf]
        drop: set[int] = set()
        i = 1
        while i < len(t):
            if t[i] == t[i - 1]:
                drop.add(i)
            elif i >= 3 and t[i - 1] == t[i - 3] and t[i] == t[i - 2]:
                drop.update({i - 1, i})
                i += 1
            i += 1
        return [w for k, w in enumerate(nf) if k not in drop and t[k] not in self.backchannels]

    def pruned_tokens(self) -> list[str]:
        return [token(w["word"]) for turn in self.own_turns for w in self.pruned(turn.words)]


ISOLATION_MS = 300


def build_turns(words: list[dict], backchannels: set[str], threshold_ms: float) -> list[Turn]:
    """Floor turns. A run of backchannel tokens leaves the floor when no other
    word on its channel sits within ISOLATION_MS on either side, so "Yeah, I
    agree" stays and an isolated "mhmm" goes. A turn then continues while the
    next floor word is on the same channel and starts within threshold_ms.

    This differs from the app in one way: a lone "okay" that answers a partner
    counts as a backchannel here, where the app counts it as a floor turn. The
    research features treat such minimal responses as non-units."""
    floor: list[dict] = []
    for ch in (0, 1):
        own = sorted((w for w in words if w["channel"] == ch), key=lambda w: w["startMs"])
        i = 0
        while i < len(own):
            if token(own[i]["word"]) not in backchannels:
                floor.append(own[i])
                i += 1
                continue
            j = i
            while j + 1 < len(own) and token(own[j + 1]["word"]) in backchannels:
                j += 1
            before = own[i - 1] if i > 0 else None
            after = own[j + 1] if j + 1 < len(own) else None
            isolated = (before is None or own[i]["startMs"] - before["endMs"] > ISOLATION_MS) and (
                after is None or after["startMs"] - own[j]["endMs"] > ISOLATION_MS
            )
            if not isolated:
                floor.extend(own[i : j + 1])
            i = j + 1
    floor.sort(key=lambda w: (w["startMs"], w["channel"]))
    turns: list[Turn] = []
    for w in floor:
        cur = turns[-1] if turns else None
        if cur and cur.channel == w["channel"] and w["startMs"] - cur.end <= threshold_ms:
            cur.words.append(w)
        else:
            turns.append(Turn(w["channel"], [w]))
    return turns


def contexts(session: dict, words: list[dict]) -> list[Context]:
    cfg = session.get("config", {})
    fillers = {token(x) for x in cfg.get("fillerTokens", FILLERS_DEFAULT)}
    bc = {token(x) for x in cfg.get("backchannelTokens", BACKCHANNELS_DEFAULT)}
    markers = session.get("markers") or {}
    lo, hi = markers.get("startMs"), markers.get("stopMs")
    kept = [
        w
        for w in words
        if not w.get("removedAsCrosstalk")
        and w.get("isFinal", True)
        and (lo is None or w["startMs"] >= lo)
        and (hi is None or w["endMs"] <= hi)
    ]
    kept.sort(key=lambda w: (w["startMs"], w["channel"]))
    turns = build_turns(kept, bc, cfg.get("turnThresholdMs", 1500))
    cmap = session.get("channelMap") or {"0": "A", "1": "B"}
    out = []
    for ch in (0, 1):
        out.append(
            Context(
                session=session,
                participant=cmap[str(ch)],
                channel=ch,
                words=[w for w in kept if w["channel"] == ch],
                turns=turns,
                fillers=fillers,
                backchannels=bc,
                pause_thresholds=cfg.get("pauseThresholdsMs", [200, 350]),
            )
        )
    return out
