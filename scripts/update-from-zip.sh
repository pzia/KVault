#!/usr/bin/env bash
# Mise à jour transactionnelle depuis un ZIP.
#
# Principes :
# - validation et tests dans un staging avant modification du projet actif ;
# - wrangler.jsonc, .dev.vars, .wrangler/ et .git/ restent hors distribution ;
# - node_modules/ n'est remplacé qu'après validation d'un nouvel environnement ;
# - sauvegarde de la distribution courante et restauration automatique si l'application locale échoue ;
# - --dry-run ne modifie rien ; --rollback restaure la dernière sauvegarde de distribution.
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT_ID="kobo-library-vault-v1"
BACKUP_DIR="$(dirname "$ROOT")/.kobo-library-vault-backups"
KEEP_BACKUPS="${KOBO_VAULT_KEEP_BACKUPS:-3}"

DIST_PATHS=(
  src public migrations scripts tests docs interfaces
  package.json package-lock.json wrangler.jsonc.example README.md CHANGELOG.md LICENSE .gitignore .project-id
)

ZIP=""
DO_INSTALL=0
DO_DEPLOY=0
DRY_RUN=0
ROLLBACK=0
APPLYING=0
BACKUP=""
TMP=""
OLD_NODE_MODULES=""
NEW_NODE_MODULES_INSTALLED=0

usage() {
  cat <<'USAGE'
Usage:
  ./scripts/update-from-zip.sh nouvelle-version.zip [--install] [--deploy] [--dry-run]
  ./scripts/update-from-zip.sh --rollback [--install] [--deploy] [--dry-run]

Options:
  --install   installe les dépendances dans le staging et lance tous les tests avant bascule
  --deploy    implique --install ; déploie depuis le staging validé après la bascule locale contrôlée
  --dry-run   valide l'archive / la sauvegarde et affiche le plan sans rien modifier
  --rollback  restaure la dernière sauvegarde de distribution créée par ce script
USAGE
}

for arg in "$@"; do
  case "$arg" in
    --install) DO_INSTALL=1 ;;
    --deploy) DO_INSTALL=1; DO_DEPLOY=1 ;;
    --dry-run) DRY_RUN=1 ;;
    --rollback) ROLLBACK=1 ;;
    -h|--help) usage; exit 0 ;;
    --*) echo "Option inconnue: $arg" >&2; usage; exit 2 ;;
    *)
      if [[ -n "$ZIP" ]]; then
        echo "Un seul ZIP peut être fourni." >&2; exit 2
      fi
      ZIP="$arg"
      ;;
  esac
done

if (( ROLLBACK )) && [[ -n "$ZIP" ]]; then
  echo "--rollback ne prend pas de ZIP." >&2; exit 2
fi
if (( ! ROLLBACK )) && [[ -z "$ZIP" ]]; then
  usage; exit 2
fi

need() { command -v "$1" >/dev/null 2>&1 || { echo "La commande '$1' est requise." >&2; exit 1; }; }
need node
need tar
need find
if (( ! ROLLBACK )); then need unzip; need zipinfo; fi

[[ -f "$ROOT/.project-id" ]] || { echo "Refus: .project-id absent dans le répertoire cible." >&2; exit 1; }
[[ "$(tr -d '\r\n' < "$ROOT/.project-id")" == "$PROJECT_ID" ]] || { echo "Refus: identifiant du projet cible inattendu." >&2; exit 1; }

version_of() {
  node -e 'const fs=require("fs"); const p=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); if(!p.version) process.exit(2); process.stdout.write(String(p.version));' "$1/package.json"
}

align_app_version() {
  local project_dir="$1" config_file="$2"
  [[ -f "$config_file" ]] || return 0
  node - "$project_dir/package.json" "$config_file" <<'NODE'
const fs=require('fs'); const [,,pkgFile,configFile]=process.argv;
const version=JSON.parse(fs.readFileSync(pkgFile,'utf8')).version;
let s=fs.readFileSync(configFile,'utf8');
if (/"APP_VERSION"\s*:/.test(s)) s=s.replace(/("APP_VERSION"\s*:\s*")[^"]*(")/, `$1${version}$2`);
fs.writeFileSync(configFile,s);
NODE
}

validate_zip_names() {
  local zip="$1" bad=0 name normalized
  while IFS= read -r name; do
    normalized="${name//\\//}"
    if [[ "$normalized" == /* || "$normalized" =~ ^[A-Za-z]:/ || "$normalized" == ".." || "$normalized" == ../* || "$normalized" == */../* || "$normalized" == */.. ]]; then
      echo "ZIP refusé: chemin dangereux: $name" >&2
      bad=1
    fi
  done < <(unzip -Z1 "$zip")
  (( bad == 0 )) || exit 1
}

baseline_check() {
  local dir="$1"
  node --check "$dir/src/worker.js"
  node --check "$dir/public/app.js"
  node --check "$dir/public/crypto.js"
  node --check "$dir/public/storage.js"
  node --check "$dir/public/model.js"
  bash -n "$dir"/scripts/*.sh
}

full_check() {
  local dir="$1"
  (cd "$dir" && npm run check)
}

restore_distribution() {
  [[ -n "$BACKUP" && -f "$BACKUP" ]] || return 0
  echo "Échec détecté: restauration de la distribution précédente…" >&2
  for p in "${DIST_PATHS[@]}"; do rm -rf "$ROOT/$p"; done
  tar -C "$ROOT" -xzf "$BACKUP"
  if [[ -n "$OLD_NODE_MODULES" && -d "$OLD_NODE_MODULES" ]]; then
    rm -rf "$ROOT/node_modules"
    mv "$OLD_NODE_MODULES" "$ROOT/node_modules"
  elif (( NEW_NODE_MODULES_INSTALLED )); then
    rm -rf "$ROOT/node_modules"
  fi
  align_app_version "$ROOT" "$ROOT/wrangler.jsonc" || true
  echo "Distribution précédente restaurée." >&2
}

cleanup() {
  local rc=$?
  if (( rc != 0 && APPLYING )); then
    set +e
    restore_distribution
    set -e
  fi
  [[ -n "$TMP" && -d "$TMP" ]] && rm -rf "$TMP"
  return "$rc"
}
trap cleanup EXIT

mkdir -p "$BACKUP_DIR"
TMP="$(mktemp -d "$(dirname "$ROOT")/.kobo-vault-update.XXXXXX")"
SRC=""
SOURCE_LABEL=""

if (( ROLLBACK )); then
  BACKUP_SOURCE="$(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'kobo-library-vault-dist-*.tar.gz' -printf '%T@ %p\n' 2>/dev/null | sort -nr | head -n1 | cut -d' ' -f2-)"
  if [[ -z "$BACKUP_SOURCE" ]]; then
    # Compatibilité avec les sauvegardes créées par les updaters <= 0.8.0.
    BACKUP_SOURCE="$(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'kobo-library-vault-*.tar.gz' ! -name 'kobo-library-vault-dist-*.tar.gz' -printf '%T@ %p\n' 2>/dev/null | sort -nr | head -n1 | cut -d' ' -f2-)"
  fi
  [[ -n "$BACKUP_SOURCE" && -f "$BACKUP_SOURCE" ]] || { echo "Aucune sauvegarde disponible dans $BACKUP_DIR." >&2; exit 1; }
  mkdir -p "$TMP/source"
  tar -C "$TMP/source" -xzf "$BACKUP_SOURCE"
  SRC="$TMP/source"
  SOURCE_LABEL="rollback $(basename "$BACKUP_SOURCE")"
else
  [[ -f "$ZIP" ]] || { echo "ZIP introuvable: $ZIP" >&2; exit 2; }
  validate_zip_names "$ZIP"
  if zipinfo -l "$ZIP" | awk 'NR > 2 && $1 ~ /^l/ { found=1 } END { exit(found ? 0 : 1) }'; then
    echo "ZIP refusé: les liens symboliques ne sont pas autorisés dans la distribution." >&2
    exit 1
  fi
  mkdir -p "$TMP/unpacked"
  unzip -q "$ZIP" -d "$TMP/unpacked"
  if find "$TMP/unpacked" -type l -print -quit | grep -q .; then
    echo "ZIP refusé: les liens symboliques ne sont pas autorisés dans la distribution." >&2
    exit 1
  fi
  mapfile -t SENTINELS < <(find "$TMP/unpacked" -type f -name .project-id -print)
  [[ ${#SENTINELS[@]} -eq 1 ]] || { echo "ZIP invalide: une seule racine de projet avec .project-id est requise." >&2; exit 1; }
  SRC="$(dirname "${SENTINELS[0]}")"
  SOURCE_LABEL="$(basename "$ZIP")"
fi

[[ -f "$SRC/.project-id" ]] || { echo "Source invalide: .project-id absent." >&2; exit 1; }
[[ "$(tr -d '\r\n' < "$SRC/.project-id")" == "$PROJECT_ID" ]] || { echo "Source d'un autre projet." >&2; exit 1; }
[[ -f "$SRC/package.json" && -d "$SRC/public" && -d "$SRC/src" && -d "$SRC/scripts" ]] || { echo "Distribution incomplète." >&2; exit 1; }

CURRENT_VERSION="$(version_of "$ROOT")"
TARGET_VERSION="$(version_of "$SRC")"

echo "Source       : $SOURCE_LABEL"
echo "Version active: $CURRENT_VERSION"
echo "Version cible : $TARGET_VERSION"
echo "Mode          : $([[ $DRY_RUN -eq 1 ]] && echo dry-run || echo application)$([[ $DO_INSTALL -eq 1 ]] && echo ' + install')$([[ $DO_DEPLOY -eq 1 ]] && echo ' + deploy')"

baseline_check "$SRC"

if (( DRY_RUN )); then
  echo "Validation dry-run OK. Aucun fichier, dépendance, configuration ni déploiement n'a été modifié."
  exit 0
fi

# Prépare une release candidate autonome avec la configuration Cloudflare préservée.
CANDIDATE="$TMP/candidate"
mkdir -p "$CANDIDATE"
cp -a "$SRC/." "$CANDIDATE/"
[[ -f "$ROOT/wrangler.jsonc" ]] && cp -a "$ROOT/wrangler.jsonc" "$CANDIDATE/wrangler.jsonc"
[[ -f "$ROOT/.dev.vars" ]] && cp -a "$ROOT/.dev.vars" "$CANDIDATE/.dev.vars"
align_app_version "$CANDIDATE" "$CANDIDATE/wrangler.jsonc"

if (( DO_INSTALL )); then
  echo "Validation de la release candidate (npm ci + tests)…"
  (cd "$CANDIDATE" && npm ci)
  full_check "$CANDIDATE"
fi

if (( DO_DEPLOY )); then
  [[ -f "$CANDIDATE/wrangler.jsonc" ]] || { echo "wrangler.jsonc absent: impossible de déployer." >&2; exit 1; }
fi

# Sauvegarde uniquement la distribution gérée. La configuration et les secrets restent hors archive.
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="$BACKUP_DIR/kobo-library-vault-dist-${CURRENT_VERSION}-${STAMP}.tar.gz"
EXISTING=()
for p in "${DIST_PATHS[@]}"; do [[ -e "$ROOT/$p" ]] && EXISTING+=("$p"); done
( cd "$ROOT" && tar -czf "$BACKUP" "${EXISTING[@]}" )
echo "Sauvegarde transactionnelle: $BACKUP"

# La release candidate a déjà été installée/testée/déployée si demandé. On bascule maintenant le code local.
APPLYING=1
for p in "${DIST_PATHS[@]}"; do
  rm -rf "$ROOT/$p"
  [[ -e "$CANDIDATE/$p" ]] && cp -a "$CANDIDATE/$p" "$ROOT/$p"
done

if (( DO_INSTALL )) && [[ -d "$CANDIDATE/node_modules" ]]; then
  if [[ -d "$ROOT/node_modules" ]]; then
    OLD_NODE_MODULES="$TMP/node_modules.previous"
    mv "$ROOT/node_modules" "$OLD_NODE_MODULES"
  fi
  mv "$CANDIDATE/node_modules" "$ROOT/node_modules"
  NEW_NODE_MODULES_INSTALLED=1
fi

align_app_version "$ROOT" "$ROOT/wrangler.jsonc"
baseline_check "$ROOT"
if (( DO_INSTALL )); then full_check "$ROOT"; fi

if (( DO_DEPLOY )); then
  echo "Déploiement de la release candidate validée…"
  "$CANDIDATE/scripts/deploy.sh"
fi

APPLYING=0

# Conserve un petit historique de rollback, sans jamais toucher aux données/configurations préservées.
if [[ "$KEEP_BACKUPS" =~ ^[0-9]+$ ]] && (( KEEP_BACKUPS > 0 )); then
  mapfile -t OLD_BACKUPS < <(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'kobo-library-vault-dist-*.tar.gz' -printf '%T@ %p\n' | sort -nr | tail -n +$((KEEP_BACKUPS + 1)) | cut -d' ' -f2-)
  for old in "${OLD_BACKUPS[@]}"; do rm -f "$old"; done
fi

echo "Mise à jour locale terminée: $CURRENT_VERSION → $TARGET_VERSION"
echo "Configuration Cloudflare, .dev.vars, .git et données locales préservées."
if (( DO_DEPLOY )); then
  echo "Déploiement Cloudflare terminé depuis la release candidate validée."
else
  echo "Pour publier: ./scripts/deploy.sh"
fi
