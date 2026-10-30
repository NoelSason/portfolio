#!/usr/bin/env bash
# Deploys site/ to AWS Amplify Hosting as a manual (no Git) deployment.
# Needs AWS CLI v2 credentials (run `aws login` first) and the app ID from README.md.
set -euo pipefail

APP_ID="${APP_ID:-d149c0bsd6u3f4}"
BRANCH="${BRANCH:-main}"
REGION="${AWS_REGION:-us-east-1}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ZIP="$(mktemp -d)/site.zip"

node --test "$ROOT"/tests/*.test.mjs

(cd "$ROOT/site" && zip -qr "$ZIP" . -x ".*")

read -r JOB_ID UPLOAD_URL < <(aws amplify create-deployment \
  --app-id "$APP_ID" --branch-name "$BRANCH" --region "$REGION" \
  --query '[jobId, zipUploadUrl]' --output text)

curl --fail --silent --show-error -T "$ZIP" -H "Content-Type: application/zip" "$UPLOAD_URL"

aws amplify start-deployment \
  --app-id "$APP_ID" --branch-name "$BRANCH" --job-id "$JOB_ID" --region "$REGION" >/dev/null

echo "Started job $JOB_ID. Waiting for it to finish..."
while true; do
  STATUS="$(aws amplify get-job --app-id "$APP_ID" --branch-name "$BRANCH" --job-id "$JOB_ID" \
    --region "$REGION" --query 'job.summary.status' --output text)"
  case "$STATUS" in
    SUCCEED) echo "Deployed: https://$BRANCH.$APP_ID.amplifyapp.com"; break ;;
    FAILED | CANCELLED) echo "Deployment $STATUS" >&2; exit 1 ;;
    *) sleep 3 ;;
  esac
done

rm -rf "$(dirname "$ZIP")"
