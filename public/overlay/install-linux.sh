#!/bin/sh
# Installation de Wakfu Companion Overlay sous Linux (x86_64, session X11 ou XWayland).
#
#   curl -fsSL https://wakfu-companion.com/overlay/install-linux.sh | sh
#
# Ce que fait ce script, sans droits administrateur (rien hors de votre dossier personnel) :
#   1. lit le manifeste de la dernière version publiée sur GitHub (latest.json) ;
#   2. télécharge le binaire de cette version et vérifie son empreinte SHA-256 ;
#   3. le décompresse dans ~/.local/bin/wakfu-companion-overlay et le rend exécutable ;
#   4. ajoute un raccourci « Wakfu Companion Overlay » au menu des applications ;
#   5. lance l'overlay (sauf avec --no-launch).
# L'overlay se met ensuite à jour seul : ce script ne sert qu'à la première installation.
# Relancer le script réinstalle la dernière version, au même endroit.
#
# Désinstaller : rm ~/.local/bin/wakfu-companion-overlay \
#   ~/.local/share/applications/wakfu-companion-overlay.desktop
#
# Source de ce script : https://github.com/oumbra/wakfu-companion (public/overlay/install-linux.sh)
# Source de l'overlay : https://github.com/Oumbra/wakfu-companion-overlay

set -eu

RELEASES="https://github.com/Oumbra/wakfu-companion-overlay/releases"
ASSET_KEY="linux-x86_64"
BIN_DIR="${XDG_BIN_HOME:-$HOME/.local/bin}"
BIN="$BIN_DIR/wakfu-companion-overlay"
APPS_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
DESKTOP_FILE="$APPS_DIR/wakfu-companion-overlay.desktop"

LAUNCH=1
for arg in "$@"; do
  case "$arg" in
    --no-launch) LAUNCH=0 ;;
  esac
done

# Messages en français si la langue du système l'est, en anglais sinon.
case "${LC_ALL:-${LC_MESSAGES:-${LANG:-}}}" in
  fr*) FR=1 ;;
  *) FR=0 ;;
esac
say() { if [ "$FR" = 1 ]; then printf '%s\n' "$1"; else printf '%s\n' "$2"; fi; }
fail() {
  if [ "$FR" = 1 ]; then printf 'Erreur : %s\n' "$1" >&2; else printf 'Error: %s\n' "$2" >&2; fi
  exit 1
}

[ "$(uname -s)" = "Linux" ] || fail "ce script est réservé à Linux." "this script only supports Linux."
case "$(uname -m)" in
  x86_64 | amd64) ;;
  *) fail "l'overlay n'existe qu'en x86_64 (processeur détecté : $(uname -m))." \
    "the overlay is only built for x86_64 (detected CPU: $(uname -m))." ;;
esac

if command -v curl >/dev/null 2>&1; then
  fetch() { curl -fsSL --retry 2 -o "$2" "$1"; }
elif command -v wget >/dev/null 2>&1; then
  fetch() { wget -q -O "$2" "$1"; }
else
  fail "curl ou wget est nécessaire." "curl or wget is required."
fi
command -v gzip >/dev/null 2>&1 || fail "gzip est nécessaire." "gzip is required."
if command -v sha256sum >/dev/null 2>&1; then
  sha256() { sha256sum "$1" | cut -d ' ' -f 1; }
elif command -v shasum >/dev/null 2>&1; then
  sha256() { shasum -a 256 "$1" | cut -d ' ' -f 1; }
else
  fail "sha256sum est nécessaire." "sha256sum is required."
fi

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT INT TERM

say "Recherche de la dernière version…" "Looking up the latest version…"
fetch "$RELEASES/latest/download/latest.json" "$TMP_DIR/latest.json" ||
  fail "impossible de joindre GitHub." "could not reach GitHub."

# Manifeste mis à plat (sans blancs) : l'entrée "linux-x86_64":{"name":…,"size":…,"sha256":…}.
MANIFEST="$(tr -d ' \t\r\n' <"$TMP_DIR/latest.json")"
VERSION="$(printf '%s' "$MANIFEST" | sed -n 's/.*"version":"\([0-9][0-9.]*\)".*/\1/p')"
ENTRY_PATTERN="s/.*\"$ASSET_KEY\":{\"name\":\"\\([A-Za-z0-9._-]*\\)\",\"size\":[0-9]*,\"sha256\":\"\\([0-9a-f]\\{64\\}\\)\".*/\\1 \\2/p"
ENTRY="$(printf '%s' "$MANIFEST" | sed -n "$ENTRY_PATTERN")"
ASSET_NAME="${ENTRY% *}"
ASSET_SHA="${ENTRY#* }"
[ -n "$VERSION" ] && [ -n "$ENTRY" ] ||
  fail "manifeste de version illisible, réessayez plus tard." "unreadable release manifest, try again later."

say "Téléchargement de la version $VERSION…" "Downloading version $VERSION…"
fetch "$RELEASES/download/v$VERSION/$ASSET_NAME" "$TMP_DIR/overlay.gz" ||
  fail "échec du téléchargement." "download failed."
[ "$(sha256 "$TMP_DIR/overlay.gz")" = "$ASSET_SHA" ] ||
  fail "empreinte SHA-256 incorrecte, fichier corrompu ou altéré." "SHA-256 mismatch, corrupted or tampered download."

gzip -dc "$TMP_DIR/overlay.gz" >"$TMP_DIR/wakfu-companion-overlay"
chmod 755 "$TMP_DIR/wakfu-companion-overlay"
mkdir -p "$BIN_DIR" "$APPS_DIR"
# `mv` remplace le fichier sans toucher à une instance déjà lancée (elle garde l'ancien binaire).
mv -f "$TMP_DIR/wakfu-companion-overlay" "$BIN"

cat >"$DESKTOP_FILE" <<EOF
[Desktop Entry]
Type=Application
Name=Wakfu Companion Overlay
Comment=Wakfu Companion overlay
Exec="$BIN"
Icon=applications-games
Terminal=false
Categories=Game;Utility;
EOF
command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$APPS_DIR" >/dev/null 2>&1 || true

say "Installé : $BIN" "Installed: $BIN"
say "Raccourci ajouté au menu des applications : « Wakfu Companion Overlay »." \
  "Shortcut added to the applications menu: \"Wakfu Companion Overlay\"."

if [ "$LAUNCH" = 1 ] && { [ -n "${DISPLAY:-}" ] || [ -n "${WAYLAND_DISPLAY:-}" ]; }; then
  say "Lancement de l'overlay…" "Starting the overlay…"
  nohup "$BIN" >/dev/null 2>&1 &
else
  say "Pour le lancer : $BIN" "To start it: $BIN"
fi
