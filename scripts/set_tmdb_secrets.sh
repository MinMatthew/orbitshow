#!/usr/bin/env bash
# Prompts for the TMDb credentials (input is hidden) and stores them as GitHub Actions secrets and in a git-ignored .env.
# Run it yourself in a terminal: ./scripts/set_tmdb_secrets.sh
set -euo pipefail
cd "$(dirname "$0")/.."

command -v gh >/dev/null || { echo "GitHub CLI (gh) is required: https://cli.github.com"; exit 1; }

read -rsp "TMDb API Read Access Token (v4, starts with eyJ; Enter to skip): " token; echo
read -rsp "TMDb API Key (v3; Enter to skip): " key; echo
[ -n "$token$key" ] || { echo "Nothing entered."; exit 1; }

repo=$(gh repo view --json nameWithOwner -q .nameWithOwner)
[ -n "$token" ] && printf '%s' "$token" | gh secret set TMDB_READ_TOKEN --repo "$repo"
[ -n "$key" ] && printf '%s' "$key" | gh secret set TMDB_API_KEY --repo "$repo"

touch .env && chmod 600 .env
for pair in "TMDB_READ_TOKEN=$token" "TMDB_API_KEY=$key"; do
  name=${pair%%=*}; value=${pair#*=}
  [ -n "$value" ] || continue
  grep -v "^$name=" .env > .env.tmp || true
  echo "$name=$value" >> .env.tmp
  mv .env.tmp .env
done
chmod 600 .env

echo "Saved to GitHub secrets ($repo) and .env (git-ignored)."
echo "Try it locally: npm run data    Or run in CI: gh workflow run ranks.yml"
