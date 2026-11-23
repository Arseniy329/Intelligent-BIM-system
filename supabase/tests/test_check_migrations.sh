#!/usr/bin/env bash
# Самоперевірка check_migrations.sh: негативні сценарії і безпека БД.
#
#   PGHOST=localhost PGPORT=5432 PGUSER=postgres \
#     supabase/tests/test_check_migrations.sh [MAIN_REF] [DEV_REF]
#
# Потрібен ізольований Postgres (як і для check_migrations.sh) і refs origin/main,
# origin/dev (`git fetch origin main dev`). Сценарії:
#   H.   (під заглушками, за журналом викликів) існує лише стороння bimcheck_main —
#        нова поведінка не планує dropdb для БД, якої не створювала; негативний
#        контроль ФІКСУЄ, що стара (безумовна) поведінка видалила б її;
#   I.   (під заглушками) перший createdb успішний, другий падає — за журналом
#        прибирання торкається лише створеної БД, не тієї, що не створилася;
#   A–C. відсутній main-ref / dev-ref / обидва: помилка ДО роботи з БД, жодної БД не
#        створено, повідомлення пояснює причину (а не "ALL MIGRATION CHECKS PASSED");
#   D.   замість Postgres заглушки (psql/createdb/dropdb нічого не роблять): помилка;
#   E.   чужі БД зі старими фіксованими іменами (bimcheck_clean|main|dev|merged)
#        переживають успішний запуск разом зі своїми даними;
#   F.   два паралельних запуски на одному сервері не заважають один одному;
#   G.   запуск, що впав на зламаній міграції, прибирає лише власні БД і не чіпає чужих.
#
# Безпека прибирання: як і основний скрипт, самотест НІКОЛИ не видаляє БД наперед і в
# кінці (чи при аварії) прибирає ЛИШЕ ті БД, які сам успішно створив (``CREATED``).
# Безумовний dropdb фіксованих імен видаляв би чужу БД, що існувала до запуску.
set -euo pipefail
export LC_ALL=C

ROOT=$(git rev-parse --show-toplevel)
SCRIPT=${CHECK_SCRIPT:-"$ROOT/supabase/tests/check_migrations.sh"}
MAIN_REF=${1:-origin/main}
DEV_REF=${2:-origin/dev}
WORK=$(mktemp -d)
SELF_ID="$$_${RANDOM}"
CANARIES=(bimcheck_clean bimcheck_main bimcheck_dev bimcheck_merged)
CREATED=()  # БД, які створив САМЕ цей запуск; лише їх можна прибирати
CASES=0

drop_created() {
  local db
  for db in ${CREATED[@]+"${CREATED[@]}"}; do
    dropdb --if-exists "$db" >/dev/null 2>&1 || true
  done
}
cleanup() {
  drop_created
  git -C "$ROOT" worktree remove --force "$WORK/broken" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

fail() { echo "SELF-TEST FAIL: $*" >&2; exit 1; }
ok() { CASES=$((CASES + 1)); echo "OK $1"; }
db_exists() {
  [ "$(psql -X -At -d postgres -c "select 1 from pg_database where datname='$1'" 2>/dev/null || true)" = "1" ]
}
bimcheck_dbs() {
  psql -X -At -d postgres -c \
    "select datname from pg_database where datname like 'bimcheck\\_%' order by 1"
}

# Падає, якщо якась із цих БД уже існує; НЕ реєструє й НЕ видаляє її (вона чужа).
# Явний return 0: інакше остання ітерація з неіснуючою БД дала б статус 1 і set -e
# мовчки завершив би скрипт.
guard_absent() {
  local db
  for db in "$@"; do
    if db_exists "$db"; then
      fail "database $db already exists on this server; the self-test will not touch it"
    fi
  done
  return 0
}

# Створює БД-імітацію чужої і реєструє її для прибирання ЛИШЕ після успіху createdb.
make_canary() {
  local db=$1
  createdb "$db" >/dev/null 2>"$WORK/err.txt" || { cat "$WORK/err.txt" >&2; fail "cannot create $db"; }
  CREATED+=("$db")
  psql -X -q -d "$db" -c \
    "create table canary(owner text); insert into canary values ('someone else')" >/dev/null
}

# ── H, I під ЗАГЛУШКАМИ: перевіряємо ЖУРНАЛ викликів, нічого не видаляючи ───────
# createdb/dropdb/psql підміняються функціями, що лише ведуть журнал і моделюють
# наявні БД. Так небезпечний виклик dropdb ФІКСУЄТЬСЯ, а не виконується; реальної
# БД ці кейси не торкаються (нову поведінку на справжньому Postgres перевіряють E–G).
STUBLOG="$WORK/stub_calls.log"
SIM=""  # імена «наявних» БД (для заглушок), розділені пробілами
sim_present() { printf '%s\n' $SIM | grep -qx "$1"; }
createdb() { echo "createdb $1" >>"$STUBLOG"; if sim_present "$1"; then return 1; fi; SIM="$SIM $1"; return 0; }
dropdb() { echo "dropdb ${!#}" >>"$STUBLOG"; return 0; }  # лише журнал, без видалення
psql() {
  local last=""
  for last; do :; done  # остання позиційна — рядок запиту після -c
  case $last in
    *"pg_database where datname='"*)
      local n=${last#*datname=\'}; n=${n%%\'*}; sim_present "$n" && echo 1 || true ;;
  esac
  return 0
}

# H. Існує лише СТОРОННЯ bimcheck_main. Нова поведінка (guard + облік) не має
#    викликати dropdb для жодної БД, якої цей запуск не створював.
: >"$STUBLOG"; SIM="bimcheck_main"
(
  CREATED=()
  trap 'drop_created' EXIT
  guard_absent "${CANARIES[@]}"  # впаде на bimcheck_main → EXIT → drop_created (реєстр порожній)
) >/dev/null 2>&1 || true
! grep -q '^dropdb ' "$STUBLOG" \
  || fail "H: a database this run did not create was scheduled for dropping: $(grep '^dropdb ' "$STUBLOG" | tr '\n' ' ')"
# Негативний контроль ФІКСУЄ (не виконує) небезпечний виклик старої поведінки:
# безумовний dropdb фіксованих імен торкнувся б сторонньої bimcheck_main.
: >"$STUBLOG"
old_unsafe_cleanup() { local db; for db in "${CANARIES[@]}"; do dropdb --if-exists "$db"; done; }
old_unsafe_cleanup
grep -qx "dropdb bimcheck_main" "$STUBLOG" \
  || fail "H: negative control did not record the unsafe drop of a foreign database"
ok "H: a foreign bimcheck_* database is never dropped (recorded calls; old cleanup would)"

# I. Перший createdb успішний, другий (БД уже існує) падає. Прибирання за аварією
#    має торкнутись ЛИШЕ створеної БД — перевіряємо фактичні виклики в журналі.
: >"$STUBLOG"
a="bimcheck_selftest_i_a_${SELF_ID}"
b="bimcheck_selftest_i_b_${SELF_ID}"
SIM="$b"  # b «уже існує» → createdb b впаде
(
  CREATED=()
  trap 'drop_created' EXIT
  make_canary "$a"  # створено й зареєстровано
  make_canary "$b"  # createdb падає → fail → EXIT → drop_created
) >/dev/null 2>&1 || true
grep -qx "createdb $a" "$STUBLOG" || fail "I: expected a createdb for $a"
grep -qx "createdb $b" "$STUBLOG" || fail "I: expected a failed createdb for $b"
grep -qx "dropdb $a" "$STUBLOG" || fail "I: the created database $a was not cleaned up"
! grep -qx "dropdb $b" "$STUBLOG" \
  || fail "I: cleanup dropped $b, which this run did not create"
ok "I: a failed createdb is not registered; cleanup drops only the created database"

unset -f createdb dropdb psql sim_present old_unsafe_cleanup
SIM=""; CREATED=()

# ── Передумова для E–G: фіксовані імена ще не зайняті (інакше не чіпаємо їх) ────
guard_absent "${CANARIES[@]}"

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

# D. Заглушки замість Postgres не дають "пройдено".
mkdir -p "$WORK/stubs"
for tool in psql createdb dropdb; do printf '#!/bin/sh\nexit 0\n' >"$WORK/stubs/$tool"; chmod +x "$WORK/stubs/$tool"; done
expect_failure "D stubbed postgres" "not reachable" env PATH="$WORK/stubs:$PATH" bash "$SCRIPT" "$MAIN_REF" "$DEV_REF"
ok "D: stubbed psql/createdb/dropdb are detected and fail"

# Чужі БД зі старими фіксованими іменами + маркер у кожній (створює цей запуск).
for db in "${CANARIES[@]}"; do make_canary "$db"; done

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
