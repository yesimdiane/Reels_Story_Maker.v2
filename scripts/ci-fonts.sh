#!/usr/bin/env bash
# CI / sandbox ONLY. The brand subtitle font (NanumSquareRound) is not packaged for Linux, so the render tests would fail
# with FONT_MISSING on a clean runner. This installs a *stand-in* file under that name (a Korean-capable system font) so the
# font-presence check passes; libass then renders with a fallback face. It proves the pipeline, NOT the brand look.
# Never use this in production: the Docker image sets RF_FONT_NAME=NanumGothic, a real installed font.
set -euo pipefail
SRC=$(fc-list :lang=ko file 2>/dev/null | sed 's/: *$//; s/:.*//' | grep -iE '\.(ttf|otf)$' | grep -i nanum | head -1 || true)
[ -z "$SRC" ] && SRC=$(fc-list :lang=ko file 2>/dev/null | sed 's/:.*//' | grep -iE '\.(ttf|otf)$' | head -1 || true)
[ -z "$SRC" ] && SRC=$(fc-list file | sed 's/:.*//' | grep -iE '\.ttf$' | head -1)
[ -n "$SRC" ] || { echo "no usable font found" >&2; exit 1; }
# RF_FONTS_DIR (the renderer reads it too) wins over ~/.fonts so a sandbox can keep fonts outside $HOME.
DEST="${RF_FONTS_DIR:-$HOME/.fonts}"
mkdir -p "$DEST"
cp "$SRC" "$DEST/NanumSquareRound-Regular.ttf"
fc-cache -f >/dev/null 2>&1 || true
echo "stand-in font installed from: $SRC -> $DEST"
[ -z "${RF_FONTS_DIR:-}" ] || echo "run tests with RF_FONTS_DIR=$RF_FONTS_DIR"
