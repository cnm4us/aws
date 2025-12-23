#!/usr/bin/env bash
set -euo pipefail

# Tiny helper for authenticated curl calls against this app.
# 
# Usage:
#   # 1) Log in once (uses AUTH_EMAIL / AUTH_PASSWORD env vars)
#   AUTH_EMAIL="you@example.com" AUTH_PASSWORD="secret" ./scripts/auth_curl.sh login
# 
#   # Or: log in using a named profile from AUTH_PROFILES_FILE (default: .codex-local/auth_profiles.env)
#   ./scripts/auth_curl.sh --profile super login
# 
#   # 2) Authenticated GET (session cookie reused)
#   ./scripts/auth_curl.sh get /api/pages/home
# 
#   # 3) Authenticated POST with automatic CSRF header
#   ./scripts/auth_curl.sh post /api/profile/slug \
#     -H 'Content-Type: application/json' \
#     --data '{"slug":"example-handle"}'
#
# Configuration:
#   BASE_URL   - defaults to http://localhost:3300 (matches src/config.ts PORT default)
#   AUTH_PROFILE - defaults to "default" (affects default COOKIE_JAR + profile lookup)
#   AUTH_PROFILES_FILE - defaults to .codex-local/auth_profiles.env (gitignored; see .codex-local/auth_profiles.env.example)
#   COOKIE_JAR - defaults to .tmp/auth_cookies.<profile>.txt
#   AUTH_LOG_FILE - if set, appends a brief log for get/post/put/delete (never logs login)
#
# Notes:
#   - This is intentionally minimal and is meant for local/dev testing.
#   - It relies on the existing /api/login endpoint and the sid/csrf cookies it sets.

BASE_URL="${BASE_URL:-http://localhost:3300}"
AUTH_PROFILE="${AUTH_PROFILE:-default}"
AUTH_PROFILES_FILE="${AUTH_PROFILES_FILE:-.codex-local/auth_profiles.env}"

INCLUDE_HEADERS="${INCLUDE_HEADERS:-0}"

while [ "${1-}" != "" ]; do
  case "$1" in
    --profile)
      shift
      AUTH_PROFILE="${1-}"
      shift || true
      ;;
    --include)
      INCLUDE_HEADERS=1
      shift
      ;;
    --)
      shift
      break
      ;;
    -*)
      # First non-option is the command; stop parsing.
      break
      ;;
    *)
      break
      ;;
  esac
done

if [ -z "$AUTH_PROFILE" ]; then
  echo "--profile requires a non-empty value." >&2
  exit 1
fi

COOKIE_JAR="${COOKIE_JAR:-.tmp/auth_cookies.${AUTH_PROFILE}.txt}"

mkdir -p "$(dirname "$COOKIE_JAR")"
touch "$COOKIE_JAR"

if [ -f "$AUTH_PROFILES_FILE" ]; then
  # shellcheck disable=SC1090
  source "$AUTH_PROFILES_FILE"
fi

usage() {
  cat >&2 <<EOF
Usage:
  AUTH_EMAIL="you@example.com" AUTH_PASSWORD="secret" $0 login
  $0 --profile super login
  $0 get /api/pages/home
  $0 post /api/profile/slug -H 'Content-Type: application/json' --data '{"slug":"example"}'

Environment:
  BASE_URL=http://localhost:3300
  AUTH_PROFILE=default
  AUTH_PROFILES_FILE=.codex-local/auth_profiles.env
  COOKIE_JAR=.tmp/auth_cookies.<profile>.txt

Commands:
  login         Log in via /api/login and store sid/csrf cookies
  me            Convenience: GET /api/me
  get PATH      Authenticated GET to BASE_URL+PATH
  post PATH ... Authenticated POST with x-csrf-token header
  put PATH ...  Authenticated PUT with x-csrf-token header
  delete PATH ... Authenticated DELETE with x-csrf-token header
EOF
}

if [ "${1-}" = "" ]; then
  usage
  exit 1
fi

cmd="$1"
shift || true

profile_var_prefix() {
  # profile "space-admin" -> "SPACE_ADMIN"
  printf '%s' "$AUTH_PROFILE" | tr '[:lower:]-' '[:upper:]_'
}

resolve_profile_creds() {
  local prefix emailVar passVar
  prefix="$(profile_var_prefix)"
  emailVar="${prefix}_EMAIL"
  passVar="${prefix}_PASSWORD"

  # If caller set explicit env vars, prefer them.
  if [ -n "${AUTH_EMAIL:-}" ] && [ -n "${AUTH_PASSWORD:-}" ]; then
    return 0
  fi

  # Fall back to profile file.
  AUTH_EMAIL="${AUTH_EMAIL:-${!emailVar-}}"
  AUTH_PASSWORD="${AUTH_PASSWORD:-${!passVar-}}"
}

curl_req() {
  local method url
  method="$1"
  url="$2"
  shift 2

  local hdrTmp bodyTmp code
  hdrTmp="$(mktemp)"
  bodyTmp="$(mktemp)"

  code="$(
    curl -sS \
      -D "$hdrTmp" \
      -o "$bodyTmp" \
      -w '%{http_code}' \
      "$@" \
      -X "$method" \
      "$url"
  )"

  echo "HTTP $code"
  if [ "$INCLUDE_HEADERS" = "1" ]; then
    # Redact Set-Cookie values to avoid leaking sid/csrf into logs.
    awk 'BEGIN{IGNORECASE=1} /^set-cookie:/ {print "set-cookie: <redacted>"; next} {print}' "$hdrTmp"
    echo
  fi
  cat "$bodyTmp"

  if [ -n "${AUTH_LOG_FILE:-}" ]; then
    {
      echo
      echo "### $(date -Is)"
      echo "- Profile: \`$AUTH_PROFILE\`"
      echo "- Request: \`$method $url\`"
      echo "- Status: \`$code\`"
      echo '```'
      cat "$bodyTmp"
      echo '```'
    } >> "$AUTH_LOG_FILE"
  fi

  rm -f "$hdrTmp" "$bodyTmp"
}

case "$cmd" in
  login)
    resolve_profile_creds
    EMAIL="${AUTH_EMAIL:-}"
    PASSWORD="${AUTH_PASSWORD:-}"
    if [ -z "$EMAIL" ] || [ -z "$PASSWORD" ]; then
      echo "Missing credentials for profile '$AUTH_PROFILE'." >&2
      echo "Set AUTH_EMAIL/AUTH_PASSWORD or create $AUTH_PROFILES_FILE (see .codex-local/auth_profiles.env.example)." >&2
      exit 1
    fi
    echo "Logging in to ${BASE_URL}/api/login as ${EMAIL}..."
    payload="$(node -e 'console.log(JSON.stringify({email: process.argv[1], password: process.argv[2]}))' "$EMAIL" "$PASSWORD")"
    # Never write login response headers to stdout (Set-Cookie includes the session token).
    AUTH_LOG_FILE_SAVED="${AUTH_LOG_FILE:-}"
    unset AUTH_LOG_FILE || true
    curl_req "POST" "${BASE_URL}/api/login" \
      -c "$COOKIE_JAR" \
      -H 'Content-Type: application/json' \
      --data "$payload" \
      | awk 'BEGIN{printed=0} /^HTTP /{print; next} {print}'
    if [ -n "$AUTH_LOG_FILE_SAVED" ]; then
      AUTH_LOG_FILE="$AUTH_LOG_FILE_SAVED"
      export AUTH_LOG_FILE
    fi
    ;;

  me)
    curl_req "GET" "${BASE_URL}/api/me" -b "$COOKIE_JAR"
    ;;

  get)
    if [ "${1-}" = "" ]; then
      echo "get requires a PATH argument, e.g. /api/pages/home" >&2
      exit 1
    fi
    PATH_PART="$1"
    shift || true
    curl_req "GET" "${BASE_URL}${PATH_PART}" -b "$COOKIE_JAR" "$@"
    ;;

  post|put|delete)
    if [ "${1-}" = "" ]; then
      echo "$cmd requires a PATH argument, e.g. /api/profile/slug" >&2
      exit 1
    fi
    METHOD="$(printf '%s' "$cmd" | tr '[:lower:]' '[:upper:]')"
    PATH_PART="$1"
    shift || true

    CSRF_TOKEN=""
    if [ -f "$COOKIE_JAR" ]; then
      # Netscape cookie format: last column is value; name is column 6.
      CSRF_TOKEN="$(awk '($6 == "csrf") { val=$7 } END { print val }' "$COOKIE_JAR" || true)"
    fi

    if [ -z "$CSRF_TOKEN" ]; then
      echo "Warning: csrf token not found in cookie jar; request may fail CSRF checks." >&2
    fi

    curl_req "$METHOD" "${BASE_URL}${PATH_PART}" \
      -b "$COOKIE_JAR" \
      ${CSRF_TOKEN:+-H "x-csrf-token: $CSRF_TOKEN"} \
      "$@"
    ;;

  -*|help|--help)
    usage
    ;;

  *)
    echo "Unknown command: $cmd" >&2
    usage
    exit 1
    ;;
esac
