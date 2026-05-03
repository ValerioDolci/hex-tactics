#!/bin/bash
# Deploy hex-tactics build to GitHub Pages (repo pubblico ValerioDolci/hex-tactics-play).
#
# Usage:
#   ./scripts/deploy_pages.sh "messaggio commit"
#
# Pre-req:
#   - Aver fatto `SINGLEFILE=1 npx vite build` (genera dist/index.html)
#   - Repo pubblico ValerioDolci/hex-tactics-play già esistente con Pages attivo
#
# URL pubblico: https://valeriodolci.github.io/hex-tactics-play/

set -euo pipefail

MSG="${1:-Update playable build}"
SOURCE_HTML="$(dirname "$0")/../dist/index.html"
PAGES_REPO="/tmp/hex-tactics-play"

if [ ! -f "$SOURCE_HTML" ]; then
  echo "❌ $SOURCE_HTML non esiste. Esegui prima: SINGLEFILE=1 npx vite build"
  exit 1
fi

# Clone se non esiste già
if [ ! -d "$PAGES_REPO" ]; then
  echo "[deploy] Clono ValerioDolci/hex-tactics-play in $PAGES_REPO"
  git clone -q https://github.com/ValerioDolci/hex-tactics-play.git "$PAGES_REPO"
fi

cd "$PAGES_REPO"
git config user.email "valerio.dolci89@gmail.com"
git config user.name "ValerioDolci"
git pull -q origin main

# Copia il nuovo build
cp "$SOURCE_HTML" index.html

# Commit + push se ci sono cambi
if ! git diff --quiet index.html; then
  git add index.html
  git commit -qm "$MSG"
  git push -q origin main
  echo "[deploy] ✅ Pushato. URL: https://valeriodolci.github.io/hex-tactics-play/"
  echo "[deploy] Aspetta ~30-60s per il deploy effettivo."
else
  echo "[deploy] Nessun cambio (build identico). Skip."
fi
