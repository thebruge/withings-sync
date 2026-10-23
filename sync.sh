#!/bin/sh
# Send new Withings readings to Garmin. Extra arguments go to `node sync.mjs sync`
# (default: the last 30 days). Logs to data/sync.log.
cd "$(dirname "$0")" || exit 1
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
export NODE_USE_ENV_PROXY=1                            # use a proxy if one is set (no effect otherwise)
mkdir -p data
out=$(node sync.mjs sync "$@" 2>&1); status=$?
printf '%s\n' "$out" | tee -a data/sync.log
exit $status
