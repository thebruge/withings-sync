#!/bin/sh
# Send new Withings readings to Garmin. Extra arguments go to `node sync.mjs sync`
# (default: the last 30 days). Logs to data/sync.log.
cd "$(dirname "$0")" || exit 1
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
export NODE_USE_ENV_PROXY=1                            # use a proxy if one is set (no effect otherwise)
mkdir -p data
# Errors that can clear up on their own: network trouble, or a service briefly
# overloaded (HTTP 429/5xx). Those get up to 3 retries, after 5, 15 and 30 seconds.
# Re-running is safe: each run checks what's already on Garmin before uploading.
# Anything else (a refused sign-in, a rejected file) fails straight away.
RETRYABLE='fetch failed|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|socket hang up|UND_ERR|\(429\)|\(5[0-9][0-9]\)|HTTP 429|HTTP 5[0-9][0-9]'
for wait in 5 15 30 done; do
  out=$(node sync.mjs sync "$@" 2>&1); status=$?
  [ $status -eq 0 ] && break
  [ "$wait" = done ] && break
  printf '%s' "$out" | grep -Eq "$RETRYABLE" || break
  printf '%s\n' "$out" >> data/sync.log
  echo "Temporary error; retrying in ${wait}s." | tee -a data/sync.log
  sleep "$wait"
done
printf '%s\n' "$out" | tee -a data/sync.log
exit $status
