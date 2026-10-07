#!/usr/bin/env bash
# Enforces the task workflow from CLAUDE.md. Called by the hooks in .claude/settings.json:
#   workflow-guard.sh pre-bash | pre-edit | stop | prompt | session-start
# PreToolUse modes block with exit code 2 and the reason on stderr.
set -uo pipefail

MODE="${1:-}"
INPUT="$(cat)"
OWNER=ai-care-agent
NAME=AidToTheNeedy
REPO="$OWNER/$NAME"
PROJECT_NUMBER=1
ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
GH="$(command -v gh || echo "$HOME/.local/bin/gh")"
CACHE="${TMPDIR:-/tmp}/aidtotheneedy-guard"
mkdir -p "$CACHE"

deny() { printf 'Blocked by the task workflow (CLAUDE.md): %s\n' "$1" >&2; exit 2; }
field() { jq -r "$1 // empty" <<<"$INPUT"; }
branch() { git -C "$ROOT" branch --show-current 2>/dev/null; }
task_of() { [[ "$1" =~ ^task/([0-9]+)- ]] && echo "${BASH_REMATCH[1]}"; }

# "state|status|labels|unticked" for an issue, cached for 60 s.
issue_info() {
  local n="$1" f="$CACHE/issue-$1"
  if [[ -f "$f" && $(( $(date +%s) - $(stat -c %Y "$f") )) -lt 60 ]]; then cat "$f"; return; fi
  "$GH" api graphql -F n="$n" -f query='query($n:Int!){repository(owner:"'"$OWNER"'",name:"'"$NAME"'"){issue(number:$n){
      state body labels(first:20){nodes{name}}
      projectItems(first:10){nodes{project{number} fieldValueByName(name:"Status"){... on ProjectV2ItemFieldSingleSelectValue{name}}}}}}}' \
    --jq '.data.repository.issue | if . == null then "MISSING|||0" else
      "\(.state)|\([.projectItems.nodes[] | select(.project.number=='"$PROJECT_NUMBER"') | .fieldValueByName.name // "none"][0] // "off-board")|\([.labels.nodes[].name] | join(","))|\(.body | [scan("- \\[ \\]")] | length)" end' \
    2>/dev/null > "$f.tmp"
  if [[ -s "$f.tmp" ]]; then mv "$f.tmp" "$f"; cat "$f"; else rm -f "$f.tmp"; fi
}
forget() { rm -f "$CACHE/issue-$1"; }
info_part() { cut -d'|' -f"$2" <<<"$1"; }

# PRs whose head branch is task/<n>-*: lines "number state"
prs_of() {
  "$GH" pr list -R "$REPO" --state all --limit 100 --json number,state,headRefName \
    --jq ".[] | select(.headRefName | test(\"^task/$1-\")) | \"\(.number) \(.state)\"" 2>/dev/null
}

require_open_task() {
  local n="$1" info state
  info="$(issue_info "$n")"
  [[ -z "$info" ]] && deny "could not read issue #$n from GitHub (network or token?). Retry; do not work around the check."
  state="$(info_part "$info" 1)"
  [[ "$state" == MISSING ]] && deny "issue #$n does not exist. Create the ticket first."
  [[ "$state" != OPEN ]] && deny "issue #$n is $state. Open a new ticket for new work."
  echo "$info"
}

closing_keywords='(close[sd]?|fix(e[sd])?|resolve[sd]?)[[:space:]]*:?[[:space:]]*#[0-9]+'

check_changes_safe() {
  local files secrets
  files="$( { git -C "$ROOT" diff --cached --name-only; git -C "$ROOT" diff HEAD --name-only; git -C "$ROOT" ls-files -o --exclude-standard; } 2>/dev/null | sort -u)"
  if grep -Eq '^docs/' <<<"$files"; then deny "docs/ (the business report) must never be committed to the public repo."; fi
  if grep -Eq '(^|/)\.env(\.[^/]*)?$' <<<"$(grep -v '\.env\.example$' <<<"$files")"; then deny ".env files must never be committed."; fi
  secrets="$( { git -C "$ROOT" diff --cached; git -C "$ROOT" diff HEAD; git -C "$ROOT" ls-files -o --exclude-standard -z | xargs -0 -r cat -- 2>/dev/null; } 2>/dev/null \
    | grep -E '^\+|^[^-]' | grep -Eo 'sk-ant-[A-Za-z0-9_-]{20,}|github_pat_[A-Za-z0-9_]{20,}|gh[opsu]_[A-Za-z0-9]{30,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----' | head -1)"
  [[ -n "$secrets" ]] && deny "the change contains something that looks like a secret (${secrets:0:12}…). Remove it."
  return 0
}

pre_bash() {
  local cmd b n info status target st prs
  cmd="$(field .tool_input.command)"
  [[ -z "$cmd" ]] && exit 0
  b="$(branch)"; n="$(task_of "$b")"

  # Access boundaries
  if grep -qi 'safqa' <<<"$cmd"; then deny "the Safqa-LLC organization is a separate project. Never act on it."; fi
  if grep -Eq '\bgh\b.*\bauth\b.*\b(login|refresh)\b' <<<"$cmd" && ! grep -q -- '--with-token' <<<"$cmd"; then
    deny "use only the fine-grained token for the ai-care-agent org (gh auth login --with-token, run by the user). OAuth logins reach Safqa-LLC."
  fi

  # The board changes only through scripts/board.sh, which this hook checks.
  if grep -Eq '\bgh\b.*\bproject\b.*\bitem-(edit|delete|archive)\b|updateProjectV2ItemFieldValue|deleteProjectV2Item' <<<"$cmd"; then
    deny "change board statuses only with scripts/board.sh."
  fi
  if grep -Eq '\bgh\b.*\bapi\b.*issues/[0-9]+' <<<"$cmd" && grep -Eq 'state[^a-z]*=?[^a-z]*closed' <<<"$cmd"; then
    deny "close issues with 'gh issue close' so the definition of done is checked."
  fi

  # Git: no work directly on main, commits belong to a ticket and never carry secrets.
  if grep -Eq '(^|[;&|(]|[[:space:]])git([[:space:]]+-C[[:space:]]+[^[:space:]]+)?[[:space:]]+commit\b' <<<"$cmd"; then
    [[ -z "$n" ]] && deny "commits happen only on a branch task/<issue>-<name>, never on '$b'. Create or pick the ticket, then: git switch -c task/<n>-<name>."
    require_open_task "$n" >/dev/null
    grep -q "#$n\b" <<<"$cmd" || deny "the commit message must reference the ticket: #$n."
    check_changes_safe
  fi
  if grep -Eq '(^|[;&|(]|[[:space:]])git([[:space:]]+-C[[:space:]]+[^[:space:]]+)?[[:space:]]+push\b' <<<"$cmd"; then
    if grep -Eq '\bpush\b.*([[:space:]:+]|^)main\b' <<<"$cmd" || [[ "$b" == main && ! "$cmd" =~ task/ ]]; then
      deny "never push to main. Push the task branch and merge through a PR."
    fi
  fi
  if [[ "$b" == main ]] && grep -Eq '(^|[;&|(]|[[:space:]])git[[:space:]]+(merge|cherry-pick|revert|reset[[:space:]]+--hard)\b' <<<"$cmd"; then
    deny "main changes only through merged PRs."
  fi

  # Issues: every ticket gets a priority.
  if grep -Eq '\bgh\b.*\bissue\b.*\bcreate\b' <<<"$cmd" && ! grep -Eq -- '--label[= ]+[^ ]*\bP[12]\b|-l[= ]+[^ ]*\bP[12]\b' <<<"$cmd"; then
    deny "give the new ticket a priority label (P1 or P2) and an area label."
  fi

  # PRs reference the ticket without closing it; closing happens after deploy.
  if grep -Eq '\bgh\b.*\bpr\b.*\bcreate\b' <<<"$cmd"; then
    target="$(grep -Eo -- '--head[= ]+[^ ]+' <<<"$cmd" | awk '{print $NF}' | sed 's/^--head=//')"
    [[ -n "$target" ]] || target="$b"
    n="$(task_of "$target")"
    [[ -z "$n" ]] && deny "PRs come only from task/<issue>-<name> branches."
    require_open_task "$n" >/dev/null
    grep -Eq "Refs #$n\b" <<<"$cmd" || deny "the PR description must contain 'Refs #$n'."
    grep -Eiq "$closing_keywords" <<<"$cmd" && deny "do not use Closes/Fixes/Resolves in PRs: merging would close the ticket before it is tested and deployed. Use 'Refs #$n'."
  fi

  # Merge only green, linked PRs from task branches.
  if grep -Eq '\bgh\b.*\bpr\b.*\bmerge\b' <<<"$cmd"; then
    local pr head body headsha out
    pr="$(grep -Eo '\bmerge[[:space:]]+[0-9]+' <<<"$cmd" | grep -Eo '[0-9]+')"
    read -r head headsha body < <("$GH" pr view ${pr:+"$pr"} -R "$REPO" --json headRefName,headRefOid,body --jq '"\(.headRefName) \(.headRefOid) \(.body | @base64)"' 2>/dev/null)
    [[ -z "${head:-}" ]] && deny "could not read the PR from GitHub."
    n="$(task_of "$head")"
    [[ -z "$n" ]] && deny "only PRs from task/<issue>-<name> branches can be merged."
    body="$(base64 -d <<<"$body")"
    grep -Eiq "$closing_keywords" <<<"$body" && deny "the PR description closes an issue on merge. Replace it with 'Refs #$n'."
    grep -Eq "Refs #$n\b" <<<"$body" || deny "the PR description must contain 'Refs #$n'."
    [[ "$b" == "$head" ]] || deny "check out $head locally before merging, so its tests can run."
    [[ "$(git -C "$ROOT" rev-parse HEAD)" == "$headsha" ]] || deny "local $head differs from the PR head. Push or pull first."
    [[ -z "$(git -C "$ROOT" status --porcelain)" ]] || deny "uncommitted changes on $head. Commit them or stash them first."
    out="$(cd "$ROOT" && npm test --silent 2>&1)" || deny "npm test fails, so the PR cannot be merged:
$(tail -n 30 <<<"$out")"
    out="$(cd "$ROOT" && npm run -s typecheck 2>&1)" || deny "npm run typecheck fails, so the PR cannot be merged:
$(tail -n 30 <<<"$out")"
  fi

  # Board transitions must follow the real state of the work.
  if grep -Eq 'board\.sh[[:space:]]+(status|add)[[:space:]]+[^0-9[:space:]]' <<<"$cmd"; then
    deny "call scripts/board.sh with a literal issue number, one ticket per call, so each move can be checked."
  fi
  if grep -Eq 'board\.sh[[:space:]]+(status|add)[[:space:]]+[0-9]+' <<<"$cmd"; then
    n="$(grep -Eo 'board\.sh[[:space:]]+(status|add)[[:space:]]+[0-9]+' <<<"$cmd" | grep -Eo '[0-9]+$')"
    target="$(sed -E 's/.*board\.sh[[:space:]]+(status|add)[[:space:]]+[0-9]+[[:space:]]*//; s/[;&|].*//; s/["'\'']//g; s/[[:space:]]+$//' <<<"$cmd")"
    [[ -z "$target" ]] && target=Todo
    forget "$n"
    info="$(issue_info "$n")"
    [[ -z "$info" || "$(info_part "$info" 1)" == MISSING ]] && deny "issue #$n not found."
    status="$(info_part "$info" 2)"
    prs="$(prs_of "$n")"
    case "$target" in
      "In review")
        grep -q ' OPEN$' <<<"$prs" || deny "#$n goes to In review only when a PR from task/$n-* is open." ;;
      Testing)
        grep -q ' MERGED$' <<<"$prs" || deny "#$n goes to Testing only after its PR is merged." ;;
      Deployed)
        [[ "$status" == Testing ]] || deny "#$n goes to Deployed only from Testing (now: $status). Test it on staging first."
        grep -qw no-deploy <<<"$(info_part "$info" 3)" && deny "#$n is no-deploy: move it from Testing straight to Done." ;;
      Done)
        st="$(info_part "$info" 4)"
        if grep -qw no-deploy <<<"$(info_part "$info" 3)"; then
          [[ "$status" == Testing || "$status" == Done ]] || deny "#$n (no-deploy) goes to Done only from Testing, after its PR is merged (now: $status)."
        else
          [[ "$status" == Deployed || "$status" == Done ]] || deny "#$n goes to Done only from Deployed (now: $status): it must be tested and live first."
        fi
        [[ "$st" == 0 ]] || deny "#$n still has $st unticked 'Done when' items. Verify them and tick them first." ;;
    esac
  fi

  if grep -Eq '\bgh\b.*\bissue\b.*\bclose\b' <<<"$cmd"; then
    n="$(grep -Eo '\bclose[[:space:]]+#?[0-9]+' <<<"$cmd" | grep -Eo '[0-9]+')"
    [[ -z "$n" ]] && deny "name the issue number explicitly: gh issue close <n>."
    forget "$n"
    info="$(issue_info "$n")"
    status="$(info_part "$info" 2)"
    if grep -qw no-deploy <<<"$(info_part "$info" 3)"; then
      [[ "$status" == Testing || "$status" == Done ]] || deny "#$n (no-deploy) closes only after its PR is merged and it is in Testing (now: $status)."
      grep -q ' MERGED$' <<<"$(prs_of "$n")" || deny "#$n has no merged PR."
    else
      [[ "$status" == Deployed || "$status" == Done ]] || deny "#$n closes only from Deployed (now: $status): tested on staging, live and verified."
    fi
    [[ "$(info_part "$info" 4)" == 0 ]] || deny "#$n still has unticked 'Done when' items."
    grep -q -- '--comment\|-c ' <<<"$cmd" || deny "close #$n with a comment that says what was verified and where: gh issue close $n --comment '…'."
  fi
  exit 0
}

pre_edit() {
  local f b n info status rel
  f="$(field '.tool_input.file_path // .tool_input.notebook_path')"
  [[ -z "$f" ]] && exit 0
  f="$(realpath -m "$f")"
  case "$f" in "$ROOT"/*) ;; *) exit 0 ;; esac
  rel="${f#"$ROOT"/}"
  # The private business report and git internals are not tracked work.
  case "$rel" in docs/*|.git/*|node_modules/*|dist/*|data/*) exit 0 ;; esac
  b="$(branch)"; n="$(task_of "$b")"
  [[ -z "$n" ]] && deny "files in the repo change only on a task branch (now on '$b'). Create the ticket (gh issue create), add it to the board, then git switch -c task/<n>-<name>."
  info="$(require_open_task "$n")" || exit 2
  status="$(info_part "$info" 2)"
  [[ "$status" == "In progress" || "$status" == "In review" ]] || deny "#$n is '$status' on the board. Move it to In progress first: scripts/board.sh status $n \"In progress\"."
  exit 0
}

stop_check() {
  [[ "$(field .stop_hook_active)" == true ]] && exit 0
  local data problems
  data="$("$GH" api graphql -f query='{repository(owner:"'"$OWNER"'",name:"'"$NAME"'"){
      issues(states:OPEN,first:100){nodes{number labels(first:20){nodes{name}} projectItems(first:10){nodes{project{number} fieldValueByName(name:"Status"){... on ProjectV2ItemFieldSingleSelectValue{name}}}}}}
      pullRequests(last:40){nodes{number state headRefName}}}}' 2>/dev/null)" || exit 0
  problems="$(jq -r --argjson p "$PROJECT_NUMBER" '
    .data.repository as $r
    | ($r.issues.nodes | map({key: (.number|tostring), value: ([.projectItems.nodes[] | select(.project.number==$p) | .fieldValueByName.name // "none"][0] // "off-board")}) | from_entries) as $st
    | ( [$r.issues.nodes[] | select(([.projectItems.nodes[] | select(.project.number==$p)] | length) == 0) | "#\(.number) is not on the board: scripts/board.sh add \(.number)"]
      + [$r.pullRequests.nodes[] | (.headRefName | capture("^task/(?<n>[0-9]+)-")? | .n) as $n | select($st[$n] != null)
          | if .state == "OPEN" and $st[$n] != "In review" and $st[$n] != "In progress" then "#\($n) has open PR #\(.number) but is \($st[$n]) on the board"
            elif .state == "OPEN" and $st[$n] == "In progress" then "#\($n) has open PR #\(.number): move it to In review"
            elif .state == "MERGED" and ($st[$n] == "In progress" or $st[$n] == "In review" or $st[$n] == "Todo" or $st[$n] == "Backlog") then "#\($n): PR #\(.number) is merged but the ticket is \($st[$n]); move it to Testing"
            else empty end] )
    | unique | .[]' <<<"$data" 2>/dev/null)"
  if [[ -n "$problems" ]]; then
    jq -n --arg r "The board is out of date (CLAUDE.md workflow). Fix before finishing:
$problems" '{decision:"block", reason:$r}'
  fi
  exit 0
}

context_out() { jq -n --arg e "$1" --arg c "$2" '{hookSpecificOutput:{hookEventName:$e, additionalContext:$c}}'; }

prompt_ctx() {
  local b n
  b="$(branch)"; n="$(task_of "$b")"
  context_out UserPromptSubmit "Task workflow (enforced by hooks, see CLAUDE.md): if this message asks for new work, create a ticket first (gh issue create with area + P1/P2 labels, scripts/board.sh add <n>, branch task/<n>-<name>). Current branch: ${b:-?}${n:+ (ticket #$n)}."
  exit 0
}

session_ctx() {
  local items
  items="$("$GH" project item-list "$PROJECT_NUMBER" --owner "$OWNER" --limit 200 --format json \
    --jq '.items[] | select(.status != "Done" and .status != "Backlog") | "#\(.content.number) [\(.status)] \(.content.title)"' 2>/dev/null | sort -t'#' -k2 -n)"
  context_out SessionStart "This project follows the task workflow in CLAUDE.md; hooks block steps that break it. Board ${OWNER} project ${PROJECT_NUMBER} — active tickets:
${items:-(could not read the board)}
Current branch: $(branch)."
  exit 0
}

case "$MODE" in
  pre-bash) pre_bash ;;
  pre-edit) pre_edit ;;
  stop) stop_check ;;
  prompt) prompt_ctx ;;
  session-start) session_ctx ;;
  *) exit 0 ;;
esac
