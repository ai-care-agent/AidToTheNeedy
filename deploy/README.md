# Deploying AI Care Agent

Production and staging run the same way on any Linux server: one Docker image behind Caddy, which
gets the HTTPS certificate by itself. Only the step that creates the servers depends on the provider.
Today that is AWS in Frankfurt (`aws/provision.sh`). The planned move to OVH in Warsaw (AICARE-26) reuses
everything else unchanged.

Rules that keep a move to another provider down to about a day:

- **Our own domain, DNS outside the cloud (Cloudflare).** Users only know the domain, so a move means
  changing an IP in DNS. Never change the domain itself: the PWA installed on the senior's phone, its local
  settings and the Google Health and Withings redirects are all tied to it.
- **Everything in the image and in `/srv/aicare/.env`.** No provider-specific services without a real need.
- **All data backed up off the server.** The SQLite database and the voice messages go to S3-compatible storage every night.
- **Month-to-month billing**, no reservations or annual prepayment while we may still move.

## On the server

```
/srv/aicare/
  app/          checkout of this repository (deploy/ is in it)
  data/         the household: care.db and audio/ (mounted into the app container)
  backups/      the three newest archives, kept for a quick local restore
  .env          settings and secrets of this server (template: env.example)
  backup.env    where backups go (template: backup.env.example)
```

`/usr/local/bin/aicare` links to `deploy/aicare`, the one command for everyday work. Run it with `sudo`:

| Command | What it does |
|---|---|
| `aicare deploy [ref]` | checks out `ref` (default `main`) and rolls it out |
| `aicare rollout` | rebuilds the checked-out commit with fresh base images, restarts and waits until `/healthz` answers; refuses to run without `DEMO_PASSWORD` |
| `aicare status` | deployed commit, containers, health |
| `aicare logs [caddy]` | follows the app (or Caddy) logs |
| `aicare backup` | archives the database and voice messages and sends the archive off the server (also runs nightly at 03:30) |
| `aicare restore [archive]` | puts the newest archive (or the named one, from the store or a local file) live; keeps the previous data next to it |

Production runs 24/7: reminders, SOS, safety checks and family alerts all come from the server.
Staging resets its demo household every morning (`DEMO_RESET_DAILY=1`) and on AWS is switched off from
23:00 to 07:00.

## A new server (any provider)

1. Create an Ubuntu 24.04 server with your SSH key. Open ports 80 and 443 to everyone and 22 only to us.
2. On the server: `curl -fsSL https://raw.githubusercontent.com/ai-care-agent/AidToTheNeedy/main/deploy/setup-server.sh | sudo bash`
   It installs Docker, rclone and automatic security updates, adds swap, checks out the code and turns on the nightly backup.
3. Fill `/srv/aicare/.env` (domain, password, Claude key; production keeps `DEMO_RESET_DAILY=0`) and
   `/srv/aicare/backup.env` (the backup store). Put secrets in single quotes: Compose expands an
   unquoted `$`, and a password with `$` would arrive empty.
4. Point the domain's DNS record at the server, then run `sudo aicare deploy`.

## AWS

`aws/provision.sh` creates everything on the AWS side, in the project's own account and `eu-central-1`:
the backup bucket, an IAM role that gives the servers access to it (no keys on the servers), the security group,
the SSH key `~/.ssh/aicare`, production (t4g.small) and staging (t4g.micro) with fixed IPs, the night
schedule for staging and a monthly budget with e-mail alerts. The servers run `setup-server.sh` at first boot,
and `backup.env` comes pre-filled.

```bash
aws configure sso                 # once: profile "aicare", the AICARE account only
aws sso login --profile aicare    # whenever the session has expired
AICARE_ACCOUNT_ID=<account id> BUDGET_EMAIL=<e-mail> deploy/aws/provision.sh
```

The script stops if the profile points to any other account. You can run it again, for example to
allow SSH from a new IP (`ADMIN_CIDR`).

### Spending limits

AWS cannot cap a bill exactly, so there are three layers:

1. **Hard limits: the SCP [`aws/guardrails-scp.json`](aws/guardrails-scp.json).** It is attached to the
   AICARE account in the management account: AWS Organizations → Policies → Service control policies →
   enable → Create policy → paste → attach to AICARE. With it, nothing in AICARE runs outside Frankfurt and
   servers can only be t4g.nano to t4g.medium. Marketplace subscriptions, Bedrock, SageMaker, NAT gateways,
   load balancers, reservations and long-lived IAM keys are refused. Remove `bedrock:*` when the AI moves to
   Bedrock (AICARE-5). The account's default vCPU quota (5) also bounds what can run.
2. **A brake.** At `STOP_AT_PERCENT` of the budget (default 125% of 40 USD a month), AWS Budgets stops both
   servers by itself. Billing data lags by hours, so this is a brake, not an exact cap. The morning schedule
   starts staging again. Before real users arrive, switch the action to manual approval.
3. **Alerts.** E-mails at 50%, 80% and 100% of the budget, and when the forecast goes over 100%.

## Backups and restore

`aicare backup` takes a consistent copy of the live database (`VACUUM INTO`, the app keeps running) and
checks it. It packs the copy together with the voice messages and uploads the archive with rclone. Archives
older than `BACKUP_KEEP_DAYS` are deleted. If `BACKUP_HEARTBEAT_URL` is set, the script pings it after
every successful backup, so a missed backup raises an alert.

The restore test, which is also the test that we can move providers: create a **fresh** server, run
`setup-server.sh`, copy `.env` and `backup.env`, then run `sudo aicare restore`. Check that the household
from the backup is there. For a test copy, set `DOMAIN` to a test name and leave `ANTHROPIC_API_KEY` empty:
the copy should neither take over the real domain nor spend tokens. A restore checks the archive before it touches anything and keeps the previous
data in `/srv/aicare/data.before-restore-<time>`.

## Moving to another provider

1. Create the new server as in [A new server](#a-new-server-any-provider), with the same `.env`. Point
   `backup.env` at the same store, or copy the newest archive over.
2. Lower the DNS TTL a day before the move.
3. At a quiet hour, run `sudo aicare backup` on the old server, then `sudo aicare restore` on the new one,
   and switch the DNS record. Downtime is a few minutes.
4. Update the privacy policy and the record of processing (the hosting provider is a processor). After a
   few days, shut the old server down.
