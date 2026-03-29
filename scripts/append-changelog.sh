#!/usr/bin/env bash
# Appends a block of commits to CHANGELOG.md. Used by GitHub Actions on push to main.
# Skips commits that only touch ignored doc paths (CHANGELOG / READMEs).
set -euo pipefail

CHANGELOG="${CHANGELOG_FILE:-CHANGELOG.md}"
BEFORE="${BEFORE_SHA:-}"
AFTER="${AFTER_SHA:-}"

is_ignored_path() {
  local f="$1"
  case "$f" in
    CHANGELOG.md|README.md|Readme.md|README4.md) return 0 ;;
    */CHANGELOG.md|*/README.md|*/Readme.md|*/README4.md) return 0 ;;
    *) return 1 ;;
  esac
}

commit_touches_non_ignored() {
  local sha="$1"
  local f
  while IFS= read -r f; do
    [ -z "$f" ] && continue
    if ! is_ignored_path "$f"; then
      return 0
    fi
  done < <(git diff-tree --no-commit-id --name-only -r "$sha" 2>/dev/null || true)
  return 1
}

if [ -z "$AFTER" ]; then
  echo "AFTER_SHA empty; skip"
  exit 0
fi

if [ -z "$BEFORE" ] || [ "$BEFORE" = "0000000000000000000000000000000000000000" ]; then
  PARENT=$(git rev-parse "${AFTER}^" 2>/dev/null || true)
  if [ -n "$PARENT" ]; then
    BEFORE="$PARENT"
  else
    BEFORE=""
  fi
fi

tmp=$(mktemp)
trap 'rm -f "$tmp"' EXIT
any=0

if [ -n "$BEFORE" ]; then
  mapfile -t lines < <(git log --no-merges "${BEFORE}..${AFTER}" --pretty=format:'%H'$'\t''%s'$'\t''%cI'$'\t''%aN')
else
  mapfile -t lines < <(git log -1 --no-merges "$AFTER" --pretty=format:'%H'$'\t''%s'$'\t''%cI'$'\t''%aN')
fi

for line in "${lines[@]}"; do
  [ -z "$line" ] && continue
  IFS=$'\t' read -r sha msg dateiso author <<<"$line"
  [ -z "${sha:-}" ] && continue
  if ! commit_touches_non_ignored "$sha"; then
    continue
  fi
  any=1
  msg_safe="${msg//\`/'\`'}"
  printf -- '- \`%.7s\` **%s** (%s) — %s\n' "$sha" "$author" "$dateiso" "$msg_safe" >>"$tmp"
done

if [ "$any" -eq 0 ]; then
  echo "No relevant commits for changelog"
  exit 0
fi

ts=$(date -u +"%Y-%m-%d %H:%M:%S UTC")
{
  printf '\n### %s (push `%s`)\n\n' "$ts" "$AFTER"
  cat "$tmp"
  printf '\n'
} >>"$CHANGELOG"

echo "Updated $CHANGELOG"
