# P0: Vercel project and Blob store

Joe authorized this setup on 2026-10-05 for this task only, through the Vercel CLI on his Mac. No file in this repository holds a secret value; the values live in Vercel and in the gitignored .env.local.

## CLI and account

The Mac had Vercel CLI 50.37.3. I updated it with npm to 62.2.0. `vercel whoami` reports joeteacherdonga-6540. The team is joeteacherdonga-6540's projects (team_8vfs2QbstUiFmFKdeDSdbPZu), the same scope as ~/CC Projects/weevillabs-site/.vercel/project.json, on the Pro plan.

## Project

- Name viva-voice, project id prj_BOPdR6fdLvs7KT0Ud8hm1ThO9Wxj, created with `vercel project create` and linked with `vercel link`. The .vercel folder is gitignored.
- Connected to the GitHub repository JoeTeacherDAU/viva-voice with `vercel git connect`. Production branch: main.
- The project first came up with the "Other" framework preset and Node 24.x. Build-plan P0.3 names the Next.js preset and build-plan.json names Node 22, so `vercel project update` set the framework to nextjs and Node to 22.x.
- Default function region: icn1, set through the API field resourceConfig.functionDefaultRegions, because the CLI has no flag for it. vercel.json also sets regions to icn1.

## Blob store

viva-voice-archive, store id store_h0h2NLXBxDk0D0Z1, access Private, region icn1, created with `vercel blob create-store` and connected to the project for Production, Preview, and Development. That connection added BLOB_READ_WRITE_TOKEN to all three environments.

## Environment variables

VIVA_SESSION_SECRET and CRON_SECRET each hold 32 random bytes from `openssl rand -hex 32`. VIVA_PASSWORD holds a four-word passphrase picked with Python's secrets module from 56,179 words of four to seven letters, about 63 bits. All three are set in Production, Preview, and Development, stored as encrypted config variables rather than as Vercel's sensitive type, because Vercel keeps sensitive variables out of Development and the task needed them pulled into .env.local. DEEPGRAM_API_KEY is not set; Joe adds it himself.

`vercel env pull .env.local` wrote BLOB_READ_WRITE_TOKEN, CRON_SECRET, VERCEL_OIDC_TOKEN, VIVA_PASSWORD, and VIVA_SESSION_SECRET. .gitignore covers the file through the rule `.env*`, and `git check-ignore` confirms it. The three generated values in .env.local match what went into Vercel.

## First production build

The project had no deployments before commit 000dd1c. The push of that commit to main started the first production build through the Git integration, with no `vercel deploy`. Deployment dpl_AYHNJgnBQMwP1bJprpRrXiGLnbc6 built in 25 seconds and reached Ready.

- Production URL: https://viva-voice.vercel.app (aliases viva-voice-joeteacherdonga-6540s-projects.vercel.app and viva-voice-git-main-joeteacherdonga-6540s-projects.vercel.app).
- Deployment URL: https://viva-voice-3darop8ny-joeteacherdonga-6540s-projects.vercel.app
- Smoke test without credentials: /login returns 200, / redirects (307) to /login, /api/file returns 401, and a wrong password at /api/login returns 401 rather than 500, which shows VIVA_PASSWORD and VIVA_SESSION_SECRET reach the functions. Responses carry x-vercel-id icn1.
- Deployment protection is Vercel's default, "all except custom domains". The production URL is public and guarded by the app's own password; the per-deployment URL redirects to Vercel's login.

Two settings for Joe, which I left unchanged because the task did not cover them:

- The build ran on the "turbo" build machine (30 vCPU), selected by a project setting. It is Vercel's fastest and most expensive build tier; `vercel project update viva-voice --build-machine standard` would lower it.
- The app runs in live mode, because VIVA_MOCK_ASR is unset. Until DEEPGRAM_API_KEY is added, a live session cannot start transcription; setup, login, review, and the archive routes work.
