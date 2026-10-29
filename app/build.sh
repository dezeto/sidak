#!/bin/zsh
# Build ~/Applications/Sidak.app from Sidak.swift and (re)launch it.
set -e
cd ${0:A:h}
app=$HOME/Applications/Sidak.app
mkdir -p $app/Contents/MacOS $app/Contents/Resources
# App icon: app/icon.png (1024px, from icon.svg, the inspection stamp).
set=$(mktemp -d)/AppIcon.iconset; mkdir -p $set
for s in 16 32 128 256 512; do sips -z $s $s icon.png --out $set/icon_${s}x${s}.png >/dev/null; done
sips -z 1024 1024 icon.png --out $set/icon_512x512@2x.png >/dev/null
iconutil -c icns $set -o $app/Contents/Resources/AppIcon.icns
swiftc -O -o $app/Contents/MacOS/Sidak Sidak.swift -framework Cocoa -framework WebKit
# SidakDir: the repo folder above app/, where Sidak.swift reads the page and runs bin/.
cat > $app/Contents/Info.plist <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleIdentifier</key><string>dev.dezeto.sidak</string>
  <key>SidakDir</key><string>${PWD:h}</string>
  <key>CFBundleName</key><string>Sidak</string>
  <key>CFBundleExecutable</key><string>Sidak</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>LSUIElement</key><true/>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>NSAppTransportSecurity</key><dict><key>NSAllowsArbitraryLoads</key><true/></dict>
</dict></plist>
PLIST
# Ad-hoc signed: notifications need a signed bundle.
# Ad-hoc signing gives every build a new hash, and macOS ties the Documents-folder grant to the signature's requirement:
# pin the requirement to the bundle id so one "Allow" lasts across rebuilds. Any app signed with this id shares the grant.
codesign --force --deep -s - -r='designated => identifier "dev.dezeto.sidak"' $app
pkill -x Sidak 2>/dev/null || true
sleep 1; open $app
echo "built and launched $app"
