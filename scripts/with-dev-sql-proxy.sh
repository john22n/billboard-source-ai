#!/usr/bin/env bash
# GitHub runner only: run one command through the fixed dev IAM proxy.
set -euo pipefail

proxy="${RUNNER_TEMP:?RUNNER_TEMP must be set}/cloud-sql-proxy"
curl --fail --silent --show-error --location \
  https://storage.googleapis.com/cloud-sql-connectors/cloud-sql-proxy/v2.27.0/cloud-sql-proxy.linux.amd64 \
  --output "$proxy"
echo "39ed2abcaa073c3b4714585e36a904e2b1d92218c5e07c18224fb73ef4bedde5  $proxy" | sha256sum --check
chmod +x "$proxy"

"$proxy" \
  --auto-iam-authn --address 127.0.0.1 --port 15432 \
  --health-check --http-address 127.0.0.1 --http-port 19090 \
  --run-connection-test \
  cs-poc-l0o7at4xalxqxcyxekiay2j:us-central1:billboard-source-db-dev &
proxy_pid=$!
trap 'kill "$proxy_pid" 2>/dev/null || true; wait "$proxy_pid" 2>/dev/null || true' EXIT

for attempt in {1..60}; do
  kill -0 "$proxy_pid"
  if curl --fail --silent http://127.0.0.1:19090/readiness >/dev/null; then
    "$@"
    exit 0
  fi
  sleep 1
done
echo 'Dev proxy did not become ready; command not attempted.' >&2
exit 1
