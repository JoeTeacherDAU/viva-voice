# Replay mode: design note

Status: design only, 2026-10-19, work order 02. Nobody has built any of this.

## Purpose

Replay mode feeds one archived pair WAV through the live session path in real time, as if the BOYAMIC receiver were producing it. Joe can then watch the four-element live display (talk-time bar, index slots, target counters, fault strip) react to a real exam conversation from the 2026 midterm, tune the display, and compare pass one with the pass two that already exists for that pair, all without students in the room.

## Where it plugs in

The setup screen already offers "Synthetic stereo (test)", built in lib/audio/synthetic.ts. That source makes a 48 kHz AudioContext, routes oscillators into a ChannelMergerNode, and hands the session a MediaStream from a MediaStreamAudioDestinationNode. Everything after that point (the splitter, the energy and downsample worklets, the Deepgram socket, the pass-one pipeline, and the display) treats the stream as a microphone. Replay mode adds a third source of the same kind, so the session controller and every worklet stay unchanged.

The replay source would:

1. Fetch the pair's audio/{id}/stereo.wav through /api/file (which redirects to a presigned URL for a large file) and decode it with AudioContext.decodeAudioData at 48 kHz. A six-minute 24-bit pair decodes to about 140 MB of float samples, which a MacBook Air holds comfortably.
2. Play it through an AudioBufferSourceNode into a two-channel MediaStreamAudioDestinationNode with channelInterpretation "discrete", so left stays channel 0 and right stays channel 1.
3. Start playback at the pair's first frame when Joe presses Start, so the replayed session clock matches the archived pair's clock to within one render block.

The device list would show "Replay: {pairId}" only after Joe picks a pair on the review page, and the setup screen would fill the participant IDs and channel map from that pair's record instead of the roster pickers.

## What the replay session writes

A replayed run must never overwrite the pair it replays. It would write a new session with captureMode "replay", a fresh id ({pairId}-R{n}), a source block pointing at the replayed pair and its slice SHA-256, and its own pass-one transcript, raw Deepgram messages, energy, events, and live score. The capture worklet would still record what it receives, which lets a test compare the recaptured audio with the slice and measure what the browser path adds (resampling, render-block jitter). The replay session's audio file is a copy of known audio, so retention and the research export should label it and leave it out of cohort statistics.

## Open questions for Joe

1. Should a replay call Deepgram live, at the streaming rate of about $0.0048 per channel-minute, or use the mock transcriber by default and Deepgram only on request?
2. Should replay sessions appear in the review list beside the pair they replay, or in a separate group?
3. Should the display allow a faster-than-real-time replay for display tuning? The live socket expects real time, so a faster replay would need the mock transcriber.

## Tests it would need

A synthetic pair WAV replayed through headless Chromium with the fake media flags, asserting that the talk-time bar and the target counter reach the values the pass-two words predict, and that the replay session's energy frames match the slice's stored energy frames within 1 dB.
