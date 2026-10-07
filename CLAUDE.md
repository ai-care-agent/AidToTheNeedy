# AI Care Agent: working rules

Voice AI assistant for seniors plus a family app. See `README.md` for the product, architecture and commands.

## Every task goes through the board

Repo: `ai-care-agent/AidToTheNeedy`. Board: https://github.com/orgs/ai-care-agent/projects/1. `gh` lives in `~/.local/bin`.

Ticket key **`AICARE-<n>`** is GitHub issue **#<n>**. It names the issue title, the branch, the commits and the PR.

1. **Ticket first.** When the user asks for new work, create a GitHub issue before writing code (issue templates in `.github/ISSUE_TEMPLATE/`) with an area label and P1/P2, then set its title to `AICARE-<n>: <title>` and add it to the board: `scripts/board.sh add <n>`. Small follow-ups to a task in progress go into that task's issue (scope or checklist) instead of a new issue.
2. **One branch per ticket, named exactly after it:** `AICARE-<n>`, created from main once the ticket is In progress.
3. **Say what was done and why.** Commit messages: first line `AICARE-<n>: <what was done>`, then a body that explains why. PR title `AICARE-<n>: <what was done>`; the description has `## What changed`, `## Why`, `## How it was checked` and `Refs #<n>`.
4. **Move the status as the work moves**, with `scripts/board.sh status <n> "<Status>"`:

   | Status | When |
   |---|---|
   | Backlog | Known, not planned |
   | Todo | Planned next |
   | In progress | Work started on branch `AICARE-<n>` |
   | In review | PR open; tests and typecheck green |
   | Testing | Merged by the user; checked on staging |
   | Deployed | Live in production; checked on the live site |
   | Done | Every "Done when" item is ticked and verified |

5. **Only the user merges into main**, by hand. After opening the PR and moving the ticket to In review, stop and hand the PR link to the user. Continue with Testing after the user has merged.
6. **Close only when it is really done:** the change is deployed and checked on the live instance and the issue's checklist is ticked. Close with `gh issue close <n> --comment '…'` saying what was verified and where. Tickets labelled `no-deploy` (docs, tooling) go from Testing to Done once merged.
7. Until a permanent deploy exists (AICARE-6), tasks stop at **Testing** with a note that they are not deployed yet. Do not mark them Deployed or Done.
8. PRs say `Refs #<n>` and never `Closes`/`Fixes`/`Resolves`, because merging must not close a ticket before it is tested and deployed.
9. **Keep the session log.** Claude's project memory holds `session-log.md` (outside the repo). After work, add or update today's `## <date> — <topic>` entry: what was done (tickets, PRs, decisions), where we stopped, what is next. A new session starts from it.
10. **Day summary at the end of the working day.** When the user ends the day ("заканчиваем", "на сегодня всё", "до завтра", "kończymy", "end of day"…), write in today's log entry a block starting with `**Day summary**`: 5–8 sentences on what we did today, what went well, what did not, your honest view of the progress, how we are moving towards launch and the first revenue, and our progress against the competitors and what we still lack compared to them. Give the same summary to the user.

## Public repo: what never goes in

- `docs/` (the business report with prices and margins) is gitignored on purpose. Never commit it.
- No secrets, API keys or `.env`. No prices, margins or partner names in issues, commits or PRs.
- Write issues and PRs in English.

## Access boundaries

- The `gh` token is a fine-grained token for the `ai-care-agent` org only. If an action is refused for missing permissions, ask the user to edit the token; never switch to the OAuth login or a classic token.
- The user is also a member of the unrelated GitHub org `Safqa-LLC`. Never read, change or act on anything in it.

## Hooks enforce these rules

`.claude/settings.json` runs `.claude/hooks/workflow-guard.sh` on every tool call, prompt, turn end and session start. A blocked step comes back with the reason; fix the cause, never work around the hook. Run checked steps as separate commands: the hook sees the state before a combined command runs. It blocks:

- editing repo files unless on branch `AICARE-<n>` with ticket #n open and In progress or In review (`docs/` is exempt);
- creating a branch with any other name, before the ticket is In progress, or a second branch for the same ticket;
- commits on any other branch, commits whose message is not `AICARE-<n>: …` plus a why-body, commits that touch `docs/`, `.env` files or contain secrets; pushes to main and local merges into main;
- new tickets without a P1/P2 label;
- PRs without the `AICARE-<n>: …` title, the What changed/Why sections or `Refs #<n>`, PRs with closing keywords, and PRs whose branch is not checked out, clean and green (`npm test`, `npm run typecheck`);
- any merge of a PR by Claude (CLI or API): the user merges;
- board moves out of order (In review needs an open PR, Testing a merged PR, Deployed comes from Testing, Done from Deployed or from Testing for `no-deploy`, with the checklist ticked) and any board change that bypasses `scripts/board.sh`;
- closing a ticket before it is done, without a comment, or through the API;
- anything that mentions Safqa-LLC, and GitHub logins other than the org's fine-grained token.

At the end of every turn the hook also checks the board (every open ticket is on it and titled `AICARE-<n>: …`, open PRs are In review, merged PRs are at least Testing) and the session log: if git work in the repo is newer than the log, the turn cannot end until the log is updated; after an end-of-day message it also cannot end until today's entry has a `**Day summary**` of at least 5 sentences. At session start it shows the active tickets and the last three log entries.
