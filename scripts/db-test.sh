#!/usr/bin/env bash
# Applies the migrations to a throwaway database and runs the SQL test suite.
#
# Needs a reachable PostgreSQL 16 server. Point PGHOST/PGPORT/PGUSER at one,
# or let it default to a local server on port 5432:
#
#   PGHOST=localhost PGPORT=5432 PGUSER=postgres ./scripts/db-test.sh
#
# The database is dropped and recreated on every run, so it never carries
# state between runs.
set -euo pipefail
shopt -s nullglob

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB="${TEST_DB:-la_pista_test}"
export PGHOST="${PGHOST:-localhost}"
export PGPORT="${PGPORT:-5432}"
export PGUSER="${PGUSER:-postgres}"
export PGPASSWORD="${PGPASSWORD:-postgres}"

psql_q() { psql -v ON_ERROR_STOP=1 -q --no-psqlrc "$@"; }

echo "==> recreating database $DB"
psql_q -d postgres -c "drop database if exists $DB;" >/dev/null
psql_q -d postgres -c "create database $DB;" >/dev/null

echo "==> shim"
psql_q -d "$DB" -f "$ROOT/supabase/tests/00_shim.sql" >/dev/null

echo "==> migrations"
for f in "$ROOT"/supabase/migrations/*.sql; do
  printf '    %s\n' "$(basename "$f")"
  psql_q -d "$DB" -f "$f" >/dev/null
done

echo "==> seed"
psql_q -d "$DB" -f "$ROOT/supabase/seed.sql" >/dev/null

echo "==> helpers"
psql_q -d "$DB" -f "$ROOT/supabase/tests/01_helpers.sql" >/dev/null

echo "==> tests"
failed=0
tests=("$ROOT"/supabase/tests/*.test.sql)
if [ ${#tests[@]} -eq 0 ]; then
  echo "    no test files found"
  exit 1
fi
for f in "${tests[@]}"; do
  name="$(basename "$f")"
  if psql_q -d "$DB" -f "$f" >/dev/null; then
    printf '    ok   %s\n' "$name"
  else
    printf '    FAIL %s\n' "$name"
    failed=1
  fi
done

if [ "$failed" -ne 0 ]; then
  echo "==> FAILED"
  exit 1
fi
echo "==> all green"
