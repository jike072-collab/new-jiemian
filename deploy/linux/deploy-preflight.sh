#!/usr/bin/env bash
set -u

APP_USER="${APP_USER:-aohuang-ai}"
ENV_FILE="${ENV_FILE:-/etc/aohuang-ai/production.env}"
APP_PORT="${APP_PORT:-3106}"
FAILURES=0
WARNINGS=0

pass() {
  printf 'PASS %s\n' "$1"
}

warn() {
  WARNINGS=$((WARNINGS + 1))
  printf 'WARN %s\n' "$1"
}

fail() {
  FAILURES=$((FAILURES + 1))
  printf 'FAIL %s\n' "$1"
}

usage() {
  cat <<'USAGE'
Usage: bash deploy/linux/deploy-preflight.sh [--env-file PATH] [--app-user USER] [--port 3106]

Read-only checks for the Ubuntu 22.04 production host. The script does not print
environment variable values, run migrations, restart services, delete files, or
call any paid provider.
USAGE
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --env-file)
      ENV_FILE="${2:-}"
      shift 2
      ;;
    --app-user)
      APP_USER="${2:-}"
      shift 2
      ;;
    --port)
      APP_PORT="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      fail "unsupported argument"
      usage
      exit 2
      ;;
  esac
done

read_env_var() {
  name="$1"
  [ -f "$ENV_FILE" ] || return 1
  line="$(grep -E "^[[:space:]]*(export[[:space:]]+)?${name}=" "$ENV_FILE" | tail -n 1 || true)"
  [ -n "$line" ] || return 1
  value="${line#*=}"
  value="${value%%#*}"
  value="${value%"${value##*[![:space:]]}"}"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%$'\r'}"
  value="${value%\"}"
  value="${value#\"}"
  value="${value%\'}"
  value="${value#\'}"
  printf '%s' "$value"
}

check_command() {
  label="$1"
  command_name="$2"
  if command -v "$command_name" >/dev/null 2>&1; then
    pass "$label command exists"
    return 0
  fi
  fail "$label command is missing"
  return 1
}

check_node() {
  if ! check_command "node" "node"; then
    return
  fi
  version="$(node -v 2>/dev/null || true)"
  case "$version" in
    v24.*)
      pass "Node.js major version is 24"
      ;;
    *)
      fail "Node.js major version must be 24"
      ;;
  esac
}

check_systemd() {
  if command -v systemctl >/dev/null 2>&1 && systemctl --version >/dev/null 2>&1; then
    pass "systemd is available"
  else
    fail "systemd is not available"
  fi
}

check_nginx() {
  if command -v nginx >/dev/null 2>&1 && nginx -v >/dev/null 2>&1; then
    pass "Nginx is available"
  else
    fail "Nginx is not available"
  fi
}

check_user() {
  if id "$APP_USER" >/dev/null 2>&1; then
    pass "application user exists"
  else
    fail "application user is missing"
  fi
}

mode_digit_allows_read() {
  digit="$1"
  [ $((10#$digit & 4)) -ne 0 ]
}

check_env_file() {
  if [ ! -f "$ENV_FILE" ]; then
    fail "production environment file is missing"
    return
  fi
  pass "production environment file exists"

  if [ -r "$ENV_FILE" ]; then
    pass "production environment file is readable by current operator"
  else
    fail "production environment file is not readable by current operator"
  fi

  mode="$(stat -c '%a' "$ENV_FILE" 2>/dev/null || true)"
  if [ -z "$mode" ]; then
    warn "could not inspect production environment file mode"
  else
    last_digit="${mode: -1}"
    if mode_digit_allows_read "$last_digit"; then
      fail "production environment file must not be world-readable"
    else
      pass "production environment file is not world-readable"
    fi
  fi

  for required_name in NODE_ENV PORT APP_BIND_HOST ADMIN_PASSWORD AUTH_SESSION_SECRET DATA_DIR UPLOADS_DIR RUNTIME_DIR; do
    if read_env_var "$required_name" >/dev/null; then
      pass "required variable is present: $required_name"
    else
      fail "required variable is missing: $required_name"
    fi
  done
}

run_as_app_user_test() {
  test_flag="$1"
  target="$2"
  if [ "$(id -u)" -eq 0 ] && command -v runuser >/dev/null 2>&1 && id "$APP_USER" >/dev/null 2>&1; then
    runuser -u "$APP_USER" -- test "$test_flag" "$target"
    return $?
  fi
  test "$test_flag" "$target"
}

check_directory() {
  label="$1"
  target="$2"

  if [ -z "$target" ]; then
    fail "$label path is not configured"
    return
  fi
  if [ ! -d "$target" ]; then
    fail "$label directory is missing"
    return
  fi
  pass "$label directory exists"

  for flag in -r -w -x; do
    if run_as_app_user_test "$flag" "$target"; then
      pass "$label directory allows $flag for the application user or current operator"
    else
      fail "$label directory does not allow $flag for the application user or current operator"
    fi
  done

  check_disk "$label" "$target"
}

check_disk() {
  label="$1"
  target="$2"
  emergency="$(read_env_var STORAGE_EMERGENCY_PERCENT 2>/dev/null || printf '95')"
  critical="$(read_env_var STORAGE_CRITICAL_PERCENT 2>/dev/null || printf '80')"

  used_percent="$(df -P "$target" 2>/dev/null | awk 'NR==2 { gsub("%", "", $5); print $5 }')"
  inode_percent="$(df -Pi "$target" 2>/dev/null | awk 'NR==2 { gsub("%", "", $5); print $5 }')"

  if [ -z "$used_percent" ]; then
    fail "$label disk usage could not be inspected"
  elif [ "$used_percent" -ge "$emergency" ]; then
    fail "$label disk usage is at or above emergency threshold"
  elif [ "$used_percent" -ge "$critical" ]; then
    warn "$label disk usage is at or above critical threshold"
  else
    pass "$label disk usage is below critical threshold"
  fi

  if [ -z "$inode_percent" ]; then
    fail "$label inode usage could not be inspected"
  elif [ "$inode_percent" -ge 90 ]; then
    fail "$label inode usage is at or above 90 percent"
  elif [ "$inode_percent" -ge 80 ]; then
    warn "$label inode usage is at or above 80 percent"
  else
    pass "$label inode usage is below 80 percent"
  fi
}

check_port() {
  if ! command -v ss >/dev/null 2>&1; then
    warn "ss command is unavailable; port occupancy was not checked"
    return
  fi

  listeners="$(ss -ltnH 2>/dev/null | awk '{ print $4 }' | grep -E "(:|\])${APP_PORT}$" || true)"
  if [ -z "$listeners" ]; then
    pass "port 3106 is not currently listening"
    return
  fi

  public_listener="$(printf '%s\n' "$listeners" | grep -E "(^0\.0\.0\.0:|^\[::\]:|^\*:)${APP_PORT}$" || true)"
  if [ -n "$public_listener" ]; then
    fail "port 3106 is listening on a public address"
  else
    warn "port 3106 is already occupied on a non-public address"
  fi
}

printf 'Aohuang AI Linux deployment preflight\n'
printf 'This output intentionally omits environment variable values.\n'

check_node
check_nginx
check_systemd
check_user
check_env_file

DATA_DIR_VALUE="$(read_env_var DATA_DIR 2>/dev/null || printf '/var/lib/aohuang-ai/data')"
UPLOADS_DIR_VALUE="$(read_env_var UPLOADS_DIR 2>/dev/null || printf '/var/lib/aohuang-ai/uploads')"
RUNTIME_DIR_VALUE="$(read_env_var RUNTIME_DIR 2>/dev/null || printf '/var/lib/aohuang-ai/runtime')"

check_directory "DATA_DIR" "$DATA_DIR_VALUE"
check_directory "UPLOADS_DIR" "$UPLOADS_DIR_VALUE"
check_directory "RUNTIME_DIR" "$RUNTIME_DIR_VALUE"
check_port

if [ "$FAILURES" -gt 0 ]; then
  printf 'Preflight failed: failures=%s warnings=%s\n' "$FAILURES" "$WARNINGS"
  exit 1
fi

printf 'Preflight passed: warnings=%s\n' "$WARNINGS"
