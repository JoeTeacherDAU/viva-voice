"""build-plan P7.5: tier 2 on the balanced fixture against hand values."""

from __future__ import annotations

import csv
import json
from pathlib import Path

import pytest

from viva import asunit, export, lexis, registry
from viva.archive import Archive, RosterAccessError, contexts

FIXTURES = Path(__file__).resolve().parents[2] / "fixtures" / "golden"


def balanced_contexts():
    root = FIXTURES / "balanced"
    session = json.loads((root / "session.json").read_text())
    words = json.loads((root / "words.json").read_text())
    # The fixture's cross-talk copies, as the app's pass two flags them.
    removed = json.loads((root / "expected.json").read_text())["structure"]["crosstalkRemoved"]
    hits = {(r["channel"], r["startMs"]) for r in removed}
    for w in words:
        w["removedAsCrosstalk"] = (w["channel"], w["startMs"]) in hits
    return {c.participant: c for c in contexts(session, words)}


def expected(fixture: str, feature: str, participant: str):
    values = json.loads((FIXTURES / fixture / "expected.json").read_text())["values"]
    return next(
        v["value"]
        for v in values
        if v["featureId"] == feature and v["participant"] == participant and v["pass"] == 2 and v["thresholdMs"] is None
    )


def test_as_unit_counts_match_the_hand_segmentation():
    # Hand segmentation of scripts/make-fixtures.mjs, balanced fixture.
    # Student A: "So, what did you do last weekend?" (1); "Oh, nice." "I would like to go
    # to Busan too." "Did you eat the the fish there?" (3); "I stayed home and studied for
    # my exam." "I think I think it went well." "Then on Sunday I met my friends at a cafe."
    # (3); "The new one near the station." "It has big windows and good coffee." "We talked
    # all day." (3); "You should go." "It is quiet in the um morning," "so you can study
    # there too." (3: ", so you" splits); "We uh I can go with you if you want." "The cafe
    # opens at nine." (2); "See you on Friday then." (1). Total 16.
    # Student B: 3 + 3 ("nice, but the" and "fish, but now" do not split) + 2 + 3 +
    # 3 ("Friday, so I" splits) + 2 = 16. The two backchannels form no unit.
    ctx = balanced_contexts()
    assert len(asunit.units_for(ctx["A"])) == 16
    assert len(asunit.units_for(ctx["B"])) == 16
    values = {(v.feature_id, v.threshold_ms): v.value for v in asunit.compute(ctx["A"])}
    assert values[("mean_length_as_unit", None)] == pytest.approx(97 / 16)
    b = {(v.feature_id, v.threshold_ms): v.value for v in asunit.compute(ctx["B"])}
    assert b[("mean_length_as_unit", None)] == pytest.approx(102 / 16)


def test_as_unit_pause_classes_split_the_tier_one_pauses():
    ctx = balanced_contexts()
    v = {(x.feature_id, x.threshold_ms): x.value for x in asunit.compute(ctx["A"])}
    # A's pauses at 200 ms: 260 after "So," (no terminal mark, so mid-unit), then 500 after
    # "too.", 440 after "exam.", 220 after "well.", 600 after "station.", 340 after
    # "coffee.", 300 after "go.", 360 after "want." (all unit ends). At 350 ms only 500,
    # 440, 600, and 360 remain, all unit ends.
    assert v[("silent_pause_mid_as_unit_count", 200)] == 1
    assert v[("silent_pause_end_as_unit_count", 200)] == 7
    assert v[("silent_pause_mid_as_unit_count", 350)] == 0
    assert v[("silent_pause_end_as_unit_count", 350)] == 4


def test_mattr_matches_the_fixture_script():
    ctx = balanced_contexts()
    for p in ("A", "B"):
        tokens = ctx[p].pruned_tokens()
        assert lexis.mattr(tokens) == pytest.approx(expected("balanced", "mattr", p), rel=1e-9)
        assert lexis.mtld(tokens) == pytest.approx(expected("balanced", "mtld", p), rel=1e-9)
    assert len(ctx["A"].pruned_tokens()) == 97
    assert len(ctx["B"].pruned_tokens()) == 102


def test_lexis_and_question_measures_on_the_fixture():
    ctx = balanced_contexts()
    from viva import interaction

    q = {v.feature_id: v.value for v in interaction.compute(ctx["A"])}
    # A asks two questions: "what did you do last weekend?" opens the talk (no prior
    # partner turn, so new topic) and "Did you eat the the fish there?" shares "busan"
    # with B's previous turn (follow-up).
    assert q["new_topic_question_count"] == 1
    assert q["follow_up_question_count"] == 1
    lx = {v.feature_id: v.value for v in lexis.compute(ctx["A"])}
    assert 0 < lx["content_word_ratio"] < 1


def test_the_research_layer_refuses_the_roster(tmp_path):
    (tmp_path / "roster").mkdir()
    (tmp_path / "roster" / "e1.json").write_text("[]")
    with pytest.raises(RosterAccessError):
        Archive(tmp_path).read_json("roster/e1.json")


def test_every_tier_two_and_three_id_has_a_module():
    owner = export.owned_ids()
    for fid, f in registry.features().items():
        if f["tier"] in (2, 3):
            assert fid in owner, f"{fid} has no research module"


def test_cli_export_writes_long_csv_and_manifest(tmp_path):
    arc = export.fixture_archive("balanced", tmp_path / "archive")
    assert export.main(["export", "--exam", "fixture-exam", "--tiers", "2,3", "--archive", str(arc), "--out", str(tmp_path / "out")]) == 0
    out = tmp_path / "out" / "fixture-exam"
    rows = list(csv.DictReader((out / "long.csv").open()))
    assert {r["participantId"] for r in rows} == {"FIX-A", "FIX-B"}
    assert {r["transcriptSource"] for r in rows} == {"pass2"}
    mlau = [r for r in rows if r["featureId"] == "mean_length_as_unit" and r["participantId"] == "FIX-A"]
    assert float(mlau[0]["value"]) == pytest.approx(97 / 16)
    manifest = json.loads((out / "manifest.json").read_text())
    assert manifest["registryVersion"] == registry.version()
    assert "mean_length_as_unit" in manifest["computed"]
    assert "Montreal Forced Aligner" in manifest["skipped"]["npvi_vocalic"]
    assert "spaCy" in manifest["skipped"]["mean_dependency_distance"]
    assert manifest["unowned"] == []
