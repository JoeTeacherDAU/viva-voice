"""AS-unit segmentation and the AS-unit pause classes.

Version 1 uses a rule-based segmenter over the ASR punctuation, because the
spaCy-based segmenter PLAN.md names needs a dependency model this package does
not install yet. The rule, applied within one speaker's floor turn:

1. A unit ends after a word whose punctuated form ends with . ? or !
2. A coordinating conjunction (and, but, so) starts a new unit when the word
   before it ends with a comma and the word after it is a subject pronoun.
   That marks two coordinated independent clauses, which Foster, Tonkyn, and
   Wigglesworth (2000) count as separate AS-units.
3. A turn end closes the open unit. Units with no pruned word are dropped.

The pause classes reuse the app's within-turn pauses: a pause that falls at a
unit boundary counts as end-of-unit, any other as mid-unit.
"""

from __future__ import annotations

import re

from .archive import Context, Turn, token
from .base import Value, mean

COMPUTES = ["mean_length_as_unit", "silent_pause_mid_as_unit_count", "silent_pause_end_as_unit_count"]
SKIPS = {
    "clauses_per_as_unit": "needs clause boundaries from a dependency parse; not built in version 1",
    "mean_length_clause": "needs clause boundaries from a dependency parse; not built in version 1",
    "dependent_clauses_per_clause": "needs clause boundaries from a dependency parse; not built in version 1",
}

TERMINAL = re.compile(r"[.?!]$")
CONJUNCTIONS = {"and", "but", "so"}
SUBJECTS = {"i", "you", "we", "they", "he", "she", "it"}


def segment(turn: Turn) -> list[list[dict]]:
    """Splits one turn into AS-units (lists of words, fillers included)."""
    units: list[list[dict]] = [[]]
    w = turn.words
    for i, word in enumerate(w):
        tok = token(word["word"])
        prev = w[i - 1] if i > 0 else None
        nxt = w[i + 1] if i + 1 < len(w) else None
        if (
            tok in CONJUNCTIONS
            and prev is not None
            and prev["punctuatedWord"].endswith(",")
            and nxt is not None
            and token(nxt["word"]) in SUBJECTS
            and units[-1]
        ):
            units.append([])
        units[-1].append(word)
        if TERMINAL.search(word["punctuatedWord"]):
            units.append([])
    return [u for u in units if u]


def units_for(ctx: Context) -> list[list[dict]]:
    out = []
    for t in ctx.own_turns:
        out.extend(u for u in segment(t) if ctx.pruned(u))
    return out


def compute(ctx: Context) -> list[Value]:
    units = units_for(ctx)
    pruned = len(ctx.pruned_tokens())
    values = [Value("mean_length_as_unit", pruned / len(units) if units else None)]
    # Word ids that end a unit, so a pause after them sits at a boundary.
    ends = {id(u[-1]) for t in ctx.own_turns for u in segment(t)}
    for threshold in ctx.pause_thresholds:
        mid = end = 0
        for t in ctx.own_turns:
            for a, b in zip(t.words, t.words[1:]):
                if b["startMs"] - a["endMs"] >= threshold:
                    if id(a) in ends:
                        end += 1
                    else:
                        mid += 1
        values.append(Value("silent_pause_mid_as_unit_count", mid, threshold))
        values.append(Value("silent_pause_end_as_unit_count", end, threshold))
    return values


def mean_unit_length(ctx: Context) -> float | None:
    """Mean pruned words per unit, unit by unit (a check on the ratio above)."""
    return mean([len(ctx.pruned(u)) for u in units_for(ctx)])
