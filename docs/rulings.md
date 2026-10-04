# Rulings

Decided 2026-10-04. These close RED_TEAM.md section G. Change a ruling here and in the files it names.

## R1. The app stores the live score tap

When I tap a score during a session, the app stores `instructorLiveScore` with a timestamp in the session record. No student document, CSV column visible to a student, or Markomatic input ever contains it. The research export reads it from a separate path (`instructor/{examId}.json`) so I can refit the composite weights against my scores after one administration. Grade merge into student documents stays shelved.

Files: PLAN.md section 3 and 10, build-plan.json P5.2 and P6.4, features.json `rater_perceived_fluency`.

## R2. Consent and retention

Retention: a monthly job deletes audio and transcripts 24 months after the end of the term in which the session took place. Measurements, the long CSV, and session metadata stay indefinitely under pseudonymous participant IDs. The same job deletes the roster file that maps names to IDs.

Consent: each student signs one paragraph before the first recorded session. English draft (a Korean version needs a translator):

I agree that a microphone I wear will record my conversation exam. My instructor will use the recording and a written transcript to measure how I speak (speed, pauses, turn-taking, vocabulary) and to give me a report. My instructor will delete the recording and transcript 24 months after this semester ends. Research and publications may use measurements with no name attached. I can withdraw by telling my instructor, and my grade does not depend on this choice.

A student who declines takes the same exam with the microphones off, and I grade from my notes alone.

Files: PLAN.md section 10, build-plan.json P0.9, VERIFICATION_CHECKLIST.md.

## R3. If the receiver fails V1

Buy a two-input, USB class-compliant audio interface and run the receiver's 3.5 mm TRS output into it, or run each transmitter's receiver output separately if the interface has two mic inputs. I have no price data for a specific model. Do not change the software design; the capture layer only needs a two-channel input device.

## R4. Live score scale

Five buttons, 1 to 5, left to right, 5 high. One tap reveals the index slot. A later tap changes the stored value and keeps the first timestamp.

## R5. Exam-room machine and browser

Chrome, current stable, on the MacBook Air M4 running current macOS. The setup screen blocks any other browser with a message. No iPad, no Safari.
