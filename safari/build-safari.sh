#!/bin/bash
# Syncs extension source from root to Safari project Resources,
# then builds the macOS .app.
# Usage: ./safari/build-safari.sh

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SAFARI_RESOURCES="$ROOT_DIR/safari/PokemonTcgScanner/Shared (Extension)/Resources"

echo "=== Syncing extension source to Safari Resources ==="
mkdir -p "$SAFARI_RESOURCES"
rsync -av --delete --delete-excluded \
  --exclude='safari' \
  --exclude='node_modules' \
  --exclude='.git' \
  --exclude='tests' \
  --exclude='.gitignore' \
  --exclude='package.json' \
  --exclude='package-lock.json' \
  --exclude='vitest.config.js' \
  --exclude='AGENTS.md' \
  --exclude='PLAN.md' \
  --exclude='README.md' \
  --exclude='docs' \
  --exclude='.cache' \
  --exclude='scripts' \
  --exclude='design' \
  --exclude='build' \
  --exclude='.devin' \
  --exclude='.DS_Store' \
  --exclude='data/bulbapedia/*.json' \
  --exclude='data/bulbapedia/*/*.json' \
  --exclude='data/bulbapedia/*.jsonl' \
  --exclude='data/bulbapedia/*/*.jsonl' \
  --exclude='data/bulbapedia/*.txt' \
  --exclude='data/bulbapedia/*/*.txt' \
  "$ROOT_DIR/" "$SAFARI_RESOURCES/"

# The JSON reports, review decisions, gold-pair text files, and the .jsonl
# companions of a full validation pass under data/bulbapedia are development-only
# artifacts (about 34 MB, of which the .jsonl files are about 5.2 MB). The
# extension runtime only reads the counterpart-index.js bundles and set-era-map.js
# there, so they are excluded above to keep the app small.

echo ""
echo "=== Building macOS app ==="
cd "$ROOT_DIR/safari/PokemonTcgScanner"
xcodebuild -project PokemonTcgScanner.xcodeproj \
  -scheme "PokemonTcgScanner (macOS)" \
  -configuration Debug \
  build \
  2>&1 | tail -5

APP_PATH=$(find ~/Library/Developer/Xcode/DerivedData/PokemonTcgScanner-* -name "PokemonTcgScanner.app" -path "*/Debug/*" 2>/dev/null | head -1)

echo ""
if [ -n "$APP_PATH" ]; then
  echo "=== Build succeeded ==="
  echo "App: $APP_PATH"
  # Collect the app in the build/ folder so Safari's folder-only picker has a
  # single place to point at.
  BUILD_OUT="$ROOT_DIR/build/safari"
  APP_NAME="$(basename "$APP_PATH")"
  mkdir -p "$BUILD_OUT"
  rm -rf "${BUILD_OUT:?}/$APP_NAME"
  cp -R "$APP_PATH" "$BUILD_OUT/"
  # Safari's "Add Temporary Extension" picker takes the extension folder itself
  # (the one holding manifest.json), not a folder containing the .app.
  EXTENSION_OUT="$BUILD_OUT/extension"
  node "$ROOT_DIR/scripts/build-extension.mjs" --out "$EXTENSION_OUT"
  echo ""
  echo "App bundle:       $BUILD_OUT/$APP_NAME"
  echo "Extension folder: $EXTENSION_OUT"
  echo ""
  echo "Safari > Develop > Add Temporary Extension: select $EXTENSION_OUT"
  echo "To run the packaged app instead:  open \"$BUILD_OUT/$APP_NAME\""
else
  echo "=== Build may have failed — check output above ==="
fi
