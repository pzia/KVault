#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
"$ROOT/scripts/ensure-lockfile.sh"
DB_NAME="kobo-library-vault"
CONFIG="$ROOT/wrangler.jsonc"
ZERO_UUID="00000000-0000-0000-0000-000000000000"

need() { command -v "$1" >/dev/null 2>&1 || { echo "Erreur: commande '$1' introuvable." >&2; exit 1; }; }
need node
need npm

if ! node -e 'const [maj]=process.versions.node.split(".").map(Number); process.exit(maj>=20?0:1)'; then
  echo "Erreur: Node.js >= 20 est requis (actuel: $(node -v))." >&2
  exit 1
fi

echo "[1/5] Installation des dépendances de développement…"
npm ci

if [[ -f "$CONFIG" ]] && grep -q 'REPLACE_WITH_D1_DATABASE_ID' "$CONFIG"; then
  sed -i "s/REPLACE_WITH_D1_DATABASE_ID/$ZERO_UUID/g" "$CONFIG"
fi

echo "[2/5] Vérification de l'authentification Cloudflare…"
if ! npx wrangler whoami >/dev/null 2>&1; then
  npx wrangler login
fi

find_db_id() {
  npx wrangler d1 list --json 2>/dev/null | node -e '
    let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>{
      try { const j=JSON.parse(s); const a=Array.isArray(j)?j:(j.result||j.databases||j.d1_databases||[]); const x=a.find(v=>v.name===process.argv[1]); if(x) process.stdout.write(x.uuid||x.id||""); }
      catch(e) { process.exit(2); }
    });' "$DB_NAME"
}

DB_ID="$(find_db_id || true)"
if [[ -z "$DB_ID" ]]; then
  echo "[3/5] Création de la base D1 '$DB_NAME'…"
  npx wrangler d1 create "$DB_NAME"
  DB_ID="$(find_db_id || true)"
else
  echo "[3/5] Base D1 '$DB_NAME' déjà présente: $DB_ID"
fi

if [[ ! "$DB_ID" =~ ^[0-9a-fA-F-]{36}$ ]]; then
  echo "Impossible de déterminer automatiquement l'UUID D1." >&2
  echo "Exécutez 'npx wrangler d1 list' puis remplacez REPLACE_WITH_D1_DATABASE_ID dans wrangler.jsonc.example." >&2
  exit 1
fi

if [[ ! -f "$CONFIG" ]]; then cp wrangler.jsonc.example "$CONFIG"; fi
node - "$CONFIG" "$DB_ID" "$ZERO_UUID" <<'NODE'
const fs=require('fs'); const [,,file,id,zero]=process.argv;
let s=fs.readFileSync(file,'utf8');
s=s.replace(/REPLACE_WITH_D1_DATABASE_ID|00000000-0000-0000-0000-000000000000/g,id);
fs.writeFileSync(file,s);
NODE

echo "[4/5] Application des migrations D1 distantes…"
npx wrangler d1 migrations apply "$DB_NAME" --remote

echo "[5/5] Déploiement Worker + assets…"
npx wrangler deploy

echo
echo "Déploiement terminé. Le coffre est prêt à être créé depuis l'URL affichée par Wrangler."
