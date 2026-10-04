# Viva Voice: verification checklist

Joe runs these by hand. Write each result into `docs/verification/V<n>.md` in the repository with the date, the firmware versions, and the numbers. V1, V2, V2b, and V6 gate Phase 4 of the build. The rest gate the first graded session.

## V1. The receiver as a USB stereo input

1. Set the receiver to Stereo mode in RX Settings.
2. Connect the receiver to the MacBook with the USB-C data cable.
3. Open Audio MIDI Setup. Find the receiver. Record the input channel count and sample rate it shows.
4. Open Chrome, go to a page that calls `navigator.mediaDevices.enumerateDevices()` (the Phase 3 setup screen, or any WebRTC test page), and record the label and channel count Chrome reports.
5. Pass: Audio MIDI Setup and Chrome both show 2 input channels. Fail: either shows 1. On fail, the fallback is the receiver's 3.5 mm TRS output into a two-input USB audio interface.

## V2. How strong the transmitter AGC is

1. Noise cancellation off on both transmitters (press the NC button once; confirm in the BOYA Central app).
2. Play a steady tone or pink noise from a phone at a fixed distance from transmitter A's capsule. Record 10 seconds through the receiver's USB feed into Audacity or QuickTime.
3. Halve the playback level (minus 6 dB in the phone's player, or double the distance for roughly minus 6 dB). Record 10 seconds.
4. Measure the RMS level of each recording. With no AGC the difference is about 6 dB. Record the actual difference. A difference near 0 dB means the AGC flattens level. A difference between 2 and 5 dB means a slow or partial AGC.
5. Repeat for transmitter B.

## V2b. Does the onboard 32-bit float recording bypass the AGC?

Repeat V2 with onboard recording on, then copy the onboard WAV files over USB and measure the same two levels. If the onboard difference is near 6 dB and the USB difference is near 0, the onboard file is the research-grade source and the Phase 7 import matters.

## V3. Chrome honours the processing constraints

On the setup screen, open the receiver and read the displayed `getSettings()` values. Pass: `echoCancellation`, `noiseSuppression`, `autoGainControl` all false and `channelCount` 2.

## V4. Room bleed at exam seating

1. Two people sit where students will sit, each wearing a transmitter with the lavalier at 15 to 20 cm from the mouth.
2. Person A reads aloud for 10 seconds while B stays silent. Then B reads while A stays silent.
3. Record through the USB feed. Measure the RMS level on each channel during each half.
4. Record separation in dB for both directions. The setup screen's calibration step automates this later; do it once by hand first so the automation has a reference number.

## V5. Cross-talk rejection accuracy

1. Record a real two-minute conversation between two volunteers with the full kit.
2. Hand-annotate who spoke each word (a spreadsheet with word, start, speaker).
3. Run pass two. Compare the pipeline's channel attribution after cross-talk rejection with the annotation.
4. Record false acceptance (partner's word kept) and false rejection (own word deleted) rates. Target: both under 5 percent. Write what you see.

## V6. Browser WebSocket authentication to Deepgram

1. In the Deepgram console, create a key with `usage::write`.
2. From a terminal: `curl -X POST https://api.deepgram.com/v1/auth/grant -H "Authorization: Token <KEY>" -H "Content-Type: application/json" -d '{"ttl_seconds": 60}'`. Record that a JWT comes back.
3. In Chrome's console on any https page: `new WebSocket('wss://api.deepgram.com/v1/listen?model=nova-3&encoding=linear16&sample_rate=16000&channels=2&multichannel=true', ['bearer', '<JWT>'])` and watch for `open`. Record pass or fail.
4. Repeat with `['token', '<KEY>']`. Record pass or fail. The build uses the bearer form; the token form is the documented fallback.

## V7. Pricing and pass-two latency

1. Open deepgram.com/pricing. Write down the current pay-as-you-go rate per minute for Nova-3 streaming and Nova-3 pre-recorded, and the sentence about multichannel billing.
2. After Phase 6 deploys to preview, run pass two on one five-minute session and record how many seconds the function takes.

## V8. Private storage stays private

1. Copy a blob URL from the Vercel dashboard for any uploaded file.
2. Open it in a private browser window with no cookie. Pass: 403 or 401. Fail: the file downloads.
3. Open `/api/file?pathname=<same path>` while logged in. Pass: the file downloads.

## V9. Office network

1. On the office Wi-Fi, run a 60-second mock-free live session with the kit.
2. Record the time between a word spoken and its interim appearing (stopwatch is fine).
3. Turn Wi-Fi off for 5 seconds during speech and back on. Check the session log for one gap event with plausible start and end times, and check that words after the gap carry sensible timestamps.
