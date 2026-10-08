#!/usr/bin/env bash
# Turns a fresh Ubuntu 24.04 server from any provider into an AI Care Agent host. Run once as root:
#   curl -fsSL https://raw.githubusercontent.com/ai-care-agent/AidToTheNeedy/main/deploy/setup-server.sh | sudo bash
# Running it again is safe. Afterwards fill /srv/aicare/.env and /srv/aicare/backup.env, point DNS at
# the server and run `sudo aicare deploy`. AICARE_REF picks the branch, tag or commit to check out.
set -euo pipefail

REPO=${AICARE_REPO:-https://github.com/ai-care-agent/AidToTheNeedy.git}
REF=${AICARE_REF:-main}
ROOT=/srv/aicare

# Everything is inside main(), so a script piped into bash is read completely before it runs.
main() {
  [[ $EUID -eq 0 ]] || { echo "run as root" >&2; exit 1; }
  export DEBIAN_FRONTEND=noninteractive

  # Docker from docker.com (current Compose), git, rclone for the backups, jq for aicare, security updates.
  apt-get update -q
  apt-get install -y -q ca-certificates curl git jq rclone unattended-upgrades
  command -v docker >/dev/null || curl -fsSL https://get.docker.com | sh
  systemctl enable --now docker
  printf 'APT::Periodic::Update-Package-Lists "1";\nAPT::Periodic::Unattended-Upgrade "1";\n' > /etc/apt/apt.conf.d/20auto-upgrades

  # Small servers (1–2 GB) need swap to build the web apps.
  if [[ -z $(swapon --noheadings) ]]; then
    fallocate -l 2G /swapfile
    chmod 600 /swapfile
    mkswap /swapfile >/dev/null
    swapon /swapfile
    grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  fi

  # Code, data (owned by the app image's "node" user) and local backup copies.
  install -d -m 755 "$ROOT"
  install -d -m 700 "$ROOT/backups"
  install -d -o 1000 -g 1000 -m 750 "$ROOT/data"
  [[ -d $ROOT/app/.git ]] || git clone -q "$REPO" "$ROOT/app"
  git -C "$ROOT/app" fetch -q --prune --tags origin
  if git -C "$ROOT/app" rev-parse -q --verify "origin/$REF^{commit}" >/dev/null; then
    git -C "$ROOT/app" checkout -q --detach "origin/$REF"
  else
    git -C "$ROOT/app" checkout -q --detach "$REF"
  fi
  [[ -f $ROOT/.env ]] || install -m 600 "$ROOT/app/deploy/env.example" "$ROOT/.env"
  [[ -f $ROOT/backup.env ]] || install -m 600 "$ROOT/app/deploy/backup.env.example" "$ROOT/backup.env"
  ln -sf "$ROOT/app/deploy/aicare" /usr/local/bin/aicare

  # Nightly backup.
  install -m 644 "$ROOT/app/deploy/systemd/aicare-backup.service" "$ROOT/app/deploy/systemd/aicare-backup.timer" /etc/systemd/system/
  systemctl daemon-reload
  systemctl enable --now aicare-backup.timer

  echo "Ready. Next: fill $ROOT/.env and $ROOT/backup.env, point DNS at this server, then run: sudo aicare deploy"
}

main "$@"
