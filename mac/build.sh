#!/bin/sh
# Builds Läsa for Mac into mac/build: the sync engine as one executable, the menu-bar app around it, and a .dmg.
#
#   sh mac/build.sh                                                     ad-hoc signed, runs on this Mac
#   SIGN_IDENTITY="Developer ID Application: Name (TEAMID)" sh mac/build.sh   signed for notarization
#
# Needs Swift (Xcode or the Command Line Tools), node and npx. It downloads the official Node binary once,
# because Homebrew's node loads its libraries from /opt/homebrew and is built without single-executable support.
set -eu
cd "$(dirname "$0")/.."

NODE_VERSION=${NODE_VERSION:-v26.8.1}
ESBUILD_VERSION=0.25.10
IDENTITY=${SIGN_IDENTITY:--}
ARCH=arm64
VERSION=$(node -p 'require("./package.json").version')
CACHE="$HOME/Library/Caches/lasa-build"
OUT="$(pwd)/mac/build"
APP="$OUT/Läsa.app"
DMG="$OUT/Lasa-$VERSION.dmg"

NODE_DIR="$CACHE/node-$NODE_VERSION-darwin-$ARCH"
if [ ! -x "$NODE_DIR/bin/node" ]; then
  TARBALL="node-$NODE_VERSION-darwin-$ARCH.tar.gz"
  mkdir -p "$CACHE"
  curl -fsSL -o "$CACHE/SHASUMS256-$NODE_VERSION.txt" "https://nodejs.org/dist/$NODE_VERSION/SHASUMS256.txt"
  curl -fsSL -o "$CACHE/$TARBALL" "https://nodejs.org/dist/$NODE_VERSION/$TARBALL"
  (cd "$CACHE" && grep " $TARBALL\$" "SHASUMS256-$NODE_VERSION.txt" | shasum -a 256 -c -)
  tar -xzf "$CACHE/$TARBALL" -C "$CACHE" "node-$NODE_VERSION-darwin-$ARCH/bin/node"
fi

rm -rf "$OUT"
mkdir -p "$OUT"

echo "sync engine"
npx --yes "esbuild@$ESBUILD_VERSION" mac/helper.mjs --bundle --platform=node --format=esm --target=node22 \
  --log-level=warning --outfile="$OUT/helper.mjs"
cat > "$OUT/sea.json" <<EOF
{ "main": "$OUT/helper.mjs", "mainFormat": "module", "output": "$OUT/lasa-sync", "disableExperimentalSEAWarning": true }
EOF
"$NODE_DIR/bin/node" --build-sea "$OUT/sea.json" >/dev/null

echo "app"
swiftc -parse-as-library -O -target "$ARCH-apple-macos13.0" mac/Sources/*.swift -o "$OUT/Lasa"
swiftc -O mac/icon/main.swift mac/Sources/Glyph.swift -o "$OUT/icon"
"$OUT/icon" "$OUT/icon.png"
mkdir -p "$OUT/Lasa.iconset"
for size in 16 32 128 256 512; do
  sips -z $size $size "$OUT/icon.png" --out "$OUT/Lasa.iconset/icon_${size}x${size}.png" >/dev/null
  sips -z $((size * 2)) $((size * 2)) "$OUT/icon.png" --out "$OUT/Lasa.iconset/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns "$OUT/Lasa.iconset" -o "$OUT/Lasa.icns"

mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$OUT/Lasa" "$OUT/lasa-sync" "$APP/Contents/MacOS/"
cp "$OUT/Lasa.icns" "$APP/Contents/Resources/"
sed "s/@VERSION@/$VERSION/g" mac/Info.plist > "$APP/Contents/Info.plist"

echo "signing as $IDENTITY"
# Inside out: the helper first (it needs V8's JIT entitlements under the hardened runtime), then the app.
if [ "$IDENTITY" = "-" ]; then TIMESTAMP=--timestamp=none; else TIMESTAMP=--timestamp; fi
codesign --force --options runtime $TIMESTAMP --entitlements mac/helper.entitlements --identifier app.web.lasa-reading.mac.sync --sign "$IDENTITY" "$APP/Contents/MacOS/lasa-sync"
codesign --force --options runtime $TIMESTAMP --sign "$IDENTITY" "$APP"
codesign --verify --strict --deep "$APP"

echo "disk image"
mkdir -p "$OUT/dmg"
ditto "$APP" "$OUT/dmg/Läsa.app"
ln -s /Applications "$OUT/dmg/Applications"
hdiutil create -quiet -volname "Läsa" -srcfolder "$OUT/dmg" -ov -format UDZO "$DMG"
if [ "$IDENTITY" != "-" ]; then codesign --force --timestamp --sign "$IDENTITY" "$DMG"; fi

echo "built $APP"
echo "built $DMG ($(du -h "$DMG" | cut -f1 | tr -d ' '))"
