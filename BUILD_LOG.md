# Build log

Each agent run appends one entry: date, phase, tasks done, acceptance result, anything deferred, and the commit hash. A run records the hash after it commits, so each entry's hash line lands in the repository with the next commit.

## 2026-10-04, P1: Skeleton, CI, auth, schemas, registry, mock transcriber, fixtures

Before starting I pushed the plan commit ad4ac2a to origin main.

Tasks done: P1.1, P1.2, P1.2b, P1.3, P1.4, P1.5, P1.6, P1.7, P1.8, P1.9.

Acceptance: `npm run lint && npm run test && npm run build && node scripts/check-fixtures.mjs` exited 0 on the first attempt. Vitest ran 38 tests in 8 files. I also started `next dev` with a throwaway password and confirmed with curl that an unauthenticated page redirects to /login, an unauthenticated API call returns 401, a wrong password returns 401, and the right password sets a cookie that opens /dev/ui.

What I built:

- A Next.js 16 app with TypeScript strict, Tailwind v4, ESLint with Prettier, Vitest, and a husky pre-commit hook that runs lint and test.
- The DESIGN.md tokens in app/globals.css and tailwind.config.ts, Space Grotesk through next/font/google, and Button, Card, Meter, FaultStrip, and Icon in lib/ui with a /dev/ui sheet.
- lib/registry, which validates lib/registry/features.json against the schema when it loads and rejects malformed input in six unit tests.
- schemas/session.schema.json and schemas/words.schema.json, with TypeScript types in lib/analysis/types.ts and validators in lib/validation.ts.
- Cookie auth in lib/auth, POST /api/login with a constant-time compare, a login page, and proxy.ts guarding every other route.
- The Transcriber interface and a mock provider that replays words as interims, then finals.
- Three golden fixtures (balanced, asymmetric, gappy) and docs/OPERATIONAL_DEFINITIONS.md, which fixes every rule the one-line formulas in features.json leave open.
- .github/workflows/ci.yml and docs/ARCHITECTURE.md.

Places where I departed from the plan, and why:

- Next.js 16 renamed middleware.ts to proxy.ts. The route guard lives in proxy.ts and behaves as P1.5 describes.
- Tailwind v4 reads its settings from CSS. app/globals.css loads tailwind.config.ts with an `@config` line, so the file P1.2b names still holds the colour map.
- next/font/google does not offer Material Symbols Outlined. The app bundles the icon font from the `material-symbols` npm package instead, which also keeps the exam room free of font requests.
- P1.7 names scripts/make-fixtures.ts, while CLAUDE.md runs `node scripts/make-fixtures.mjs`. I wrote the .mjs file so the CLAUDE.md command works with no build step.
- The session schema gains three optional fields the task list omits: `state` (setup, live, closing, done, which P3 and P5 use), `channelMap` (which channel carries which student, which P4 needs), and `config.speechFloorDbfs` (the level at which an energy frame counts as speech, default -60, which the unattributed ratio needs).
- features.json gives talk_time_share, filled_pause_rate, and articulation_rate_sps_est no pause threshold, but each divides by phonation time, which depends on one. All three use 350 ms and record thresholdMs 350. docs/OPERATIONAL_DEFINITIONS.md states this.
- The fixture WAVs run 39 to 62 seconds rather than a full exam length, which keeps the three files at 10 to 12 MB each.

Requests for Joe:

- P1.8 asks for the CI check to be required on main. That is a GitHub setting, which CLAUDE.md puts off limits for me. When you want it, open the repository on GitHub, go to Settings, then Branches, add a rule for main, and tick "Require status checks to pass" with the check named "check".
- Please read docs/OPERATIONAL_DEFINITIONS.md. Phase P2 implements those rules, and the golden fixtures already encode them. Three choices deserve your eye: backchannel tokens such as "right" and "really" leave the pruned count wherever they occur, as P2.5 says; response latency averages keep negative (overlapping) transitions; and the false-start rule is a heuristic that flags any short clause opening followed by "uh" or "um" and an unrelated restart.

Local machine note: this Mac runs Node 25.8.1. CI pins Node 22 as build-plan.json asks.

Deferred: nothing.

Commit: recorded in the next entry.
