"""Regenerate FEATURE_INVENTORY.md from features.json. Run from the folder that holds both."""
import json, collections
d = json.load(open("features.json"))
by = collections.defaultdict(list)
for f in d["features"]:
    by[f["tier"]].append(f)
out = ["# Viva Voice: feature inventory\n",
       f"Every speech feature this system can measure now or later, grouped by tier. scripts/gen-inventory.py generates this file from `features.json` (registry version {d['registryVersion']}, {d['generated']}). Edit the JSON and regenerate; never edit this file by hand.\n",
       "## How to read this file\n",
       "RESEARCH_PRINCIPLES.md governs every entry: the archive keeps everything, every pruned measure has a raw twin, pauses and fillers are described by location and kind, and L1 influence appears as counted variants with no native-speaker score.\n",
       "Tier 1 features ship in the app and appear in the student document and the cohort CSV. Tier 2 features run in the Python research layer from stored transcripts. Tier 3 features need the archived audio, a phone recognizer, forced alignment, or an acoustic toolkit. Tier 4 features need people: annotation, stimulated recall, or listener studies.\n",
       "A reference marked \"none verified\" means I did not open a supporting paper, so treat that feature as a candidate.\n",
       "## What the archive keeps\n"]
for k, v in d["inputs"].items():
    out.append(f"{k}: {v}\n")
out.append("## Research questions this inventory supports\n")
out.append("1. How Korean university students distribute silent pauses and fillers across clause boundaries, turn boundaries, and positions before low-frequency words in paired conversation, and how that distribution changes between midterm and final sessions (tiers 1 and 2).\n2. Whether \"uh\" and \"um\" precede different delay lengths in L2 dialogue, testing Clark and Fox Tree (2002) with two-channel timing (tier 1).\n3. Whether follow-up questions draw longer partner answers than new-topic questions (Study 2 Plan A, tier 2).\n4. How pair asymmetry relates to each partner's speaking patterns (tier 1).\n5. Which Korean-influenced segmental variants (epenthesis, nasalization, consonant realisations) each speaker produces, how stable they are within a speaker, and which ones listeners find hard to understand (tiers 3 and 4).\n6. How much disfluency a general recognizer normalises away compared with a verbatim recognizer, by speaker (tier 2 quality measures).\n7. Rhythm, vowel reduction, and pitch range in Korean L1 speakers' spontaneous English, described against each speaker's own sessions (tier 3).\n")
names = {1: "Tier 1: in the app", 2: "Tier 2: transcript-based research features", 3: "Tier 3: audio-based research features", 4: "Tier 4: human data"}
for t in sorted(by):
    out.append(f"## {names[t]}\n")
    out.append(d["tiers"][str(t)] + "\n")
    cur = None
    for f in sorted(by[t], key=lambda x: x["construct"]):
        if f["construct"] != cur:
            cur = f["construct"]; out.append(f"### {cur}\n")
        p = ", ".join(f"{k}={json.dumps(v, ensure_ascii=False)}" for k, v in f["params"].items()) or "none"
        cav = "; ".join(f["caveats"]) or "none"
        out.append(f"**{f['id']}**. Unit: {f['unit']}. Inputs: {', '.join(f['inputs']) or 'people'}. Formula: {f['formula']}. Parameters: {p}. Reference: {f['reference']}. Caveats: {cav}.\n")
open("FEATURE_INVENTORY.md", "w").write("\n".join(out))
print("ok", len(d["features"]))
