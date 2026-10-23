#!/bin/sh
# Send new Withings readings to Garmin. Extra arguments go to `node sync.mjs sync`
# (default: the last 30 days). Logs to data/sync.log.
cd "$(dirname "$0")" || exit 1
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
export NODE_USE_ENV_PROXY=1                            # use a proxy if one is set (no effect otherwise)
mkdir -p data
out=$(node sync.mjs sync "$@" 2>&1); status=$?
# A network blip (e.g. the API briefly unreachable) gets one retry before it counts.
if [ $status -ne 0 ] && printf '%s' "$out" | grep -q "fetch failed"; then
  printf '%s\n' "$out" >> data/sync.log
  echo "Network error; retrying in 30 seconds." | tee -a data/sync.log
  sleep 30
  out=$(node sync.mjs sync "$@" 2>&1); status=$?
fi
printf '%s\n' "$out" | tee -a data/sync.log
exit $status
