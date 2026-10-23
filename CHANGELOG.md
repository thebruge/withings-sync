# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Fixed
- A network error gets one retry after 30 seconds before it counts as a failed
  sync, and the error names the cause and host instead of just "fetch failed".

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
