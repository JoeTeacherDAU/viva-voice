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
    archive: "Archive | None" = None

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
        # Backchannels never enter a turn; a backchannel-token word in a turn is ordinary.
        return [w for k, w in enumerate(nf) if k not in drop]

    def pruned_tokens(self) -> list[str]:
        return [token(w["word"]) for turn in self.own_turns for w in self.pruned(turn.words)]


def _turns_from(floor: list[dict]) -> list[Turn]:
    """A turn closes only when a partner floor word starts; same-channel silence stays inside."""
    turns: list[Turn] = []
    for w in sorted(floor, key=lambda w: (w["startMs"], w["channel"])):
        cur = turns[-1] if turns else None
        if cur and cur.channel == w["channel"]:
            cur.words.append(w)
        else:
            turns.append(Turn(w["channel"], [w]))
    return turns


@dataclass
class Candidate:
    """A backchannel candidate and the facts that classify it (docs/OPERATIONAL_DEFINITIONS.md)."""

    words: list[dict]
    overlaps_partner: bool
    partner_silence_ms: float | None
    partner_resumes_next: bool
    floor_class: str  # "backchannel", "standalone_turn", or "turn_part"


def classify_candidates(words: list[dict], backchannels: set[str], floor_lapse_ms: float) -> list[Candidate]:
    """The app's rule. A candidate is a run of backchannel tokens on one channel
    with no partner word starting inside it. It is a backchannel only while the
    partner holds the floor: inside a partner turn (computed without
    candidates), and either overlapping a partner word or inside a partner
    silence shorter than floor_lapse_ms (config floorLapseMs). Any other run is
    floor speech: "standalone_turn" when it is the student's entire turn,
    "turn_part" when it opens or sits inside a longer turn by the same student."""
    runs: list[list[dict]] = []
    for ch in (0, 1):
        own = sorted((w for w in words if w["channel"] == ch), key=lambda w: w["startMs"])
        partner_starts = [w["startMs"] for w in words if w["channel"] != ch]
        run: list[dict] = []
        for w in own:
            if token(w["word"]) not in backchannels:
                if run:
                    runs.append(run)
                run = []
                continue
            if run and any(run[-1]["startMs"] < s < w["startMs"] for s in partner_starts):
                runs.append(run)
                run = []
            run.append(w)
        if run:
            runs.append(run)
    cand_ids = {id(w) for g in runs for w in g}
    floor = [w for w in words if id(w) not in cand_ids]
    first = _turns_from(floor)

    out: list[Candidate] = []
    for g in runs:
        ch, start, end = g[0]["channel"], g[0]["startMs"], g[-1]["endMs"]
        partner = [w for w in floor if w["channel"] != ch]
        own = sorted((w for w in floor if w["channel"] == ch), key=lambda w: w["startMs"])
        overlaps = any(w["startMs"] < end and start < w["endMs"] for w in partner)
        before = [w for w in partner if w["startMs"] <= start]
        nxt = min((w for w in partner if w["startMs"] >= end), key=lambda w: w["startMs"], default=None)
        own_next = next((w for w in own if w["startMs"] >= end), None)
        prev = max(before, key=lambda w: w["startMs"], default=None)
        silence = None if overlaps or prev is None or nxt is None else nxt["startMs"] - prev["endMs"]
        inside = any(t.channel != ch and t.start <= start and end <= t.end for t in first)
        holds = overlaps or (silence is not None and silence < floor_lapse_ms)
        out.append(
            Candidate(
                words=g,
                overlaps_partner=overlaps,
                partner_silence_ms=silence,
                partner_resumes_next=nxt is not None and (own_next is None or nxt["startMs"] < own_next["startMs"]),
                floor_class="backchannel" if inside and holds else "turn_part",
            )
        )
    backchannel_ids = {id(w) for c in out if c.floor_class == "backchannel" for w in c.words}
    final = _turns_from([w for w in words if id(w) not in backchannel_ids])
    for c in out:
        if c.floor_class == "backchannel":
            continue
        turn = next((t for t in final if any(w is c.words[0] for w in t.words)), None)
        c.floor_class = "standalone_turn" if turn and len(turn.words) == len(c.words) else "turn_part"
    return out


def build_turns(words: list[dict], backchannels: set[str], floor_lapse_ms: float) -> list[Turn]:
    """Floor turns: every word except the backchannels classify_candidates finds."""
    backchannel_ids = {
        id(w) for c in classify_candidates(words, backchannels, floor_lapse_ms) if c.floor_class == "backchannel" for w in c.words
    }
    return _turns_from([w for w in words if id(w) not in backchannel_ids])


def contexts(session: dict, words: list[dict], archive: "Archive | None" = None) -> list[Context]:
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
    # floorLapseMs decides whether a partner silence leaves the floor open (default 1500).
    turns = build_turns(kept, bc, cfg.get("floorLapseMs", 1500))
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
                archive=archive,
            )
        )
    return out
