#!/usr/bin/env bash
# Самоперевірка check_migrations.sh: негативні сценарії і безпека БД.
#
#   PGHOST=localhost PGPORT=5432 PGUSER=postgres \
#     supabase/tests/test_check_migrations.sh [MAIN_REF] [DEV_REF]
#
# Потрібен ізольований Postgres (як і для check_migrations.sh) і refs origin/main,
# origin/dev (`git fetch origin main dev`). Сценарії:
#   A–C. відсутній main-ref / dev-ref / обидва: помилка ДО роботи з БД, жодної БД не
#        створено, повідомлення пояснює причину (а не "ALL MIGRATION CHECKS PASSED");
#   D.   замість Postgres заглушки (psql/createdb/dropdb нічого не роблять): помилка;
#   E.   чужі БД зі старими фіксованими іменами (bimcheck_clean|main|dev|merged)
#        переживають успішний запуск разом зі своїми даними;
#   F.   два паралельних запуски на одному сервері не заважають один одному;
#   G.   запуск, що впав на зламаній міграції, прибирає лише власні БД і не чіпає чужих.
set -euo pipefail
export LC_ALL=C

ROOT=$(git rev-parse --show-toplevel)
SCRIPT=${CHECK_SCRIPT:-"$ROOT/supabase/tests/check_migrations.sh"}
MAIN_REF=${1:-origin/main}
DEV_REF=${2:-origin/dev}
WORK=$(mktemp -d)
CANARIES=(bimcheck_clean bimcheck_main bimcheck_dev bimcheck_merged)
CASES=0

cleanup() {
  local db
  for db in "${CANARIES[@]}"; do dropdb --if-exists "$db" >/dev/null 2>&1 || true; done
  git -C "$ROOT" worktree remove --force "$WORK/broken" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

fail() { echo "SELF-TEST FAIL: $*" >&2; exit 1; }
ok() { CASES=$((CASES + 1)); echo "OK $1"; }
bimcheck_dbs() { psql -X -At -d postgres -c "select datname from pg_database where datname like 'bimcheck\\_%' order by 1"; }

for db in "${CANARIES[@]}"; do
  psql -X -At -d postgres -c "select 1 from pg_database where datname='$db'" | grep -q 1 \
    && fail "database $db already exists on this server; the self-test will not touch it"
done

# Чужі БД зі старими фіксованими іменами + маркер у кожній.
for db in "${CANARIES[@]}"; do
  createdb "$db"
  psql -X -q -d "$db" -c "create table canary(owner text); insert into canary values ('someone else')"
done
canaries_intact() {
  local db
  for db in "${CANARIES[@]}"; do
    [ "$(psql -X -At -d "$db" -c 'select owner from canary' 2>/dev/null || true)" = "someone else" ] \
      || fail "$1: foreign database $db was dropped or modified"
  done
}
foreign_dbs_only() { # після запуску не лишилось БД цього скрипта, окрім чужих canary
  local left
  left=$(bimcheck_dbs | grep -v -x -F "$(printf '%s\n' "${CANARIES[@]}")" || true)
  [ -z "$left" ] || fail "$1: leftover databases: $left"
}
expect_failure() { # label expected-text cmd...
  local label=$1 text=$2; shift 2
  local out="$WORK/out.txt" before after
  before=$(bimcheck_dbs)
  if "$@" >"$out" 2>&1; then cat "$out"; fail "$label: expected a failure"; fi
  grep -q "$text" "$out" || { cat "$out"; fail "$label: message does not mention '$text'"; }
  ! grep -q "ALL MIGRATION CHECKS PASSED" "$out" || fail "$label: reported success"
  after=$(bimcheck_dbs)
  [ "$before" = "$after" ] || fail "$label: databases changed ($before → $after)"
}

MISSING="refs/heads/does-not-exist-$$"

# A–C. Відсутні refs.
expect_failure "A missing main ref" "not found" bash "$SCRIPT" "$MISSING" "$DEV_REF"
ok "A: missing main ref fails before any database work"
expect_failure "B missing dev ref" "not found" bash "$SCRIPT" "$MAIN_REF" "$MISSING"
ok "B: missing dev ref fails before any database work"
expect_failure "C both refs missing" "not found" bash "$SCRIPT" "$MISSING" "$MISSING-2"
ok "C: both refs missing fail (no skipped upgrade scenarios)"
canaries_intact "A–C"

# D. Заглушки замість Postgres не дають "пройдено".
mkdir -p "$WORK/stubs"
for tool in psql createdb dropdb; do printf '#!/bin/sh\nexit 0\n' >"$WORK/stubs/$tool"; chmod +x "$WORK/stubs/$tool"; done
expect_failure "D stubbed postgres" "not reachable" env PATH="$WORK/stubs:$PATH" bash "$SCRIPT" "$MAIN_REF" "$DEV_REF"
ok "D: stubbed psql/createdb/dropdb are detected and fail"

# E. Успішний запуск не торкається чужих БД зі старими іменами.
out=$(bash "$SCRIPT" "$MAIN_REF" "$DEV_REF" 2>&1) || { echo "$out"; fail "E: the real run failed"; }
echo "$out" | grep -q "ALL MIGRATION CHECKS PASSED (4 of 4" || { echo "$out"; fail "E: not 4 of 4 scenarios"; }
canaries_intact "E"; foreign_dbs_only "E"
ok "E: foreign databases named bimcheck_clean|main|dev|merged survive a successful run"

# F. Паралельні запуски.
bash "$SCRIPT" "$MAIN_REF" "$DEV_REF" >"$WORK/p1.txt" 2>&1 & p1=$!
bash "$SCRIPT" "$MAIN_REF" "$DEV_REF" >"$WORK/p2.txt" 2>&1 & p2=$!
wait "$p1" || { cat "$WORK/p1.txt"; fail "F: first parallel run failed"; }
wait "$p2" || { cat "$WORK/p2.txt"; fail "F: second parallel run failed"; }
for f in p1 p2; do grep -q "4 of 4" "$WORK/$f.txt" || fail "F: $f did not finish all scenarios"; done
canaries_intact "F"; foreign_dbs_only "F"
ok "F: two parallel runs on one server do not interfere and clean up"

# G. Запуск, що впав, прибирає лише власні БД.
git -C "$ROOT" worktree add -q --detach "$WORK/broken" HEAD
echo "select no_such_function_for_selftest();" >"$WORK/broken/supabase/migrations/999_broken_selftest.sql"
(cd "$WORK/broken" && expect_failure "G broken migration" "999_broken_selftest.sql" bash "$SCRIPT" "$MAIN_REF" "$DEV_REF")
canaries_intact "G"; foreign_dbs_only "G"
ok "G: a failed run removes only its own databases"

echo "SELF-TEST PASSED ($CASES cases)"
