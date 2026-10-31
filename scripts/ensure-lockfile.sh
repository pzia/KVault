#!/usr/bin/env sh
# Compatibilité de transition: les updaters <= 0.9.2 ne copiaient pas
# package-lock.json dans la distribution active. La 0.9.3 embarque donc une
# copie bootstrap dans scripts/ (chemin déjà géré par les anciens updaters).
set -eu
ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
LOCK="$ROOT/package-lock.json"
BOOTSTRAP="$ROOT/scripts/package-lock.bootstrap.json"
if [ ! -f "$LOCK" ]; then
  [ -f "$BOOTSTRAP" ] || { echo "package-lock.json absent et bootstrap introuvable." >&2; exit 1; }
  cp "$BOOTSTRAP" "$LOCK"
  echo "package-lock.json restauré depuis le bootstrap distribué." >&2
fi
