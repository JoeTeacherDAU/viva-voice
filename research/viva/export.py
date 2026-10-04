"""viva-research export --exam <id> --tiers 2,3

Writes research-export/{examId}/long.csv (one row per feature per student per
session) and manifest.json (tool versions, computed and skipped ids with
reasons). Reads a local copy of the archive; never the roster.
"""

from __future__ import annotations

import argparse
import csv
import json
import platform
import sys
from datetime import datetime, timezone
from pathlib import Path

from . import __version__, acoustics, align, asunit, disfluency, interaction, lexis, registry, syntax
from .archive import Archive, contexts
from .base import Unavailable

MODULES = [asunit, lexis, syntax, disfluency, interaction, align, acoustics]
TIER4_SKIPS = {
    "gaze_and_gesture": "needs video, which this system does not record (decision 3)",
    "l1_utterance_fluency": "needs an L1 recording of the same speaker",
    "interactional_pattern_type": "needs human coding",
}
COLUMNS = ["examId", "sessionId", "participantId", "transcriptSource", "featureId", "tier", "threshold", "value", "unit", "toolVersion"]


def owned_ids() -> dict[str, object]:
    """Every registry id some module owns, mapped to that module. Raises on a mismatch."""
    feats = registry.features()
    owner: dict[str, object] = {}
    for m in MODULES:
        for fid in [*m.COMPUTES, *m.SKIPS]:
            if fid not in feats:
                raise ValueError(f"{m.__name__} declares {fid}, which lib/registry/features.json lacks")
            if fid in owner:
                raise ValueError(f"{fid} is declared by two modules")
            owner[fid] = m
    return owner


def export(archive_dir: str | Path, exam_id: str, tiers: list[int], out_dir: str | Path) -> Path:
    feats = registry.features()
    owner = owned_ids()
    arc = Archive(archive_dir)
    rows: list[list] = []
    computed: set[str] = set()
    skipped: dict[str, str] = {}
    for m in MODULES:
        for fid, why in m.SKIPS.items():
            if feats[fid]["tier"] in tiers:
                skipped[fid] = why
    sessions = arc.sessions(exam_id)
    for rec in sessions:
        words, source = arc.transcript(rec["id"])
        for ctx in contexts(rec, words):
            pid = rec["participantIds"][ctx.participant]
            for m in MODULES:
                ids = [f for f in m.COMPUTES if feats[f]["tier"] in tiers]
                if not ids:
                    continue
                try:
                    values = m.compute(ctx)
                except Unavailable as e:
                    for f in ids:
                        skipped[f] = str(e)
                    continue
                for v in values:
                    if v.feature_id not in ids:
                        continue
                    computed.add(v.feature_id)
                    f = feats[v.feature_id]
                    rows.append([exam_id, rec["id"], pid, source, v.feature_id, f["tier"], v.threshold_ms if v.threshold_ms is not None else "", "" if v.value is None else v.value, f["unit"], __version__])
    if 4 in tiers:
        skipped.update(TIER4_SKIPS)
        scores = (arc.instructor(exam_id) or {}).get("sessions", {})
        for sid, entry in scores.items():
            live = entry.get("instructorLiveScore")
            if live is None:
                continue
            for p in ("A", "B"):
                rows.append([exam_id, sid, entry["participantIds"][p], "instructor", "rater_perceived_fluency", 4, "", live["value"], feats["rater_perceived_fluency"]["unit"], __version__])
            computed.add("rater_perceived_fluency")
    for fid in computed:
        skipped.pop(fid, None)

    out = Path(out_dir) / exam_id
    out.mkdir(parents=True, exist_ok=True)
    with (out / "long.csv").open("w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(COLUMNS)
        w.writerows(rows)
    manifest = {
        "examId": exam_id,
        "tiers": tiers,
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "toolVersion": __version__,
        "python": platform.python_version(),
        "registryVersion": registry.version(),
        "sessions": [r["id"] for r in sessions],
        "rows": len(rows),
        "computed": sorted(computed),
        "skipped": dict(sorted(skipped.items())),
        "methods": {
            "asUnit": "rule-based over ASR punctuation (viva/asunit.py)",
            "contentWords": "function-word list (viva/lexis.py)",
            "modules": {m.__name__.split(".")[-1]: sorted([*m.COMPUTES, *m.SKIPS]) for m in MODULES},
        },
        "unowned": sorted(fid for fid, f in feats.items() if f["tier"] in (2, 3) and fid not in owner),
    }
    (out / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    return out


def fixture_archive(name: str, out_dir: str | Path) -> Path:
    """Copies a golden fixture into archive layout, so the CLI can run on it.
    The fixture's cross-talk copies come flagged from expected.json."""
    root = Path(__file__).resolve().parents[2] / "fixtures" / "golden" / name
    session = json.loads((root / "session.json").read_text())
    words = json.loads((root / "words.json").read_text())
    removed = json.loads((root / "expected.json").read_text())["structure"]["crosstalkRemoved"]
    hits = {(r["channel"], r["startMs"]) for r in removed}
    for w in words:
        w["removedAsCrosstalk"] = (w["channel"], w["startMs"]) in hits
    out = Path(out_dir)
    (out / "sessions").mkdir(parents=True, exist_ok=True)
    (out / "transcripts" / session["id"]).mkdir(parents=True, exist_ok=True)
    (out / "sessions" / f"{session['id']}.json").write_text(json.dumps(session))
    (out / "transcripts" / session["id"] / "pass2.json").write_text(json.dumps({"words": words}))
    return out


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="viva-research")
    sub = ap.add_subparsers(dest="cmd", required=True)
    e = sub.add_parser("export", help="compute tier 2 and 3 features for one exam")
    e.add_argument("--exam", required=True)
    e.add_argument("--tiers", default="2", help="comma-separated, e.g. 2,3")
    e.add_argument("--archive", default="archive-sync", help="local copy of the Blob archive")
    e.add_argument("--out", default="research-export")
    f = sub.add_parser("fixture-archive", help="write a golden fixture in archive layout")
    f.add_argument("--fixture", default="balanced")
    f.add_argument("--out", default="archive-sync")
    a = ap.parse_args(argv)
    if a.cmd == "fixture-archive":
        print(fixture_archive(a.fixture, a.out))
        return 0
    tiers = sorted({int(t) for t in a.tiers.split(",") if t.strip()})
    out = export(a.archive, a.exam, tiers, a.out)
    print(f"wrote {out / 'long.csv'} and {out / 'manifest.json'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
