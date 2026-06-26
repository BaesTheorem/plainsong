#!/usr/bin/env bash
# Serve the Plainsong web app on :5020. Run from the repo root or anywhere.
cd "$(dirname "$0")/.." || exit 1
exec python3 -m http.server 5020 --bind 127.0.0.1
