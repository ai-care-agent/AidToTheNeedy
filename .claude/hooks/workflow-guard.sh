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
# Claude's project memory (outside the repo); the session log lives there.
SESSION_LOG="$HOME/.claude/projects/$(sed 's#[^A-Za-z0-9]#-#g' <<<"$ROOT")/memory/session-log.md"
mkdir -p "$CACHE"

deny() { printf 'Blocked by the task workflow (CLAUDE.md): %s\n' "$1" >&2; exit 2; }
field() { jq -r "$1 // empty" <<<"$INPUT"; }
branch() { git -C "$ROOT" branch --show-current 2>/dev/null; }
# Ticket key AICARE-<n> = GitHub issue #<n>; the branch for a ticket is named exactly AICARE-<n>.
task_of() { [[ "$1" =~ ^AICARE-([0-9]+)$ ]] && echo "${BASH_REMATCH[1]}"; }

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
  # A missing issue comes back as a GraphQL error document instead of the formatted line.
  if grep -q NOT_FOUND "$f.tmp" 2>/dev/null; then echo "MISSING|||0" > "$f.tmp"; fi
  if grep -Eq '^(OPEN|CLOSED|MISSING)\|' "$f.tmp" 2>/dev/null; then
    cat "$f.tmp"
    # Right after board.sh adds an item GitHub may still report it as off the board; never cache that.
    if grep -q '|off-board|' "$f.tmp"; then rm -f "$f.tmp"; else mv "$f.tmp" "$f"; fi
  else rm -f "$f.tmp"; fi
}
forget() { rm -f "$CACHE/issue-$1"; }
info_part() { cut -d'|' -f"$2" <<<"$1"; }

# Before blocking on a board status, read it fresh from GitHub, retrying while it catches up.
# Prints the info line whose status matches the regex, or the last one read.
fresh_info_matching() {
  local n="$1" want="$2" info try
  for try in 1 2 3 4; do
    forget "$n"
    info="$(issue_info "$n")"
    [[ "$(info_part "$info" 2)" =~ ^($want)$ ]] && break
    [[ $try -lt 4 ]] && sleep 2
  done
  echo "$info"
}

# PRs whose head branch is AICARE-<n>: lines "number state"
prs_of() {
  "$GH" pr list -R "$REPO" --state all --limit 100 --json number,state,headRefName \
    --jq ".[] | select(.headRefName | test(\"^AICARE-$1$\")) | \"\(.number) \(.state)\"" 2>/dev/null
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

# Commit message = "AICARE-<n>: <what was done>" on the first line, then a body that says why.
check_commit_message() {
  local n="$1" msg subject why
  grep -Eq -- '--no-edit' <<<"$cmd" && return 0
  msg="$(perl -0777 -ne 'if (/<<-?\s*([\x27"]?)(\w+)\1[^\n]*\n(.*?)^\s*\2\s*$/ms) { print $3 } else { while (/(?:^|\s)-m\s*(?:"((?:[^"\\]|\\.)*)"|\x27([^\x27]*)\x27|(\S+))/g) { print(($1 // $2 // $3), "\n\n") } }' <<<"$cmd")"
  subject="$(head -n 1 <<<"$msg")"
  [[ "$subject" =~ ^AICARE-$n:\ .{10,}$ ]] || deny "the commit message must start with 'AICARE-$n: <what was done>' (got: '${subject:0:60}')."
  why="$(tail -n +2 <<<"$msg" | grep -Ev '^[[:space:]]*$|^(Co-Authored-By|Signed-off-by):' | head -1)"
  [[ -n "$why" ]] || deny "the commit message needs a body below the first line that says why the change was made."
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
  # The command with heredoc bodies and quoted text removed, so words inside a ticket
  # or PR body are not mistaken for commands. Content checks still read $cmd.
  code="$(perl -0777 -pe 's/<<-?\s*([\x27"]?)(\w+)\1([^\n]*)\n.*?^\s*\2\s*$/$3/gms; s/\x27[^\x27]*\x27//g; s/"(?:[^"\\]|\\.)*"//g' <<<"$cmd")"
  b="$(branch)"; n="$(task_of "$b")"

  # Access boundaries
  if grep -qi 'safqa' <<<"$cmd"; then deny "the Safqa-LLC organization is a separate project. Never act on it."; fi
  if grep -Eq '\bgh\b.*\bauth\b.*\b(login|refresh)\b' <<<"$code" && ! grep -q -- '--with-token' <<<"$cmd"; then
    deny "use only the fine-grained token for the ai-care-agent org (gh auth login --with-token, run by the user). OAuth logins reach Safqa-LLC."
  fi

  # The board changes only through scripts/board.sh, which this hook checks.
  if grep -Eq '\bgh\b.*\bproject\b.*\bitem-(edit|delete|archive)\b|updateProjectV2ItemFieldValue|deleteProjectV2Item' <<<"$code"; then
    deny "change board statuses only with scripts/board.sh."
  fi
  if grep -Eq '\bgh\b.*\bapi\b.*issues/[0-9]+' <<<"$code" && grep -Eq 'state[^a-z]*=?[^a-z]*closed' <<<"$cmd"; then
    deny "close issues with 'gh issue close' so the definition of done is checked."
  fi

  # Git: no work directly on main, commits belong to a ticket and never carry secrets.
  if grep -Eq '(^|[;&|(]|[[:space:]])git([[:space:]]+-C[[:space:]]+[^[:space:]]+)?[[:space:]]+commit\b' <<<"$code"; then
    [[ -z "$n" ]] && deny "commits happen only on the ticket's branch AICARE-<n>, never on '$b'. Create or pick the ticket, then: git switch -c AICARE-<n>."
    require_open_task "$n" >/dev/null
    check_commit_message "$n"
    check_changes_safe
  fi
  if grep -Eq '(^|[;&|(]|[[:space:]])git([[:space:]]+-C[[:space:]]+[^[:space:]]+)?[[:space:]]+push\b' <<<"$code"; then
    if grep -Eq '\bpush\b.*([[:space:]:+]|^)main\b' <<<"$code" || [[ "$b" == main && ! "$cmd" =~ AICARE- ]]; then
      deny "never push to main. Push the task branch and merge through a PR."
    fi
  fi
  if [[ "$b" == main ]] && grep -Eq '(^|[;&|(]|[[:space:]])git[[:space:]]+(merge|cherry-pick|revert|reset[[:space:]]+--hard)\b' <<<"$code"; then
    deny "main changes only through merged PRs."
  fi

  # One branch per ticket, named after it, created once the ticket is In progress.
  local newb
  newb="$(grep -Eo '\bgit([[:space:]]+-C[[:space:]]+[^[:space:]]+)?[[:space:]]+(switch[[:space:]]+(-c|-C|--create|--force-create)|checkout[[:space:]]+(-b|-B)|branch|worktree[[:space:]]+add[[:space:]]+(-b|-B))[[:space:]]+[^-[:space:]][^[:space:]]*' <<<"$code" | awk '{print $NF}' | head -1)"
  if [[ -n "$newb" ]]; then
    local bn other
    bn="$(task_of "$newb")"
    [[ -n "$bn" ]] || deny "a ticket's branch is named exactly after it: AICARE-<n> (got '$newb')."
    info="$(require_open_task "$bn")" || exit 2
    [[ "$(info_part "$info" 2)" == "In progress" ]] || info="$(fresh_info_matching "$bn" "In progress")"
    [[ "$(info_part "$info" 2)" == "In progress" ]] || deny "move #$bn to In progress before creating its branch: scripts/board.sh status $bn \"In progress\"."
    other="$(git -C "$ROOT" for-each-ref --format='%(refname:short)' "refs/heads/AICARE-$bn" "refs/remotes/origin/AICARE-$bn" | head -1)"
    [[ -z "$other" ]] || deny "ticket AICARE-$bn already has its branch ($other). One branch per ticket: git switch AICARE-$bn."
  fi

  # Issues: every ticket gets a priority.
  if grep -Eq '\bgh\b.*\bissue\b.*\bcreate\b' <<<"$code" && ! grep -Eq -- '--label[= ]+[^ ]*\bP[12]\b|-l[= ]+[^ ]*\bP[12]\b' <<<"$cmd"; then
    deny "give the new ticket a priority label (P1 or P2) and an area label."
  fi

  # PRs reference the ticket without closing it; closing happens after deploy.
  if grep -Eq '\bgh\b.*\bpr\b.*\bcreate\b' <<<"$code"; then
    target="$(grep -Eo -- '--head[= ]+[^ ]+' <<<"$cmd" | awk '{print $NF}' | sed 's/^--head=//')"
    [[ -n "$target" ]] || target="$b"
    n="$(task_of "$target")"
    [[ -z "$n" ]] && deny "PRs come only from ticket branches AICARE-<n>."
    require_open_task "$n" >/dev/null
    grep -Eq -- "--title[= ]+[\"']?AICARE-$n: .{10,}" <<<"$cmd" || deny "the PR title must be 'AICARE-$n: <what was done>' (it becomes the commit message on main)."
    grep -q '## What changed' <<<"$cmd" && grep -q '## Why' <<<"$cmd" || deny "the PR description needs the sections '## What changed' and '## Why' (what was done and what for)."
    grep -Eq "Refs #$n\b" <<<"$cmd" || deny "the PR description must contain 'Refs #$n'."
    grep -Eiq "$closing_keywords" <<<"$cmd" && deny "do not use Closes/Fixes/Resolves in PRs: merging would close the ticket before it is tested and deployed. Use 'Refs #$n'."
    [[ "$b" == "$target" ]] || deny "check out $target locally before opening its PR, so its tests can run."
    [[ -z "$(git -C "$ROOT" status --porcelain)" ]] || deny "uncommitted changes on $target. Commit them before opening the PR."
    local out
    out="$(cd "$ROOT" && npm test --silent 2>&1)" || deny "npm test fails; fix it before opening the PR:
$(tail -n 30 <<<"$out")"
    out="$(cd "$ROOT" && npm run -s typecheck 2>&1)" || deny "npm run typecheck fails; fix it before opening the PR:
$(tail -n 30 <<<"$out")"
  fi

  # Only the user merges into main, by hand.
  if grep -Eq '\bgh\b.*\bpr\b.*\bmerge\b|pulls/[0-9]+/merge|mergePullRequest|enablePullRequestAutoMerge' <<<"$code"; then
    deny "merging into main is done by the user manually. Hand over the PR link and wait; after the merge, move the ticket to Testing."
  fi

  # Board transitions must follow the real state of the work.
  if grep -Eq 'board\.sh[[:space:]]+(status|add)[[:space:]]+[^0-9[:space:]]' <<<"$code"; then
    deny "call scripts/board.sh with a literal issue number, one ticket per call, so each move can be checked."
  fi
  if grep -Eq 'board\.sh[[:space:]]+(status|add)[[:space:]]+[0-9]+' <<<"$code"; then
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
        grep -q ' OPEN$' <<<"$prs" || deny "#$n goes to In review only when a PR from branch AICARE-$n is open." ;;
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
    # The status read above is the one before this move; do not let later checks reuse it.
    forget "$n"
  fi

  if grep -Eq '\bgh\b.*\bissue\b.*\bclose\b' <<<"$code"; then
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
  [[ -z "$n" ]] && deny "files in the repo change only on a task branch (now on '$b'). Create the ticket (gh issue create, title AICARE-<n>: …), add it to the board, then git switch -c AICARE-<n>."
  info="$(require_open_task "$n")" || exit 2
  status="$(info_part "$info" 2)"
  if [[ "$status" != "In progress" && "$status" != "In review" ]]; then
    status="$(info_part "$(fresh_info_matching "$n" "In progress|In review")" 2)"
  fi
  [[ "$status" == "In progress" || "$status" == "In review" ]] || deny "#$n is '$status' on the board. Move it to In progress first: scripts/board.sh status $n \"In progress\"."
  exit 0
}

DAY_SUMMARY_RULE="End of the working day: add to today's '## $(date +%F) …' entry in $SESSION_LOG a block that starts with '**Day summary**' — 5 to 8 sentences: what we did today, what went well, what did not, your honest view of the progress, how we are moving towards launch and the first revenue, and our progress against the competitors and what we still lack compared to them. Give the same summary to the user in your reply."

# Sentences in the '**Day summary**' block of today's log entry (0 if there is none).
day_summary_sentences() {
  perl -CSD -0777 -ne '
    my $d = shift @ARGV // "";
    my ($sec) = /^## \Q$d\E[^\n]*\n(.*?)(?=^## |\z)/ms or do { print 0; exit };
    my ($sum) = $sec =~ /\*\*Day summary\*\*(.*?)(?=\n\s*\n\*\*|\z)/s or do { print 0; exit };
    my $n = () = $sum =~ /[.!?](?=\s|$)/g; print $n;
  ' "$SESSION_LOG" "$(date +%F)" 2>/dev/null || echo 0
}

stop_check() {
  [[ "$(field .stop_hook_active)" == true ]] && exit 0
  local data problems log_problem="" last_git last_log
  # Session log: any git activity (commit, branch switch, pull, fetch) newer than the last
  # log entry means the work of this session is not recorded yet.
  last_git="$(find "$ROOT/.git/logs" -type f -printf '%T@\n' 2>/dev/null | sort -n | tail -1 | cut -d. -f1)"
  last_log="$(stat -c %Y "$SESSION_LOG" 2>/dev/null || echo 0)"
  if [[ "${last_git:-0}" -gt "$last_log" ]]; then
    log_problem="The session log is older than the latest git work. Add to $SESSION_LOG an entry for today: what was done (tickets, PRs, decisions), where we stopped, what is next."
  fi
  # End of the working day (flagged by the prompt hook): today's entry needs the day summary.
  if [[ -f "$CACHE/eod-$(date +%F)" ]] && [[ "$(day_summary_sentences)" -lt 5 ]]; then
    log_problem="${log_problem:+$log_problem
}$DAY_SUMMARY_RULE"
  fi
  data="$("$GH" api graphql -f query='{repository(owner:"'"$OWNER"'",name:"'"$NAME"'"){
      issues(states:OPEN,first:100){nodes{number title labels(first:20){nodes{name}} projectItems(first:10){nodes{project{number} fieldValueByName(name:"Status"){... on ProjectV2ItemFieldSingleSelectValue{name}}}}}}
      pullRequests(last:40){nodes{number state headRefName}}}}' 2>/dev/null)" || data=""
  [[ -n "$data" ]] && problems="$(jq -r --argjson p "$PROJECT_NUMBER" '
    .data.repository as $r
    | ($r.issues.nodes | map({key: (.number|tostring), value: ([.projectItems.nodes[] | select(.project.number==$p) | .fieldValueByName.name // "none"][0] // "off-board")}) | from_entries) as $st
    | ( [$r.issues.nodes[] | select(([.projectItems.nodes[] | select(.project.number==$p)] | length) == 0) | "#\(.number) is not on the board: scripts/board.sh add \(.number)"]
      + [$r.issues.nodes[] | select(.title | startswith("AICARE-\(.number): ") | not) | "#\(.number) title must start with AICARE-\(.number): (gh issue edit \(.number) --title ...)"]
      + [$r.pullRequests.nodes[] | (.headRefName | capture("^AICARE-(?<n>[0-9]+)$")? | .n) as $n | select($st[$n] != null)
          | if .state == "OPEN" and $st[$n] != "In review" and $st[$n] != "In progress" then "#\($n) has open PR #\(.number) but is \($st[$n]) on the board"
            elif .state == "OPEN" and $st[$n] == "In progress" then "#\($n) has open PR #\(.number): move it to In review"
            elif .state == "MERGED" and ($st[$n] == "In progress" or $st[$n] == "In review" or $st[$n] == "Todo" or $st[$n] == "Backlog") then "#\($n): PR #\(.number) is merged but the ticket is \($st[$n]); move it to Testing"
            else empty end] )
    | unique | .[]' <<<"$data" 2>/dev/null)"
  problems="$(printf '%s\n%s' "${problems:-}" "$log_problem" | sed '/^$/d')"
  if [[ -n "$problems" ]]; then
    jq -n --arg r "Before finishing (CLAUDE.md workflow), fix:
$problems" '{decision:"block", reason:$r}'
  fi
  exit 0
}

context_out() { jq -n --arg e "$1" --arg c "$2" '{hookSpecificOutput:{hookEventName:$e, additionalContext:$c}}'; }

TEAM_TONE="Tone: we are one team. Talk with the user as a good friend and teammate (in Russian on \"ты\"), warm and direct; we both really want to build a great product that works and succeeds. Friends are honest: say plainly when something is weak or risky and suggest the better path."

prompt_ctx() {
  local b n eod=""
  b="$(branch)"; n="$(task_of "$b")"
  # The user ends the working day (Russian, Polish or English): the day summary becomes mandatory.
  if field .prompt | perl -CSD -Mutf8 -ne 'BEGIN{$f=1} $f=0 if /заканчиваем|закругляемся|закончим|на сегодня (вс[её]|хватит|закончим)|до завтра|конец (рабочего )?дня|kończymy|na dziś (wszystko|koniec)|do jutra|end of (the )?day|done for (the )?day|that.?s all for today/i; END{exit $f}'; then
    touch "$CACHE/eod-$(date +%F)"
    eod=" END OF DAY: $DAY_SUMMARY_RULE"
  fi
  context_out UserPromptSubmit "Task workflow (enforced by hooks, see CLAUDE.md): if this message asks for new work, create a ticket first (gh issue create with area + P1/P2 labels, then title AICARE-<n>: …, scripts/board.sh add <n>, branch AICARE-<n>; commits and PRs say what was done and why). Current branch: ${b:-?}${n:+ (ticket #$n)}. $TEAM_TONE$eod"
  exit 0
}

session_ctx() {
  local items
  items="$("$GH" project item-list "$PROJECT_NUMBER" --owner "$OWNER" --limit 200 --format json \
    --jq '.items[] | select(.status != "Done" and .status != "Backlog") | "#\(.content.number) [\(.status)] \(.content.title)"' 2>/dev/null | sort -t'#' -k2 -n)"
  context_out SessionStart "$TEAM_TONE
This project follows the task workflow in CLAUDE.md; hooks block steps that break it. Board ${OWNER} project ${PROJECT_NUMBER} — active tickets:
${items:-(could not read the board)}
Current branch: $(branch).

Latest entries of the session log ($SESSION_LOG) — what we did before and where we stopped:
$(awk '/^## /{n++} {lines[NR]=$0; sec[NR]=n} END{for(i=1;i<=NR;i++) if (sec[i] > 0 && sec[i] > n-3) print lines[i]}' "$SESSION_LOG" 2>/dev/null || echo '(no session log yet)')"
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
