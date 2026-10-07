#!/usr/bin/env bash
# Task board helper for the "AI Care Agent" GitHub Project (ai-care-agent org, project 1).
#   scripts/board.sh add <issue>              add an issue to the board (status Todo)
#   scripts/board.sh status <issue> <Status>  Backlog | Todo | In progress | In review | Testing | Deployed | Done
#   scripts/board.sh show                     list board items with their status
set -euo pipefail

OWNER=ai-care-agent
REPO=ai-care-agent/AidToTheNeedy
PROJECT_NUMBER=1
PROJECT_ID=PVT_kwDOFDnLCc4BmHrJ
STATUS_FIELD=PVTSSF_lADOFDnLCc4BmHrJzhkx7eQ

option_id() {
  case "$1" in
    Backlog) echo a8e335ae ;;
    Todo) echo 6823f637 ;;
    "In progress") echo fc0b7a25 ;;
    "In review") echo 1d38e60a ;;
    Testing) echo a809f4cd ;;
    Deployed) echo a976bdcb ;;
    Done) echo aeca5142 ;;
    *) echo "Unknown status: $1" >&2; exit 1 ;;
  esac
}

# Adding an item that is already on the board returns the existing item, so this doubles as a lookup.
item_id() {
  gh project item-add "$PROJECT_NUMBER" --owner "$OWNER" --url "https://github.com/$REPO/issues/$1" --format json --jq .id
}

set_status() {
  gh project item-edit --project-id "$PROJECT_ID" --id "$(item_id "$1")" \
    --field-id "$STATUS_FIELD" --single-select-option-id "$(option_id "$2")" > /dev/null
  echo "#$1 → $2"
}

case "${1:-}" in
  add) set_status "$2" "${3:-Todo}" ;;
  status) set_status "$2" "$3" ;;
  show) gh project item-list "$PROJECT_NUMBER" --owner "$OWNER" --limit 200 --format json \
          --jq '.items[] | "#\(.content.number)\t\(.status // "-")\t\(.content.title)"' | sort -t'#' -k2 -n ;;
  *) sed -n '2,6p' "$0"; exit 1 ;;
esac
