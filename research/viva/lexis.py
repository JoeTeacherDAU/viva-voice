"""Lexical and pragmatic token measures.

mattr() and mtld() repeat the app's tier 1 definitions so the research layer
can check them against the archive; export.py emits only tier 2 ids from here.
"""

from __future__ import annotations

from .archive import Context, token
from .base import Value, per_100

COMPUTES = ["content_word_ratio", "discourse_marker_rate", "hedge_rate", "agreement_token_rate"]
SKIPS = {
    "bigram_proportion": "needs a licensed or open spoken reference bigram list; none is bundled",
    "trigram_mutual_information": "needs a spoken reference corpus; none is bundled",
    "word_frequency_mean_log": "needs a frequency list (TAALES or equivalent); none is bundled",
    "academic_word_ratio": "needs the Academic Word List; not bundled for licensing reasons",
    "korean_token_count": "needs a Korean-language second pass over flagged spans; not built",
    "word_error_rate_vs_human": "needs a hand-corrected transcript for a validation subset",
}

# Function words for the content-word ratio. A tagger would decide by part of
# speech; this list approximates that, and the manifest records the method.
FUNCTION_WORDS = set(
    """a an the and but or so if then than that this these those there here of in on at to for from with by
    about as into over after before under up down out off i me my mine you your yours we us our ours they them
    their theirs he him his she her hers it its is am are was were be been being do does did have has had will
    would can could should shall may might must not no yes very too also just what which who whom whose when
    where why how all any some each every both either neither one much many more most other such own same""".split()
)

DISCOURSE_MARKERS = ["so", "well", "actually", "i mean", "you know", "like", "anyway"]
HEDGES = ["maybe", "i think", "kind of", "sort of", "probably", "a little"]
AGREEMENT = {"yes", "yeah", "right", "okay", "sure", "exactly", "true", "agree"}


def mattr(tokens: list[str], window: int = 50) -> float | None:
    if len(tokens) < window:
        return None
    n = len(tokens) - window + 1
    return sum(len(set(tokens[i : i + window])) / window for i in range(n)) / n


def _mtld_one(tokens: list[str], threshold: float) -> float | None:
    factors = 0.0
    types: set[str] = set()
    count = 0
    ttr = 1.0
    for t in tokens:
        count += 1
        types.add(t)
        ttr = len(types) / count
        if ttr <= threshold:
            factors += 1
            types, count, ttr = set(), 0, 1.0
    if count > 0:
        factors += (1 - ttr) / (1 - threshold)
    return None if factors == 0 else len(tokens) / factors


def mtld(tokens: list[str], threshold: float = 0.72) -> float | None:
    if not tokens:
        return None
    f, b = _mtld_one(tokens, threshold), _mtld_one(tokens[::-1], threshold)
    return None if f is None or b is None else (f + b) / 2


def count_phrases(tokens: list[str], phrases: list[str]) -> int:
    n = 0
    for p in phrases:
        parts = p.split()
        n += sum(1 for i in range(len(tokens) - len(parts) + 1) if tokens[i : i + len(parts)] == parts)
    return n


def compute(ctx: Context) -> list[Value]:
    tokens = ctx.pruned_tokens()
    content = sum(1 for t in tokens if t not in FUNCTION_WORDS)
    turns = ctx.own_turns
    agreeing = sum(1 for t in turns if t.words and token(t.words[0]["word"]) in AGREEMENT)
    return [
        Value("content_word_ratio", content / len(tokens) if tokens else None),
        Value("discourse_marker_rate", per_100(count_phrases(tokens, DISCOURSE_MARKERS), len(tokens))),
        Value("hedge_rate", per_100(count_phrases(tokens, HEDGES), len(tokens))),
        Value("agreement_token_rate", agreeing / len(turns) if turns else None),
    ]
