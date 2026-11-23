#!/usr/bin/env bash
# Перевірка міграцій на ІЗОЛЬОВАНОМУ локальному Postgres (не Supabase, не production).
#
#   PGHOST=localhost PGPORT=5432 PGUSER=postgres \
#     supabase/tests/check_migrations.sh [MAIN_REF] [DEV_REF]
#
# MAIN_REF / DEV_REF — git-посилання на main і dev (за замовчуванням origin/main і
# origin/dev; зробіть `git fetch origin main dev`). Скрипт створює й видаляє тимчасові
# БД bimcheck_*; потрібні psql, createdb, dropdb і git.
#
# Що перевіряється:
#   0. версії міграцій унікальні, і жодна версія не збігається з версією ІНШОЇ міграції
#      в main/dev (Supabase CLI впізнає міграцію за версією, а не за назвою);
#   1. чисте встановлення: усі міграції гілки з нуля;
#   2. оновлення з main і з dev: спершу застосовано лише те, що там є, потім нові
#      міграції гілки; дані, що були до оновлення, збереглися;
#   3. злиття: міграції гілки + main з нуля (стан після злиття в main).
set -euo pipefail
export LC_ALL=C

ROOT=$(git rev-parse --show-toplevel)
MIG="supabase/migrations"
TESTS="$ROOT/supabase/tests"
MAIN_REF=${1:-origin/main}
DEV_REF=${2:-origin/dev}
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"; for db in clean main dev merged; do dropdb --if-exists "bimcheck_$db" >/dev/null 2>&1 || true; done' EXIT

fail() { echo "FAIL: $*" >&2; exit 1; }
version_of() { basename "$1" | sed -E 's/^([0-9]+)_.*/\1/'; }

# Файли міграцій ref-а в каталог $2 (порожній, якщо ref відсутній).
export_ref() {
  mkdir -p "$2"
  if git rev-parse --verify --quiet "$1^{tree}" >/dev/null; then
    git -C "$ROOT" archive "$1" "$MIG" | tar -x -C "$2"
    echo "$2/$MIG"
  else
    mkdir -p "$2/$MIG"
    echo "WARN: ref $1 not found, skipped" >&2
    echo "$2/$MIG"
  fi
}

apply_all() { # db file...
  local db=$1; shift
  local f
  for f in "$@"; do
    psql -q -v ON_ERROR_STOP=1 -d "$db" -f "$f" >/dev/null 2>"$WORK/err.txt" \
      || { cat "$WORK/err.txt" >&2; fail "$(basename "$f") on $db"; }
  done
}

new_db() { dropdb --if-exists "$1" >/dev/null 2>&1; createdb "$1"; psql -q -v ON_ERROR_STOP=1 -d "$1" -f "$TESTS/supabase_stubs.sql" >/dev/null; }
check_state() { psql -q -v ON_ERROR_STOP=1 -d "$1" -f "$TESTS/assertions.sql" >/dev/null 2>"$WORK/err.txt" || { cat "$WORK/err.txt" >&2; fail "assertions on $1"; }; }

BRANCH_FILES=$(ls "$ROOT/$MIG"/*.sql | sort)

# ── 0. версії ────────────────────────────────────────────────────────────────
dups=$(for f in $BRANCH_FILES; do version_of "$f"; done | sort | uniq -d)
[ -z "$dups" ] || fail "duplicate migration versions in this branch: $dups"
for ref in "$MAIN_REF" "$DEV_REF"; do
  dir=$(export_ref "$ref" "$WORK/$(echo "$ref" | tr '/' '_')")
  for rf in $(ls "$dir"/*.sql 2>/dev/null | sort); do
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
new_db bimcheck_clean
apply_all bimcheck_clean $BRANCH_FILES
check_state bimcheck_clean
echo "OK 1: clean install ($(echo "$BRANCH_FILES" | wc -w) migrations)"

# ── 2. оновлення з main і з dev ──────────────────────────────────────────────
upgrade_from() { # label ref
  local label=$1 ref=$2 dir files new
  dir=$WORK/$(echo "$ref" | tr '/' '_')/$MIG
  files=$(ls "$dir"/*.sql 2>/dev/null | sort || true)
  [ -n "$files" ] || { echo "SKIP 2 ($label): $ref has no migrations"; return; }
  new_db "bimcheck_$label"
  apply_all "bimcheck_$label" $files
  psql -q -v ON_ERROR_STOP=1 -d "bimcheck_$label" -f "$TESTS/seed_before_upgrade.sql" >/dev/null
  new=""
  for bf in $BRANCH_FILES; do
    [ -f "$dir/$(basename "$bf")" ] || new="$new $bf"
  done
  apply_all "bimcheck_$label" $new
  psql -q -v ON_ERROR_STOP=1 -d "bimcheck_$label" -f "$TESTS/survival.sql" >/dev/null
  check_state "bimcheck_$label"
  echo "OK 2: upgrade from $ref ($(echo $files | wc -w) applied) + new:$(for n in $new; do printf ' %s' "$(basename "$n")"; done)"
}
upgrade_from main "$MAIN_REF"
upgrade_from dev "$DEV_REF"

# ── 3. злиття гілки з main ───────────────────────────────────────────────────
main_dir=$WORK/$(echo "$MAIN_REF" | tr '/' '_')/$MIG
merged=$( { ls "$main_dir"/*.sql 2>/dev/null; echo "$BRANCH_FILES" | tr ' ' '\n'; } | awk -F/ '{n=$NF; if(!(n in s)){s[n]=$0}} END{for(n in s) print n "\t" s[n]}' | sort | cut -f2)
new_db bimcheck_merged
apply_all bimcheck_merged $merged
check_state bimcheck_merged
echo "OK 3: branch + $MAIN_REF applied together from scratch"
echo "ALL MIGRATION CHECKS PASSED"
