#!/usr/bin/env bash
# Installs the brand subtitle font (NanumSquareRound) into RF_FONTS_DIR from a font file you supply.
# NanumSquareRound has no Debian package, so there is deliberately no built-in download URL: pass one you trust
# (with its SHA-256) or a local file. Without a source this does nothing, and the renderer keeps using RF_FONT_NAME.
#   RF_FONT_FILE=/path/NanumSquareRoundR.ttf bash scripts/install-fonts.sh
#   RF_FONT_URL=https://... RF_FONT_SHA256=<hex> RF_FONTS_DIR=/usr/local/share/fonts/rf bash scripts/install-fonts.sh
set -euo pipefail
DEST="${RF_FONTS_DIR:-$HOME/.fonts}"
TMP="$(mktemp)"; trap 'rm -f "$TMP"' EXIT
if [ -n "${RF_FONT_FILE:-}" ]; then cp "$RF_FONT_FILE" "$TMP"
elif [ -n "${RF_FONT_URL:-}" ]; then
  [ -n "${RF_FONT_SHA256:-}" ] || { echo "RF_FONT_URL needs RF_FONT_SHA256" >&2; exit 1; }
  curl -fsSL --max-time 60 -o "$TMP" "$RF_FONT_URL"
else echo "no RF_FONT_FILE / RF_FONT_URL: skipping font install"; exit 0; fi
if [ -n "${RF_FONT_SHA256:-}" ]; then
  echo "$RF_FONT_SHA256  $TMP" | sha256sum -c - >/dev/null || { echo "font checksum mismatch" >&2; exit 1; }
fi
case "$(head -c 4 "$TMP" | od -An -tx1 | tr -d ' \n')" in
  00010000|4f54544f|74727565) ;;  # TrueType / OpenType / 'true'
  *) echo "not a TTF/OTF file" >&2; exit 1 ;;
esac
mkdir -p "$DEST"
install -m 0644 "$TMP" "$DEST/NanumSquareRoundR.ttf"
fc-cache -f "$DEST" >/dev/null 2>&1 || true
echo "installed NanumSquareRound -> $DEST/NanumSquareRoundR.ttf"
