@echo off
rem Kopiert die Web-Oberflaeche in die App (nach Aenderungen an index.html/gekoo.js ausfuehren)
cd /d "%~dp0"
for %%f in (index.html gekoo.js android-bridge.js mock-device.js demo-data.js) do copy /Y "..\%%f" "app\src\main\assets\www\" >nul
echo Web-Dateien aktualisiert.
