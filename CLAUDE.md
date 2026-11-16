# withings-sync

Sends Withings weight (with body composition) and blood pressure to Garmin
Connect, adding only what Garmin doesn't already have. It runs on the
[garmin-dashboard](https://github.com/thebruge/garmin-dashboard) server (CT 208,
`/opt/withings-sync`), deployed by garmin-dashboard's `server/deploy.sh`.
`README.md` covers the commands, setup and files; read it before changing
behaviour.

## Things to know

- `sync.mjs` holds the commands (`login`, `check`, `preview`, `sync`, `status`);
  `sync.sh` is what the server runs.
- It uploads with the Garmin sign-in that
  [hevy-sync](https://github.com/thebruge/hevy-sync) holds
  (`GARMIN_TOKENS_DIR`, default `../hevy-sync/data/garmin`). Don't add a separate
  Garmin sign-in.
- **Run it in one place only.** Withings replaces the refresh token on every
  renewal. `.env.local` (the Withings app's client ID and secret) and `data/`
  (tokens, ledger, logs) exist only on CT 208. They're gitignored; never commit
  or print them.
- A reading counts as already in Garmin when Garmin has one within 2 minutes of
  it, checked separately for weight and blood pressure. Uploads are remembered
  for a day in `data/ledger.json` so nothing is sent twice while Garmin
  processes them.
- Weight goes up as a FIT file written with `@markw65/fit-file-writer`, in the
  same format as the Withings Sync Raycast extension
  ([withings-raycast](https://github.com/thebruge/withings-raycast)). Withings
  reports body water in kg, which is converted to %.
- garmin-dashboard reads `data/status.json` (for its warnings) and
  `data/blood_pressure.json` (for its chart). Keep both formats compatible, or
  change garmin-dashboard in the same release.
- There's no test suite. Check changes on a copy in `$TMPDIR` with a stubbed
  `fetch`, and use `preview` on CT 208 for anything touching Garmin. Ask before
  running `sync` or `login` there.

## Changes, versions and releases

- Commits use Conventional Commits (`feat:`, `fix:`, `docs:`, `refactor:`, `chore:`).
- Add each user-visible change under `## [Unreleased]` in `CHANGELOG.md` in the
  same commit.
- To release: move the Unreleased entries under `## [X.Y.Z] - YYYY-MM-DD`, set
  the same version in `package.json`, commit as `chore(release): vX.Y.Z`, and tag
  `vX.Y.Z`.
- Changes reach CT 208 only through garmin-dashboard's `server/deploy.sh`, which
  deploys committed code. Ask before each push and deploy.
