#!/bin/sh
# Kopiert die Web-Oberfläche aus dem Projektordner in die App (nach Änderungen an index.html/gekoo.js ausführen).
cd "$(dirname "$0")"
cp ../index.html ../gekoo.js ../android-bridge.js ../mock-device.js ../demo-data.js app/src/main/assets/www/ && echo "Web-Dateien aktualisiert."
