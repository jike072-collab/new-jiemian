#!/usr/bin/env bash
set -u

BASE_URL="${BASE_URL:-http://127.0.0.1:3106}"
TIMEOUT_SECONDS="${TIMEOUT_SECONDS:-10}"
FAILURES=0

pass() {
  printf 'PASS %s\n' "$1"
}

fail() {
  FAILURES=$((FAILURES + 1))
  printf 'FAIL %s\n' "$1"
}

case "$BASE_URL" in
  http://127.0.0.1:3106|http://127.0.0.1:3106/|http://localhost:3106|http://localhost:3106/)
    BASE_URL="${BASE_URL%/}"
    ;;
  *)
    fail "BASE_URL must be local loopback on port 3106"
    printf 'Health check failed: failures=%s\n' "$FAILURES"
    exit 1
    ;;
esac

if ! command -v curl >/dev/null 2>&1; then
  fail "curl is missing"
  printf 'Health check failed: failures=%s\n' "$FAILURES"
  exit 1
fi

check_status() {
  label="$1"
  path="$2"
  expected="$3"
  status="$(curl --silent --show-error --location --max-time "$TIMEOUT_SECONDS" --output /dev/null --write-out '%{http_code}' "${BASE_URL}${path}" 2>/dev/null || printf '000')"
  if [ "$status" = "$expected" ]; then
    pass "$label returned $expected"
  else
    fail "$label returned $status"
  fi
}

check_non_error() {
  label="$1"
  path="$2"
  status="$(curl --silent --show-error --location --max-time "$TIMEOUT_SECONDS" --output /dev/null --write-out '%{http_code}' "${BASE_URL}${path}" 2>/dev/null || printf '000')"
  case "$status" in
    200|204|301|302|303|307|308)
      pass "$label returned non-error status"
      ;;
    *)
      fail "$label returned $status"
      ;;
  esac
}

printf 'Aohuang AI local 3106 health check\n'
printf 'This script calls only local pages and safe backend health endpoints.\n'

check_status "backend liveness" "/api/health/backend?mode=liveness" "200"
check_non_error "home page" "/"
check_non_error "login page" "/login"

if [ "$FAILURES" -gt 0 ]; then
  printf 'Health check failed: failures=%s\n' "$FAILURES"
  exit 1
fi

printf 'Health check passed.\n'
