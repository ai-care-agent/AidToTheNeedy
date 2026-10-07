# AI Care Agent: working rules

Voice AI assistant for seniors plus a family app. See `README.md` for the product, architecture and commands.

## Every task goes through the board

Repo: `ai-care-agent/AidToTheNeedy`. Board: https://github.com/orgs/ai-care-agent/projects/1. `gh` lives in `~/.local/bin`.

1. **Ticket first.** When the user asks for new work, create a GitHub issue before writing code (issue templates in `.github/ISSUE_TEMPLATE/`), with labels for area and priority, and add it to the board: `scripts/board.sh add <n>`. Small follow-ups to a task in progress go into that task's issue as a comment or checklist item instead of a new issue.
2. **Move the status as the work moves**, with `scripts/board.sh status <n> "<Status>"`:

   | Status | When |
   |---|---|
   | Backlog | Known, not planned |
   | Todo | Planned next |
   | In progress | Work started on branch `task/<n>-<short-name>` |
   | In review | PR open; its description says `Refs #<n>` |
   | Testing | Merged; checked on staging |
   | Deployed | Live in production; checked on the live site |
   | Done | Every "Done when" item is ticked and verified |

3. **Close only when it is really done:** `npm test` and `npm run typecheck` pass, the change is deployed and checked on the live instance, and the issue's checklist is ticked. Close with `gh issue close <n> --comment '…'` saying what was verified and where. Tickets labelled `no-deploy` (docs, tooling) go from Testing to Done once merged.
4. Until a permanent deploy exists (issue #6), tasks stop at **Testing** with a note that they are not deployed yet. Do not mark them Deployed or Done.
5. Commits reference the ticket (`#<n>` in the message). PRs say `Refs #<n>` and never `Closes`/`Fixes`/`Resolves`, because merging must not close a ticket before it is tested and deployed. Merge with `gh pr merge <pr> --squash --delete-branch` while the PR branch is checked out.

## Hooks enforce these rules

`.claude/settings.json` runs `.claude/hooks/workflow-guard.sh` on every tool call, prompt, turn end and session start. A blocked step comes back with the reason; fix the cause, never work around the hook. It blocks:

- editing repo files unless on `task/<n>-*` with ticket #n open and In progress or In review (`docs/` is exempt);
- commits on any other branch, commits without `#<n>`, commits that touch `docs/`, `.env` files or contain secrets; pushes to main and local merges into main;
- new tickets without a P1/P2 label; PRs without `Refs #<n>` or with closing keywords;
- merges unless the PR branch is checked out, pushed, clean, and `npm test` and `npm run typecheck` pass;
- board moves out of order (In review needs an open PR, Testing a merged PR, Deployed comes from Testing, Done from Deployed or from Testing for `no-deploy`, with the checklist ticked) and any board change that bypasses `scripts/board.sh`;
- closing a ticket before it is done, without a comment, or through the API;
- anything that mentions Safqa-LLC, and GitHub logins other than the org's fine-grained token.

At the end of every turn the hook also checks the board: every open ticket is on it, open PRs are In review, merged PRs are at least Testing.

## Public repo: what never goes in

- `docs/` (the business report with prices and margins) is gitignored on purpose. Never commit it.
- No secrets, API keys or `.env`. No prices, margins or partner names in issues, commits or PRs.
- Write issues and PRs in English.

## Access boundaries

- The `gh` token is a fine-grained token for the `ai-care-agent` org only. If an action is refused for missing permissions, ask the user to edit the token; never switch to the OAuth login or a classic token.
- The user is also a member of the unrelated GitHub org `Safqa-LLC`. Never read, change or act on anything in it.
