"""Repair measures beyond tier 1.

self_repair_count is a lexical heuristic: within one turn, an editing term
("i mean", "sorry", "no") that directly follows a word and precedes more
speech marks a reparandum-editing-repair pattern (Matsuura et al. 2022 use a
disfluency-aware parse for the same construct).
"""

from __future__ import annotations

from .archive import Context, token
from .base import Value

COMPUTES = ["self_repair_count"]
SKIPS = {"false_start_count_parsed": "needs a disfluency-aware parse; not built in version 1"}

EDITING_TERMS = [["i", "mean"], ["sorry"], ["no"]]


def compute(ctx: Context) -> list[Value]:
    count = 0
    for t in ctx.own_turns:
        toks = [token(w["word"]) for w in t.words if token(w["word"]) not in ctx.fillers]
        i = 1
        while i < len(toks):
            for term in EDITING_TERMS:
                end = i + len(term)
                if toks[i:end] == term and end < len(toks):
                    count += 1
                    i = end - 1
                    break
            i += 1
    return [Value("self_repair_count", count)]
