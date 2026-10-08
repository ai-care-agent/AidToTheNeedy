#!/usr/bin/env bash
# The AWS side of the deployment, in the project's own account, region eu-central-1 (Frankfurt):
#   - a private S3 bucket for backups and an IAM role that lets the servers use it (no keys on servers);
#   - a security group: HTTP/HTTPS for everyone, SSH only from ADMIN_CIDR (default: this machine's IP);
#   - an SSH key, ~/.ssh/aicare (created here if missing; the private key never leaves this machine);
#   - production (t4g.small, 24/7) and staging (t4g.micro, off from 23:00 to 07:00 Warsaw time) on
#     Ubuntu 24.04 with fixed IPs, prepared by deploy/setup-server.sh at first boot;
#   - a monthly budget with e-mail alerts.
# Everything else (Docker, HTTPS, backups) is the same on any provider: see deploy/README.md.
# Safe to re-run: existing pieces are reused. Usage:
#   AICARE_ACCOUNT_ID=123456789012 BUDGET_EMAIL=you@example.com deploy/aws/provision.sh
set -euo pipefail
shopt -s inherit_errexit # without it a failure inside $(instance …) would not stop the script

export AWS_PROFILE=${AWS_PROFILE:-aicare}
export AWS_REGION=${AWS_REGION:-eu-central-1}
export AWS_PAGER=""
REF=${AICARE_REF:-main}
BUDGET_USD=${BUDGET_USD:-40}
KEY_FILE=${SSH_KEY_FILE:-$HOME/.ssh/aicare}
TAG='{Key=Project,Value=aicare}'

die() { echo "provision: $*" >&2; exit 1; }
log() { echo "· $*" >&2; }

# Retries a command while AWS has not yet propagated a just-created IAM role (it takes seconds).
retry_iam() {
  local out
  for _ in 1 2 3 4 5 6 7 8; do
    if out=$("$@" 2>&1); then printf '%s\n' "$out"; return 0; fi
    grep -qiE 'instance profile|assume|role' <<<"$out" || die "$out"
    sleep 8
  done
  die "$out"
}

[[ -n ${AICARE_ACCOUNT_ID:-} ]] || die "set AICARE_ACCOUNT_ID, the AICARE account id (a guard against using another account)"
[[ -n ${BUDGET_EMAIL:-} ]] || die "set BUDGET_EMAIL, where budget alerts go"
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
[[ $ACCOUNT == "$AICARE_ACCOUNT_ID" ]] || die "profile $AWS_PROFILE is account $ACCOUNT, not $AICARE_ACCOUNT_ID"
ADMIN_CIDR=${ADMIN_CIDR:-$(curl -fsS https://checkip.amazonaws.com | tr -d '[:space:]')/32}
BUCKET=aicare-backups-$ACCOUNT

bucket() {
  if ! aws s3api head-bucket --bucket "$BUCKET" 2>/dev/null; then
    log "creating bucket $BUCKET"
    aws s3api create-bucket --bucket "$BUCKET" --create-bucket-configuration "LocationConstraint=$AWS_REGION" >/dev/null
  fi
  aws s3api put-public-access-block --bucket "$BUCKET" --public-access-block-configuration \
    BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
  # A safety net: `aicare backup` itself deletes archives older than BACKUP_KEEP_DAYS.
  aws s3api put-bucket-lifecycle-configuration --bucket "$BUCKET" --lifecycle-configuration \
    '{"Rules":[{"ID":"expire-old-backups","Status":"Enabled","Filter":{},"Expiration":{"Days":90},"AbortIncompleteMultipartUpload":{"DaysAfterInitiation":7}}]}'
  aws s3api put-bucket-tagging --bucket "$BUCKET" --tagging 'TagSet=[{Key=Project,Value=aicare}]'
}

server_role() {
  if ! aws iam get-role --role-name aicare-server >/dev/null 2>&1; then
    log "creating IAM role aicare-server"
    aws iam create-role --role-name aicare-server --tags Key=Project,Value=aicare --assume-role-policy-document \
      '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"ec2.amazonaws.com"},"Action":"sts:AssumeRole"}]}' >/dev/null
  fi
  aws iam put-role-policy --role-name aicare-server --policy-name backups --policy-document "$(jq -nc --arg b "$BUCKET" '{
    Version: "2012-10-17",
    Statement: [
      {Effect: "Allow", Action: "s3:ListBucket", Resource: "arn:aws:s3:::\($b)"},
      {Effect: "Allow", Action: ["s3:GetObject", "s3:PutObject", "s3:PutObjectAcl", "s3:DeleteObject"], Resource: "arn:aws:s3:::\($b)/*"}
    ]}')"
  if ! aws iam get-instance-profile --instance-profile-name aicare-server >/dev/null 2>&1; then
    aws iam create-instance-profile --instance-profile-name aicare-server --tags Key=Project,Value=aicare >/dev/null
    aws iam add-role-to-instance-profile --instance-profile-name aicare-server --role-name aicare-server
  fi
}

allow() { # protocol port cidr
  local out
  if ! out=$(aws ec2 authorize-security-group-ingress --group-id "$SG" --protocol "$1" --port "$2" --cidr "$3" 2>&1); then
    grep -q InvalidPermission.Duplicate <<<"$out" || die "$out"
  fi
}

security_group() {
  local vpc
  vpc=$(aws ec2 describe-vpcs --filters Name=isDefault,Values=true --query 'Vpcs[0].VpcId' --output text)
  [[ $vpc != None ]] || die "no default VPC in $AWS_REGION"
  SG=$(aws ec2 describe-security-groups --filters Name=group-name,Values=aicare-web "Name=vpc-id,Values=$vpc" \
    --query 'SecurityGroups[0].GroupId' --output text)
  if [[ $SG == None ]]; then
    log "creating security group aicare-web"
    SG=$(aws ec2 create-security-group --group-name aicare-web --vpc-id "$vpc" \
      --description "AI Care Agent: HTTP and HTTPS for everyone, SSH for admins" \
      --tag-specifications "ResourceType=security-group,Tags=[$TAG]" --query GroupId --output text)
  fi
  allow tcp 80 0.0.0.0/0
  allow tcp 443 0.0.0.0/0
  allow udp 443 0.0.0.0/0
  allow tcp 22 "$ADMIN_CIDR"
}

key_pair() {
  [[ -f $KEY_FILE ]] || ssh-keygen -q -t ed25519 -N '' -C aicare -f "$KEY_FILE"
  if ! aws ec2 describe-key-pairs --key-names aicare >/dev/null 2>&1; then
    log "importing SSH key $KEY_FILE.pub as aicare"
    aws ec2 import-key-pair --key-name aicare --public-key-material "fileb://$KEY_FILE.pub" \
      --tag-specifications "ResourceType=key-pair,Tags=[$TAG]" >/dev/null
  fi
}

instance() { # name type → prints the instance id
  local name=$1 type=$2 id ami userdata
  id=$(aws ec2 describe-instances \
    --filters "Name=tag:Name,Values=aicare-$name" Name=instance-state-name,Values=pending,running,stopping,stopped \
    --query 'Reservations[0].Instances[0].InstanceId' --output text)
  if [[ $id == None ]]; then
    ami=$(aws ssm get-parameter --name /aws/service/canonical/ubuntu/server/24.04/stable/current/arm64/hvm/ebs-gp3/ami-id \
      --query Parameter.Value --output text)
    # First boot: the provider-neutral setup, then the AWS-specific values (no secrets: user data is readable).
    userdata="#!/bin/bash
set -euo pipefail
hostnamectl set-hostname aicare-$name
curl -fsSL https://raw.githubusercontent.com/ai-care-agent/AidToTheNeedy/$REF/deploy/setup-server.sh | AICARE_REF=$REF bash
sed -i 's|^BACKUP_REMOTE=.*|BACKUP_REMOTE=s3:$BUCKET/$name|' /srv/aicare/backup.env"
    [[ $name == staging ]] && userdata+=$'\n'"sed -i 's|^DEMO_RESET_DAILY=.*|DEMO_RESET_DAILY=1|' /srv/aicare/.env"
    log "launching aicare-$name ($type)"
    id=$(retry_iam aws ec2 run-instances --image-id "$ami" --instance-type "$type" --key-name aicare \
      --security-group-ids "$SG" --iam-instance-profile Name=aicare-server \
      --metadata-options HttpTokens=required,HttpEndpoint=enabled,HttpPutResponseHopLimit=1 \
      --block-device-mappings 'DeviceName=/dev/sda1,Ebs={VolumeSize=20,VolumeType=gp3,Encrypted=true,DeleteOnTermination=true}' \
      --user-data "$userdata" \
      --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=aicare-$name},$TAG,{Key=Env,Value=$name}]" \
                           "ResourceType=volume,Tags=[{Key=Name,Value=aicare-$name},$TAG]" \
      --query 'Instances[0].InstanceId' --output text)
    aws ec2 wait instance-running --instance-ids "$id"
  fi
  echo "$id"
}

elastic_ip() { # name instance-id → prints the public IP
  local name=$1 id=$2 alloc
  alloc=$(aws ec2 describe-addresses --filters "Name=tag:Name,Values=aicare-$name" --query 'Addresses[0].AllocationId' --output text)
  if [[ $alloc == None ]]; then
    alloc=$(aws ec2 allocate-address --domain vpc \
      --tag-specifications "ResourceType=elastic-ip,Tags=[{Key=Name,Value=aicare-$name},$TAG]" --query AllocationId --output text)
  fi
  aws ec2 associate-address --allocation-id "$alloc" --instance-id "$id" --allow-reassociation >/dev/null
  aws ec2 describe-addresses --allocation-ids "$alloc" --query 'Addresses[0].PublicIp' --output text
}

schedule() { # name cron action instance-id role-arn
  local verb=create target
  aws scheduler get-schedule --name "$1" >/dev/null 2>&1 && verb=update
  target=$(jq -nc --arg action "$3" --arg id "$4" --arg role "$5" \
    '{Arn: "arn:aws:scheduler:::aws-sdk:ec2:\($action)", RoleArn: $role, Input: ({InstanceIds: [$id]} | tojson)}')
  retry_iam aws scheduler "$verb-schedule" --name "$1" --schedule-expression "$2" \
    --schedule-expression-timezone Europe/Warsaw --flexible-time-window Mode=OFF --target "$target" >/dev/null
}

staging_schedule() { # instance-id
  local id=$1
  if ! aws iam get-role --role-name aicare-scheduler >/dev/null 2>&1; then
    log "creating IAM role aicare-scheduler"
    aws iam create-role --role-name aicare-scheduler --tags Key=Project,Value=aicare --assume-role-policy-document "$(jq -nc --arg a "$ACCOUNT" '{
      Version: "2012-10-17",
      Statement: [{Effect: "Allow", Principal: {Service: "scheduler.amazonaws.com"}, Action: "sts:AssumeRole",
                   Condition: {StringEquals: {"aws:SourceAccount": $a}}}]}')" >/dev/null
  fi
  aws iam put-role-policy --role-name aicare-scheduler --policy-name staging-power --policy-document "$(jq -nc \
    --arg arn "arn:aws:ec2:$AWS_REGION:$ACCOUNT:instance/$id" \
    '{Version: "2012-10-17", Statement: [{Effect: "Allow", Action: ["ec2:StartInstances", "ec2:StopInstances"], Resource: $arn}]}')"
  local role=arn:aws:iam::$ACCOUNT:role/aicare-scheduler
  schedule aicare-staging-stop 'cron(0 23 * * ? *)' stopInstances "$id" "$role"
  schedule aicare-staging-start 'cron(0 7 * * ? *)' startInstances "$id" "$role"
}

budget() {
  aws budgets describe-budget --account-id "$ACCOUNT" --budget-name aicare-monthly >/dev/null 2>&1 && return 0
  log "creating budget aicare-monthly (\$$BUDGET_USD a month), alerts to $BUDGET_EMAIL"
  aws budgets create-budget --account-id "$ACCOUNT" \
    --budget "$(jq -nc --arg usd "$BUDGET_USD" '{BudgetName: "aicare-monthly", BudgetType: "COST", TimeUnit: "MONTHLY", BudgetLimit: {Amount: $usd, Unit: "USD"}}')" \
    --notifications-with-subscribers "$(jq -nc --arg email "$BUDGET_EMAIL" '
      [["ACTUAL", 80], ["ACTUAL", 100], ["FORECASTED", 100]] | map({
        Notification: {NotificationType: .[0], ComparisonOperator: "GREATER_THAN", Threshold: .[1], ThresholdType: "PERCENTAGE"},
        Subscribers: [{SubscriptionType: "EMAIL", Address: $email}]})')"
}

bucket
server_role
security_group
key_pair
PROD=$(instance prod t4g.small)
STAGING=$(instance staging t4g.micro)
PROD_IP=$(elastic_ip prod "$PROD")
STAGING_IP=$(elastic_ip staging "$STAGING")
staging_schedule "$STAGING"
budget

cat <<EOF
Done: account $ACCOUNT, $AWS_REGION.
  prod     $PROD  $PROD_IP
  staging  $STAGING  $STAGING_IP
Backups: s3://$BUCKET/prod and /staging. SSH: ssh -i $KEY_FILE ubuntu@<ip> (allowed from $ADMIN_CIDR).
Next: point the DNS records at these IPs, fill /srv/aicare/.env on each server, then run: sudo aicare deploy
EOF
