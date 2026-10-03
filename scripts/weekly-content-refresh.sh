#!/usr/bin/env bash
# Weekly content refresh:
#   1. Reinstall dependencies (npm ci) unless SKIP_INSTALL=1.
#   2. Re-run preindex to pull the latest upstream skill repos.
#   3. Refresh repo-derived bundles.
#   4. Verify the website still builds with the refreshed data.
#   5. Report whether tracked content changed via GITHUB_OUTPUT (when set).
#
# Usage:
#   scripts/weekly-content-refresh.sh
#
# Environment:
#   SKIP_INSTALL=1   skip `npm ci` (useful for local runs)
#   GITHUB_OUTPUT    when set (CI), receives `changed=true|false`
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${ROOT_DIR}"

log() {
  printf '\n=== %s ===\n' "$*"
}

if [[ "${SKIP_INSTALL:-0}" != "1" ]]; then
  log "Installing dependencies (npm ci)"
  npm ci
else
  log "Skipping npm ci (SKIP_INSTALL=1)"
fi

log "Refreshing skill index (npm run preindex)"
npm run preindex

log "Refreshing repo-derived bundles (npm run refresh:repo-bundles)"
npm run refresh:repo-bundles

log "Verifying website build (npm run build:website)"
npm run build:website

log "Detecting tracked content changes"
TRACKED_PATHS=(
  "data/skill-index"
  "data/skill-index-resources.json"
  "data/bundles"
)

if [[ -n "$(git status --porcelain -- "${TRACKED_PATHS[@]}")" ]]; then
  CHANGED="true"
  echo "Detected changes in tracked content paths:"
  git status --short -- "${TRACKED_PATHS[@]}"
else
  CHANGED="false"
  echo "No content changes detected."
fi

if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
  echo "changed=${CHANGED}" >> "${GITHUB_OUTPUT}"
fi

log "Weekly content refresh complete (changed=${CHANGED})"
