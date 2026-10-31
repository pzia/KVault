#!/usr/bin/env bash
# Configure le secret serveur utilisé pour chiffrer les credentials Kobo publiés
# explicitement pour l'API d'acquisition v2.
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
"$ROOT/scripts/ensure-lockfile.sh"
[[ -f wrangler.jsonc ]] || { echo "wrangler.jsonc absent. Lancez ./scripts/setup-cloudflare.sh d'abord." >&2; exit 1; }
[[ -d node_modules ]] || npm ci
if npx wrangler secret list 2>/dev/null | grep -q 'KOBO_API_CREDENTIAL_KEY'; then
  echo "KOBO_API_CREDENTIAL_KEY est déjà configuré. Aucun changement."
  exit 0
fi
SECRET="$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")"
printf '%s' "$SECRET" | npx wrangler secret put KOBO_API_CREDENTIAL_KEY
unset SECRET
echo "Secret KOBO_API_CREDENTIAL_KEY créé."
echo "Vous pouvez maintenant activer l'accès d'acquisition dans Kobo Vault."
