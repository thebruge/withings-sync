# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- MIT license.

## [0.1.2] - 2026-11-02

### Fixed
- A network blip or Garmin outage while checking the Garmin sign-in no longer
  says the sign-in needs renewing. garmin-auth reports every failed check as
  "needs MFA / fresh SSO" but deletes the tokens only when Garmin rejects them,
  so with tokens still saved the sync now fails as "Garmin unreachable" and
  `sync.sh` retries it.

## [0.1.1] - 2026-10-30

### Fixed
- When Withings rejects the app's client ID or secret, the error says the secret
  was probably renewed on developer.withings.com and needs updating in
  `.env.local`, instead of asking you to sign in again (which can't fix it). The
  README has the steps.

## [0.1.0] - 2026-10-23

### Fixed
- Temporary errors (network trouble, HTTP 429/5xx, including Garmin uploads)
  get up to 3 retries after 5, 15 and 30 seconds before a sync counts as failed, and the error names the cause and host instead of just "fetch failed".

### Added
- `sync.mjs` with `login`, `check`, `preview`, `sync` and `status`.
- Withings sign-in on the server: paste-the-address flow using the app's
  existing redirect, with the rotating refresh token saved after every renewal.
- Only-what's-missing check by timestamp (±2 minutes), separately for weight
  and blood pressure.
- FIT weight files with body fat %, body water % (converted from kg), bone and
  muscle mass, and blood pressure with pulse; uploaded with hevy-sync's Garmin
  sign-in.
- `data/status.json` for garmin-dashboard's warning banner.
- `data/blood_pressure.json`: every Withings blood pressure reading (full
  history on the first run), for garmin-dashboard's chart.

[Unreleased]: https://github.com/thebruge/withings-sync/compare/v0.1.2...HEAD
[0.1.2]: https://github.com/thebruge/withings-sync/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/thebruge/withings-sync/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/thebruge/withings-sync/releases/tag/v0.1.0
