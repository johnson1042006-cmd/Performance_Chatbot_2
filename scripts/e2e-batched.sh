#!/usr/bin/env bash
# Run Playwright e2e specs one file at a time against a single shared
# `next start` server. Each spec is a fresh playwright invocation so
# chromium is fully torn down between specs (matters on hosts with a
# tight ulimit -u where back-to-back chromium launches can hit EAGAIN).
#
# Usage:
#   scripts/e2e-batched.sh                  # run all specs except @slow
#   scripts/e2e-batched.sh -- e2e/smoke.spec.ts e2e/a11y.spec.ts
#
# Exit codes:
#   0 = all specs passed
#   1 = at least one spec failed
#   2 = server failed to start

set -u

PORT="${E2E_PORT:-3050}"
BASE="http://localhost:${PORT}"

# Locate a sandbox cache directory that contains the arm64 chromium binary.
# Different Cursor sandbox instances cache to different UUIDs; find the first
# one that has what we need and export PLAYWRIGHT_BROWSERS_PATH so all
# playwright invocations below share it.
_PW_BINARY_SEARCH=$(find /var/folders/yz -name "chrome-headless-shell-mac-arm64" -maxdepth 7 2>/dev/null | head -1)
if [[ -n "${_PW_BINARY_SEARCH}" ]]; then
  # Walk up to the playwright/ dir (…/<uuid>/playwright/<browser>/<exe>) → …/<uuid>/playwright
  # PLAYWRIGHT_BROWSERS_PATH must point at the directory that directly contains
  # chromium_headless_shell-1217/ etc., which is the "playwright" subdirectory.
  _PW_CACHE_DIR="$(dirname "$(dirname "$(dirname "${_PW_BINARY_SEARCH}")")")"
  export PLAYWRIGHT_BROWSERS_PATH="${_PW_CACHE_DIR}/playwright"
  echo "[e2e-batched] PLAYWRIGHT_BROWSERS_PATH=${PLAYWRIGHT_BROWSERS_PATH}"
else
  echo "[e2e-batched] WARN: could not locate arm64 chromium; using default path"
fi
LOG_DIR="$(mktemp -d -t e2e-batched.XXXXXX)"
SERVER_LOG="${LOG_DIR}/server.log"
SUMMARY_LOG="${LOG_DIR}/summary.log"

echo "[e2e-batched] log dir: ${LOG_DIR}"

cleanup() {
  echo "[e2e-batched] cleanup"
  pkill -9 -f "next-server" 2>/dev/null || true
  pkill -9 -f "playwright" 2>/dev/null || true
  pkill -9 -f "chrome-headless" 2>/dev/null || true
  if [[ -n "${SERVER_PID:-}" ]]; then
    kill -9 "${SERVER_PID}" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

if [[ -n "$(lsof -ti:"${PORT}" 2>/dev/null)" ]]; then
  echo "[e2e-batched] killing existing process on :${PORT}"
  lsof -ti:"${PORT}" | xargs kill -9 2>/dev/null || true
  sleep 2
fi

echo "[e2e-batched] starting next start on :${PORT}"
# Pass the same env vars that playwright.config.ts webServer block sets so
# test-mode features (auto-ticket keyword matcher, email mock) work when the
# server is started outside of Playwright's webServer lifecycle.
NEXTAUTH_URL="${BASE}" \
  TAGGER_TEST_MODE=1 \
  TICKET_AUTO_CREATE_TEST_MODE=1 \
  E2E_EMAIL_MOCK=1 \
  npm run start -- --port "${PORT}" > "${SERVER_LOG}" 2>&1 &
SERVER_PID=$!

for i in {1..40}; do
  if curl -sf "${BASE}" > /dev/null 2>&1 || curl -sf "${BASE}/login" > /dev/null 2>&1; then
    echo "[e2e-batched] server up after ${i}s"
    break
  fi
  if ! kill -0 "${SERVER_PID}" 2>/dev/null; then
    echo "[e2e-batched] server died early; tail of server log:"
    tail -40 "${SERVER_LOG}"
    exit 2
  fi
  sleep 1
done

if ! curl -sf "${BASE}/login" > /dev/null 2>&1; then
  echo "[e2e-batched] server did not become reachable; tail of server log:"
  tail -40 "${SERVER_LOG}"
  exit 2
fi

if [[ "$#" -gt 0 ]] && [[ "$1" == "--" ]]; then
  shift
fi

declare -a SPECS=()
if [[ "$#" -eq 0 ]]; then
  for f in e2e/*.spec.ts; do
    case "$(basename "${f}")" in
      bot-quality.spec.ts) ;;
      *) SPECS+=("${f}") ;;
    esac
  done
else
  SPECS=("$@")
fi

echo "[e2e-batched] specs to run: ${#SPECS[@]}"
for s in "${SPECS[@]}"; do echo "  - ${s}"; done

declare -a PASSED=()
declare -a FAILED=()

for spec in "${SPECS[@]}"; do
  name="$(basename "${spec}" .spec.ts)"
  log="${LOG_DIR}/${name}.log"
  echo
  echo "==[ ${spec} ]=========================================================="
  pkill -9 -f "chrome-headless" 2>/dev/null || true
  sleep 1
  E2E_BASE_URL="${BASE}" E2E_REUSE_SERVER=1 \
    npx playwright test "${spec}" --grep-invert @slow > "${log}" 2>&1
  rc=$?
  tail -25 "${log}"
  if [[ "${rc}" -eq 0 ]]; then
    PASSED+=("${spec}")
  else
    FAILED+=("${spec}:${rc}")
  fi
done

echo
echo "================ E2E BATCHED SUMMARY ================"
echo "PASSED (${#PASSED[@]}):"
if [[ "${#PASSED[@]}" -gt 0 ]]; then
  for p in "${PASSED[@]}"; do echo "  ok ${p}"; done
fi
echo "FAILED (${#FAILED[@]}):"
if [[ "${#FAILED[@]}" -gt 0 ]]; then
  for f in "${FAILED[@]}"; do echo "  XX ${f}"; done
fi
echo "Logs in ${LOG_DIR}"
echo "====================================================="

if [[ "${#FAILED[@]}" -eq 0 ]]; then
  exit 0
else
  exit 1
fi
