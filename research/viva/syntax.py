"""Syntactic and morphological complexity (L2SCA-style indices).

Every index here needs a dependency parse or morphological tags. Version 1
does not install spaCy or a model, so this module owns these ids and reports
each as skipped. Adding spaCy means replacing SKIPS entries with computed ids
and a compute() that parses the pruned tokens.
"""

from __future__ import annotations

from .archive import Context
from .base import Value

PARSE = "needs a dependency parse; spaCy is not installed in version 1"
TAGS = "needs morphological tags; spaCy is not installed in version 1"

COMPUTES: list[str] = []
SKIPS = {
    "complex_nominals_per_clause": PARSE,
    "coordinate_phrases_per_clause": PARSE,
    "verb_phrases_per_as_unit": PARSE,
    "mean_dependency_distance": PARSE,
    "kolmogorov_complexity_syntax": "needs part-of-speech tags; spaCy is not installed in version 1",
    "kolmogorov_complexity_morphology": "needs lemmas; spaCy is not installed in version 1",
    "inflectional_morpheme_rate": TAGS,
    "third_person_s_supplied_ratio": TAGS,
    "past_tense_supplied_ratio": TAGS,
    "article_omission_rate": TAGS,
}


def compute(ctx: Context) -> list[Value]:
    return []
