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
   | In review | PR open; its description says `Closes #<n>` |
   | Testing | Merged; checked on staging |
   | Deployed | Live in production; checked on the live site |
   | Done | Every "Done when" item is ticked and verified |

3. **Close only when it is really done:** `npm test` and `npm run typecheck` pass, the change is deployed and checked on the live instance, and the issue's checklist is ticked. Write in the closing comment what was verified and where. Changes without runtime effect (docs, tooling) are done once merged.
4. Until a permanent deploy exists (issue #6), tasks stop at **Testing** with a note that they are not deployed yet. Do not mark them Deployed or Done.
5. Commits and PRs reference the issue (`#<n>` in the message, `Closes #<n>` in the PR). Merge with `gh pr merge --squash --delete-branch`.

## Public repo: what never goes in

- `docs/` (the business report with prices and margins) is gitignored on purpose. Never commit it.
- No secrets, API keys or `.env`. No prices, margins or partner names in issues, commits or PRs.
- Write issues and PRs in English.

## Access boundaries

- The `gh` token is a fine-grained token for the `ai-care-agent` org only. If an action is refused for missing permissions, ask the user to edit the token; never switch to the OAuth login or a classic token.
- The user is also a member of the unrelated GitHub org `Safqa-LLC`. Never read, change or act on anything in it.
