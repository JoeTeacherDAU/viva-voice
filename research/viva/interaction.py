"""Question types and topic measures (Study 2 Plan A definitions).

Content words are pruned tokens outside lexis.FUNCTION_WORDS. A question is a
floor turn whose last word ends with "?".
"""

from __future__ import annotations

from .archive import Context, Turn, token
from .base import Value, mean
from .lexis import FUNCTION_WORDS

COMPUTES = [
    "follow_up_question_count",
    "new_topic_question_count",
    "partner_answer_length_after_question",
    "topic_initiation_count",
]
SKIPS: dict[str, str] = {}

TOPIC_WINDOW_TURNS = 5


def content(ctx: Context, turn: Turn) -> set[str]:
    return {token(w["word"]) for w in ctx.pruned(turn.words)} - FUNCTION_WORDS


def compute(ctx: Context) -> list[Value]:
    turns = ctx.turns
    follow = new = initiations = 0
    answers: list[int] = []
    for i, t in enumerate(turns):
        if t.channel != ctx.channel:
            continue
        mine = content(ctx, t)
        earlier = set().union(*(content(ctx, x) for x in turns[max(0, i - TOPIC_WINDOW_TURNS) : i])) if i else set()
        # A turn initiates a topic when one of its content words of four or more
        # letters appears in none of the previous five turns (a lexical proxy).
        if any(len(w) >= 4 and w not in earlier for w in mine):
            initiations += 1
        if not t.words[-1]["punctuatedWord"].endswith("?"):
            continue
        prev_partner = next((x for x in reversed(turns[:i]) if x.channel != ctx.channel), None)
        if prev_partner is not None and mine & content(ctx, prev_partner):
            follow += 1
        else:
            new += 1
        nxt = next((x for x in turns[i + 1 :] if x.channel != ctx.channel), None)
        if nxt is not None:
            answers.append(len(ctx.pruned(nxt.words)))
    return [
        Value("follow_up_question_count", follow),
        Value("new_topic_question_count", new),
        Value("partner_answer_length_after_question", mean(answers)),
        Value("topic_initiation_count", initiations),
    ]
