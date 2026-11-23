#!/usr/bin/env bash
# Перевірка міграцій на ІЗОЛЬОВАНОМУ локальному Postgres (не Supabase, не production).
#
#   PGHOST=localhost PGPORT=5432 PGUSER=postgres \
#     supabase/tests/check_migrations.sh [MAIN_REF] [DEV_REF]
#
# MAIN_REF / DEV_REF — git-посилання на main і dev (за замовчуванням origin/main і
# origin/dev; зробіть `git fetch origin main dev`). Потрібні git, psql, createdb, dropdb.
#
# Що перевіряється:
#   0. версії міграцій унікальні, і жодна версія не збігається з версією ІНШОЇ міграції
#      в main/dev (Supabase CLI впізнає міграцію за версією, а не за назвою);
#   1. чисте встановлення: усі міграції гілки з нуля;
#   2. оновлення з main і з dev: спершу застосовано лише те, що там є, потім нові
#      міграції гілки; дані, що були до оновлення, збереглися;
#   3. злиття: міграції гілки + main з нуля (стан після злиття в main).
#
# Гарантії безпеки:
#   * до будь-якої роботи з БД перевіряється, що ОБИДВА refs існують і містять
#      міграції, що інструменти є, а сервер справді відповідає. Відсутній ref — це
#      помилка, а не пропуск: інакше сценарії оновлення мовчки не виконались би;
#   * кожен запуск створює БД з унікальними іменами bimcheck_<id запуску>_*. Скрипт
#      НІКОЛИ не видаляє БД наперед (createdb падає, якщо ім'я зайняте) і в кінці
#      прибирає лише ті БД, які сам успішно створив: чужі БД і паралельні запуски
#      на тому самому сервері не зачіпаються;
#   * "ALL MIGRATION CHECKS PASSED" друкується лише коли виконано всі 4 сценарії.
set -euo pipefail
export LC_ALL=C

ROOT=$(git rev-parse --show-toplevel)
MIG="supabase/migrations"
TESTS="$ROOT/supabase/tests"
MAIN_REF=${1:-origin/main}
DEV_REF=${2:-origin/dev}
WORK=$(mktemp -d)
RUN_ID="$(date +%s)_$$_${RANDOM}"
CREATED_DBS=()

cleanup() {
  local db
  rm -rf "$WORK"
  # Лише БД, створені цим запуском (CREATED_DBS наповнюється після успішного createdb).
  for db in ${CREATED_DBS[@]+"${CREATED_DBS[@]}"}; do
    dropdb --if-exists "$db" >/dev/null 2>&1 || true
  done
}
trap cleanup EXIT

fail() { echo "FAIL: $*" >&2; exit 1; }
version_of() { basename "$1" | sed -E 's/^([0-9]+)_.*/\1/'; }

# ── 0a. передумови: інструменти, refs, сервер — до будь-якої зміни БД ───────────
for tool in git psql createdb dropdb; do
  command -v "$tool" >/dev/null 2>&1 || fail "required tool not found: $tool"
done

ref_dir() { echo "$WORK/ref_$1"; }
# Файли міграцій ref-а в каталог ref_dir <label>. Помилка, якщо ref або каталог відсутні.
export_ref() { # label ref
  local label=$1 ref=$2 dir
  git -C "$ROOT" rev-parse --verify --quiet "$ref^{tree}" >/dev/null \
    || fail "ref '$ref' ($label) not found; run: git fetch origin main dev (or pass existing refs)"
  git -C "$ROOT" ls-tree -d --name-only "$ref" "$MIG" | grep -qx "$MIG" \
    || fail "ref '$ref' ($label) has no $MIG directory"
  dir=$(ref_dir "$label")
  mkdir -p "$dir"
  git -C "$ROOT" archive "$ref" "$MIG" | tar -x -C "$dir"
  ls "$dir/$MIG"/*.sql >/dev/null 2>&1 || fail "ref '$ref' ($label) has no migrations"
}
export_ref main "$MAIN_REF"
export_ref dev "$DEV_REF"

server_version=$(psql -X -At -d postgres -c "show server_version_num" 2>/dev/null || true)
case "$server_version" in
  ''|*[!0-9]*) fail "PostgreSQL is not reachable (set PGHOST/PGPORT/PGUSER); got: '${server_version}'" ;;
esac
[ "$server_version" -ge 140000 ] || fail "PostgreSQL $server_version is too old (need 14+)"
[ "$(psql -X -At -d postgres -c 'select 1' 2>/dev/null || true)" = "1" ] \
  || fail "psql does not execute SQL against the server"

# ── допоміжні функції ───────────────────────────────────────────────────────
apply_all() { # db file...
  local db=$1; shift
  local f
  for f in "$@"; do
    psql -X -q -v ON_ERROR_STOP=1 -d "$db" -f "$f" >/dev/null 2>"$WORK/err.txt" \
      || { cat "$WORK/err.txt" >&2; fail "$(basename "$f") on $db"; }
  done
}

# Створює БД з унікальним ім'ям; реєструє її для прибирання ЛИШЕ після успішного createdb.
DB_NAME=""
new_db() { # label
  DB_NAME="bimcheck_${RUN_ID}_$1"
  createdb "$DB_NAME" >/dev/null 2>"$WORK/err.txt" \
    || { cat "$WORK/err.txt" >&2; fail "cannot create database $DB_NAME (it is not removed)"; }
  CREATED_DBS+=("$DB_NAME")
  psql -X -q -v ON_ERROR_STOP=1 -d "$DB_NAME" -f "$TESTS/supabase_stubs.sql" >/dev/null
}
check_state() { psql -X -q -v ON_ERROR_STOP=1 -d "$1" -f "$TESTS/assertions.sql" >/dev/null 2>"$WORK/err.txt" || { cat "$WORK/err.txt" >&2; fail "assertions on $1"; }; }

BRANCH_FILES=$(ls "$ROOT/$MIG"/*.sql | sort)
SCENARIOS=0

# ── 0. версії ────────────────────────────────────────────────────────────────
dups=$(for f in $BRANCH_FILES; do version_of "$f"; done | sort | uniq -d)
[ -z "$dups" ] || fail "duplicate migration versions in this branch: $dups"
for pair in "main:$MAIN_REF" "dev:$DEV_REF"; do
  label=${pair%%:*}; ref=${pair#*:}
  for rf in $(ls "$(ref_dir "$label")/$MIG"/*.sql | sort); do
    v=$(version_of "$rf")
    for bf in $BRANCH_FILES; do
      if [ "$(version_of "$bf")" = "$v" ] && [ "$(basename "$bf")" != "$(basename "$rf")" ]; then
        fail "version $v: $(basename "$bf") here vs $(basename "$rf") in $ref"
      fi
    done
  done
done
echo "OK 0: versions are unique and do not clash with $MAIN_REF / $DEV_REF"

# ── 1. чисте встановлення ────────────────────────────────────────────────────
new_db clean
apply_all "$DB_NAME" $BRANCH_FILES
check_state "$DB_NAME"
SCENARIOS=$((SCENARIOS + 1))
echo "OK 1: clean install ($(echo "$BRANCH_FILES" | wc -w) migrations)"

# ── 2. оновлення з main і з dev ──────────────────────────────────────────────
upgrade_from() { # label ref
  local label=$1 ref=$2 dir files new db
  dir=$(ref_dir "$label")/$MIG
  files=$(ls "$dir"/*.sql | sort)
  new_db "up_$label"; db=$DB_NAME
  apply_all "$db" $files
  psql -X -q -v ON_ERROR_STOP=1 -d "$db" -f "$TESTS/seed_before_upgrade.sql" >/dev/null
  new=""
  for bf in $BRANCH_FILES; do
    [ -f "$dir/$(basename "$bf")" ] || new="$new $bf"
  done
  apply_all "$db" $new
  psql -X -q -v ON_ERROR_STOP=1 -d "$db" -f "$TESTS/survival.sql" >/dev/null
  check_state "$db"
  SCENARIOS=$((SCENARIOS + 1))
  echo "OK 2: upgrade from $ref ($(echo $files | wc -w) applied) + new:$(for n in $new; do printf ' %s' "$(basename "$n")"; done)"
}
upgrade_from main "$MAIN_REF"
upgrade_from dev "$DEV_REF"

# ── 3. злиття гілки з main ───────────────────────────────────────────────────
main_dir=$(ref_dir main)/$MIG
merged=$( { ls "$main_dir"/*.sql; echo "$BRANCH_FILES" | tr ' ' '\n'; } | awk -F/ '{n=$NF; if(!(n in s)){s[n]=$0}} END{for(n in s) print n "\t" s[n]}' | sort | cut -f2)
new_db merged
apply_all "$DB_NAME" $merged
check_state "$DB_NAME"
SCENARIOS=$((SCENARIOS + 1))
echo "OK 3: branch + $MAIN_REF applied together from scratch"

[ "$SCENARIOS" -eq 4 ] || fail "only $SCENARIOS of 4 scenarios ran"
echo "ALL MIGRATION CHECKS PASSED (4 of 4 scenarios, databases bimcheck_${RUN_ID}_*)"
