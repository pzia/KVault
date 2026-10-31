#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"; cd "$ROOT"
"$ROOT/scripts/ensure-lockfile.sh"
if [[ ! -f wrangler.jsonc ]]; then
  cp wrangler.jsonc.example wrangler.jsonc
  sed -i 's/REPLACE_WITH_D1_DATABASE_ID/00000000-0000-0000-0000-000000000000/g' wrangler.jsonc
fi
[[ -d node_modules ]] || npm ci
npx wrangler d1 migrations apply KOBO_VAULT --local
exec npx wrangler dev
