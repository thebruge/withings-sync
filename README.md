# withings-sync

Sends [Withings](https://www.withings.com) weight (with body composition) and
blood pressure to Garmin Connect, adding **only what Garmin doesn't already
have**. No server and no database: it runs, syncs, and exits.

- **Checks each reading against Garmin by time.** A weigh-in or blood pressure
  reading counts as already there when Garmin has one within 2 minutes of the
  Withings timestamp. Weight and blood pressure are checked separately, so a
  missing one is sent on its own.
- **Weight with body composition:** body fat %, body water % (Withings reports
  kilograms; this converts it), bone mass and muscle mass. Blood pressure with
  pulse.
- **Same file format as the Withings Sync Raycast extension** (a FIT weight
  file via `@markw65/fit-file-writer`), uploaded with the Garmin sign-in that
  [hevy-sync](https://github.com/thebruge/hevy-sync) already holds, so there's
  no separate Garmin password.
- **Won't double-send while Garmin processes uploads:** an upload is remembered
  for a day in `data/ledger.json`.

## Where it runs

On the [garmin-dashboard](https://github.com/thebruge/garmin-dashboard) server
(CT 208) at `/opt/withings-sync`, deployed by garmin-dashboard's
`server/deploy.sh`. Every refresh there runs it after the Hevy sync and before
the Garmin pull (last 30 days): at 6 am, and when you press Refresh or use the
Raycast commands.

Run it in **one place only**: Withings replaces the refresh token on every
renewal, so two copies of the sign-in would knock each other out.

## Commands (on the server)

Keep the single quotes; they stop your Mac's shell from eating the inner ones.

```sh
ssh -t pve 'pct exec 208 -- docker exec -it garmin-worker sh -c "cd /app/withings-sync && node sync.mjs status"'
ssh -t pve 'pct exec 208 -- docker exec -it garmin-worker sh -c "cd /app/withings-sync && node sync.mjs check"'
ssh -t pve 'pct exec 208 -- docker exec -it garmin-worker sh -c "cd /app/withings-sync && node sync.mjs preview --all"'
ssh -t pve 'pct exec 208 -- docker exec -it garmin-worker sh -c "cd /app/withings-sync && node sync.mjs login"'
```

`preview` and `sync` take a range: `--days N` (default 30), `--since YYYY-MM-DD`
or `--all`.

## Setup from scratch

1. `.env.local` with your Withings app's credentials (developer.withings.com;
   the same app the Raycast extension uses):
   ```
   WITHINGS_CLIENT_ID=...
   WITHINGS_CLIENT_SECRET=...
   ```
   Optional: `WITHINGS_REDIRECT_URI` (default
   `https://raycast.com/redirect?packageName=Extension`, already registered on
   that app) and `GARMIN_TOKENS_DIR` (default `../hevy-sync/data/garmin`).
2. Deploy: garmin-dashboard's `server/deploy.sh --data withings-sync`, then
   delete `.env.local` here.
3. Sign in on the server with the `login` command above. It prints a Withings
   link; approve, then paste the address you land on. **Withings only accepts
   it for 30 seconds**, so paste straight away.
4. `preview --all` to see what's missing, then `sync --all` once to fill gaps.

## Files

| File | What it does |
|---|---|
| `sync.mjs` | The commands: login, check, preview, sync, status |
| `sync.sh` | Runs a sync and logs to `data/sync.log` (what the server runs) |
| `data/withings_tokens.json` | Withings sign-in (git-ignored, owner-only) |
| `data/ledger.json` | What was uploaded and when |
| `data/status.json` | Outcome of the last sync, read by garmin-dashboard for its warnings |

## Privacy

`.env.local` and `data/` are git-ignored and live on CT 208 only.
