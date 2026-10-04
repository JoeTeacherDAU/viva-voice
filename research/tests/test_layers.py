"""Work order 01: the verbatim and phone slots, the shared backchannel rule, and descriptive output."""

from __future__ import annotations

import csv
import json

from viva import export, verbatim
from viva.archive import Archive, build_turns, contexts


def w(word, start, end, ch, punct=None):
    return {"word": word, "punctuatedWord": punct or word, "startMs": start, "endMs": end, "channel": ch, "confidence": 0.9, "isFinal": True}


BC = {"mhmm", "yeah", "okay", "right", "really"}


def test_a_lone_answering_okay_is_a_turn_and_a_backchannel_inside_a_partner_pause_is_not():
    words = [w("are", 0, 200, 0), w("you", 240, 400, 0), w("ready", 440, 680, 0, "ready?"), w("okay", 2000, 2200, 1, "Okay."), w("good", 2600, 2800, 0)]
    assert [t.channel for t in build_turns(words, BC, 1500)] == [0, 1, 0]
    inside = [w("we", 0, 200, 0), w("went", 240, 400, 0), w("mhmm", 600, 800, 1), w("home", 1000, 1200, 0)]
    assert [t.channel for t in build_turns(inside, BC, 1500)] == [0]


def test_backchannel_tokens_inside_a_turn_are_ordinary_words():
    words = [w("so", 0, 200, 0, "So?"), w("yeah", 1200, 1400, 1, "Yeah,"), w("really", 1440, 1600, 1), w("good", 1640, 1800, 1, "good.")]
    session = {"id": "s", "participantIds": {"A": "a", "B": "b"}, "config": {}, "markers": {}}
    b = [c for c in contexts(session, words) if c.participant == "B"][0]
    assert b.pruned_tokens() == ["yeah", "really", "good"]


def test_a_long_silence_stays_inside_a_turn():
    words = [w("one", 0, 200, 0), w("two", 4000, 4200, 0)]
    turns = build_turns(words, BC, 1500)
    assert len(turns) == 1 and len(turns[0].words) == 2


def session_with_slot(tmp_path, slot):
    arc = export.fixture_archive("balanced", tmp_path / "archive")
    if slot is not None:
        (arc / "transcripts" / "fixture-balanced" / "verbatim-A.json").write_text(json.dumps(slot))
    return arc


def test_verbatim_counts_come_from_the_slot_and_skip_without_the_model(tmp_path, monkeypatch):
    monkeypatch.delenv("VIVA_CRISPERWHISPER", raising=False)
    slot = {"words": [{"word": "I"}, {"word": "[UM]"}, {"word": "we-"}, {"word": "we"}, {"word": "went"}, {"word": "went"}, {"word": "home"}]}
    arc = session_with_slot(tmp_path, slot)
    rec = Archive(arc).sessions("fixture-exam")[0]
    words, _ = Archive(arc).transcript(rec["id"])
    a = [c for c in contexts(rec, words, Archive(arc)) if c.participant == "A"][0]
    v = {x.feature_id: x.value for x in verbatim.compute(a)}
    assert v["verbatim_filler_count"] == 1
    assert v["verbatim_partial_word_count"] == 1
    assert v["verbatim_repetition_count"] == 1
    assert 0 < v["asr_verbatim_word_disagreement"]
    assert verbatim.edit_distance(["a", "b", "c"], ["a", "c"]) == 1


def test_manifest_records_missing_models_and_keeps_construct_names_out_of_rows(tmp_path, monkeypatch):
    monkeypatch.delenv("VIVA_CRISPERWHISPER", raising=False)
    monkeypatch.delenv("VIVA_PHONES_MODEL", raising=False)
    arc = session_with_slot(tmp_path, None)
    out = export.export(arc, "fixture-exam", [2, 3], tmp_path / "out")
    m = json.loads((out / "manifest.json").read_text())
    for fid in verbatim.COMPUTES:
        assert m["skipped"][fid] == "CrisperWhisper not installed"
    assert m["skipped"]["vowel_epenthesis_rate"] == "facebook/wav2vec2-xlsr-53-espeak-cv-ft not installed"
    assert m["featureMetadata"]["mean_length_as_unit"]["construct"] == "syntax"
    assert m["featureMetadata"]["mean_length_as_unit"]["reference"]
    rows = list(csv.reader((out / "long.csv").open()))
    assert "construct" not in rows[0]
    constructs = {f["construct"] for f in __import__("viva.registry", fromlist=["features"]).features().values()}
    assert not any(cell in constructs for row in rows for cell in row)
