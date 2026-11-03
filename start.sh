#!/usr/bin/env bash
# Startet den Couch Launcher (z. B. als Non-Steam-Spiel in Steam hinzufügen)
cd "$(dirname "$0")" || exit 1
exec npx --no-install electron . "$@"
