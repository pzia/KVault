#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"; cd "$ROOT"
"$ROOT/scripts/ensure-lockfile.sh"
[[ -f wrangler.jsonc ]] || { echo "wrangler.jsonc absent. Lancez ./scripts/setup-cloudflare.sh d'abord." >&2; exit 1; }
if grep -Eq 'REPLACE_WITH_D1_DATABASE_ID|00000000-0000-0000-0000-000000000000' wrangler.jsonc; then
  echo "L'ID D1 n'est pas configuré. Lancez ./scripts/setup-cloudflare.sh." >&2; exit 1
fi
# Préserve la configuration locale mais aligne la version applicative après un auto-update.
node - <<'NODE'
const fs=require('fs');
const version=JSON.parse(fs.readFileSync('package.json','utf8')).version;
let s=fs.readFileSync('wrangler.jsonc','utf8');
s=s.replace(/("APP_VERSION"\s*:\s*")[^"]*(")/, `$1${version}$2`);
fs.writeFileSync('wrangler.jsonc',s);
NODE
[[ -d node_modules ]] || npm ci
npm run check
npx wrangler d1 migrations apply kobo-library-vault --remote
npx wrangler deploy
