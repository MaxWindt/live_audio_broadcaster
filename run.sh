#!/usr/bin/env bash
# Downloads (clones) the latest tagged release of live_audio_broadcaster,
# builds it with Go if it hasn't been built yet, then runs it.
#
# Safe to re-run: if the latest tag is already cloned/built, it just runs
# the cached binary. If a newer tag has been released, it clones/builds that
# one instead.
set -euo pipefail

REPO_URL="https://github.com/MaxWindt/live_audio_broadcaster.git"
CACHE_DIR="${LIVE_AUDIO_BROADCASTER_HOME:-$HOME/.local/share/live_audio_broadcaster}"
SRC_DIR="$CACHE_DIR/src"
BIN_DIR="$CACHE_DIR/bin"

command -v git >/dev/null 2>&1 || { echo "error: git is required but not installed (macOS: install Xcode Command Line Tools, or 'brew install git')" >&2; exit 1; }
command -v go >/dev/null 2>&1 || { echo "error: go is required but not installed (macOS: 'brew install go' or https://go.dev/dl/)" >&2; exit 1; }

mkdir -p "$BIN_DIR"

echo "Checking for latest tag..."
LATEST_TAG=$(git ls-remote --tags --refs "$REPO_URL" \
  | awk -F/ '{print $3}' \
  | sort -V \
  | tail -n1)

if [ -z "$LATEST_TAG" ]; then
  echo "error: could not determine latest tag from $REPO_URL" >&2
  exit 1
fi

echo "Latest tag: $LATEST_TAG"

if [ -d "$SRC_DIR/.git" ]; then
  git -C "$SRC_DIR" fetch --quiet --tags "$REPO_URL"
else
  echo "Cloning repository (first run)..."
  git clone --quiet "$REPO_URL" "$SRC_DIR"
fi

git -C "$SRC_DIR" checkout --quiet "$LATEST_TAG"

BIN_PATH="$BIN_DIR/live_audio_broadcaster-$LATEST_TAG"

if [ ! -x "$BIN_PATH" ]; then
  echo "Building $LATEST_TAG (first run for this version)..."
  (cd "$SRC_DIR" && go build -o "$BIN_PATH" .)
else
  echo "Already built, skipping build step."
fi

echo "Starting live_audio_broadcaster $LATEST_TAG..."
exec "$BIN_PATH"
