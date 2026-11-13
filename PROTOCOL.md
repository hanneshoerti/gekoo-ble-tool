# GEKOO-BLE Protokoll

Reverse-engineered aus einem Android-HCI-Mitschnitt (`btsnoop_hci.log`) der WeChat-Mini-App „BLE Tool“
im Gespräch mit einem Gekoo-Controller, der sich als Typ **ND72260** meldet. Das Protokoll ist **nicht**
das bekannte Fardriver-Protokoll (16-Byte-Pakete mit CRC), sondern deutlich einfacher.

Status: Lesen und Schreiben funktioniert. Mit echter Hardware bisher nur ein Gerät getestet
(Gekoo ND72260 an einem NIU M+ Lite, 13S-Akku, Motor mit 24 Polpaaren).

## Bluetooth LE

| | |
|---|---|
| Gerätename | `GEKOO-BLE` |
| Service | `0xFFE0` |
| Characteristic `0xFFE1` | write without response + notify (gesamte Kommunikation) |
| Characteristic `0xFFE2` | write without response (von der App nicht benutzt) |

Der Controller sendet **nichts von selbst**. Die App fragt ihn ab. Antworten kommen als Notifications in
Stücken zu 20 Byte. Die App sendet lange Frames ebenfalls in 20-Byte-Stücken mit ca. 100 ms Pause.

Alle Zahlen sind 16-Bit **Little Endian**. „Wort n“ heißt Byte `2n` und `2n+1` der Nutzdaten (nach dem 3-Byte-Kopf).

## Befehle

| Senden | Antwort | Bedeutung |
|---|---|---|
| `aa 13 ff 01 aa 13 00 01` | `aa 13 00` + 64 Byte, danach Echo `aa 13 00 01` | Live-Daten (App: alle 100 ms) |
| `aa 11 00 01` | `aa 11 00` + 128 Byte | Parameterblock lesen |
| `aa 21 00 01` | `aa 21 00 01` | Schreiben freigeben (vor jedem Schreiben) |
| `aa 12 00` + 128 Byte | `aa 12 00 aa` | Parameterblock schreiben (`aa` = OK) |
| `aa 17 00 01` | `aa 17 00` + u16 | Kennung (bei uns 8888 = Wort 60 im Parameterblock) |
| `aa 14 06 00 00 00 00 00 00` | – | unbekannt, einmal gesehen. Danach änderten sich „Referenz 1/2“, vermutlich Motor-Lernlauf. **Nicht implementiert.** |

Hinweis zum Parser: Das Echo `aa 13 00 01` hängt am Ende des letzten Stücks eines Live-Frames.
Gelegentlich fasst Android zwei Notifications zusammen, dann folgt direkt der nächste Frame
(`… aa 13 00 01 aa 13 00 d5 1c …`). Ein Echo erkennt man daran, dass auf `01` das Paketende oder `aa` folgt.

## Parameterblock (64 Wörter)

**Prüfsumme:** Wort 63 so, dass die Summe aller 64 Wörter ≡ `0xFFFF` (mod 65536) ist:
`w63 = (0xFFFF − Σ w0…w62) & 0xFFFF`. Verifiziert an allen 26 Blöcken im Mitschnitt.

Schreibablauf der Original-App: `aa 21 00 01` → Antwort abwarten → Block in 7 Stücken (6 × 20 + 11 Byte) →
`aa 12 00 aa` → Block erneut lesen.

| Wort | Bedeutung | Sicherheit | Beispiel |
|---|---|---|---|
| 0 | Max. Batteriestrom (A) | **bestätigt** | 45 |
| 1 | Max. Phasenstrom (A) | **bestätigt** | 120 |
| 3 | Gasgriff Vollgas-Spannung „Full throttle voltage“: Rohwert ÷ 2450 → V | **sicher** (8453 = 3,45 V → 8698 = 3,55 V) | 8698 |
| 4 | Gasgriff Leerlauf-Spannung „Idle throttle voltage“: Rohwert ÷ 2450 → V | **sicher** | 2450 = 1,00 V |
| 5 | Sanftanlauf „Soft start time“: Rohwert × 15 ÷ 4096 → s | **sicher** | 240 = 0,88 s |
| 6 | Sanftanlauf rückwärts (Reverse „Soft start time“): Rohwert × 15 ÷ 4096 → s | **sicher** | 999 = 3,66 s |
| 7 | Tacho-Korrekturfaktor „One-line coefficient“ (%) | **sicher** | 100 → 137 |
| 11 / 12 / 13 | Höchstdrehzahl H / M / L (rpm) | **sicher** | 750 / 600 / 400 |
| 14–16 | Phasenstrom-% H/M/L | **bestätigt** | 100 / 75 / 50 |
| 17–19 | Batteriestrom-% („Bus current“) H/M/L | **bestätigt** | 100 / 75 / 50 |
| 21 | Feldschwächung Stufe H (A) | **sicher** | 65 |
| 22 | Bremsmoment beim Bremsen „Brake feedback torque“ (Nm) | **bestätigt** | 10 |
| 23 | Rekuperationsstrom „Regenerative current“ (A) | **bestätigt** | 11 |
| 45 | Bremsmoment beim Gas loslassen „Release throttle feedback torque“ (Nm) | **bestätigt** (0 schaltet die Motorbremse beim Gaswegnehmen ab) | 8 |
| 24 | Mindestdrehzahl Rekuperation „Minimum feedback speed“ (rpm, Skalierung prüfen) | **bestätigt** | 10 |
| 26 / 27 / 28 | Unterspannung / Leistungsreduzierung Beginn / Ende (V) | vermutet | 38 / 43 / 35 |
| 34 | Polpaare | vermutet | 24 |
| 35 / 36 | C_Kp / C_Ki | vermutet | 256 / 256 |
| 37 | Utilization (%) | vermutet | 107 |
| 38 / 39 | Margin / Adjustment coefficient | vermutet | 10 / 10 |
| 40 | Back EMF | vermutet | 60 |
| 41 | Rated speed (rpm) | vermutet | 1000 |
| 43 / 44 | S_Kp / S_Ki | vermutet | 1024 / 1024 |
| 48 | PWM-Frequenz (kHz) | vermutet | 15 |
| 49 | Referenzstrom Lernlauf (A) | vermutet | 20 |
| 50 | Phasenverschiebung (°) | vermutet | 0 |
| 51 | Encoder-Auflösung | vermutet | 64 |
| 53 / 54 | LF / SF parameter | vermutet | 40 / 80 |
| 55 / 56 | Referenz 1 / 2 (vom Lernlauf gesetzt) | vermutet | 462 / 118 |
| 57 | Rekuperation Spannungsgrenze (V) | vermutet | 54 |
| 59 | Entladekoeffizient SOC | vermutet | 64 |
| 60 | Kennung, nicht ändern | – | 8888 |
| 63 | Prüfsumme | **sicher** | |

„Sicher“ heißt: Im Mitschnitt wurde genau dieser Wert in der App geändert, und genau dieses Wort hat sich geändert.
„Bestätigt“ heißt: vom Nutzer durch Ändern und Vergleich mit der Original-App geprüft. Die restlichen „vermutet“-Felder
wurden ebenfalls stichprobenartig mit der Original-App verglichen und passten.
Alle übrigen Wörter (2, 8–10, 20, 25, 29–33, 42, 46, 47, 52, 58, 61, 62) sind unbekannt. Wort 29 sieht nach einem
Bitfeld aus (Schalter wie Diebstahlsperre/Seitenständer?).

Noch nicht zugeordnet (Felder der Original-App): Riding mode, die Schalter unter „Startup Acceleration“ und „Park Mode“,
Model selection, One-line-/BMS-Protokoll, Shift method, Default gear, Reverse speed/torque, Over-voltage,
Battery series/capacity/type, Bergabfahrhilfe, Direction, Sensor type, Hall-/Encoder-Reihenfolge.

**Zuordnen ohne Sniffen:** Die App merkt sich den zuletzt gelesenen Parameterblock. Ändert man in der Original-App
genau einen Wert und liest danach in dieser App neu, zeigt sie unter „Seit dem letzten Lesen geändert“ die betroffenen
Wörter mit alt → neu, Hex und geänderten Bits (auch im Log, Zeilen mit „Δ“).

## Live-Frame (64 Byte = 32 Wörter, vorzeichenbehaftet)

Kalibriert an der Anzeige der Original-App in allen drei Gängen.

| Wort / Byte | Bedeutung | Umrechnung |
|---|---|---|
| Wort 2 | Gasgriff-Spannung | ÷ 2450 → V |
| Wort 6 | Drehzahl | × 4,395 ÷ Polpaare → U/min (nur mit 24 Polpaaren geprüft) |
| Wort 8 | Akkuspannung | ÷ 273,3 → V |
| Wort 9 | Akkustrom | A |
| Wort 12 | Feldschwächungsstrom (negativ) | ÷ 32 → A |
| Wort 13, 15 | Stromkomponenten | Phasenstrom ≈ √(w13² + w15²) ÷ 32 |
| Wort 17 | 12-V-Bordnetz | ÷ 146,2 → V |
| Wort 18 | Temperatur | ÷ 100 → °C |
| Wort 19 | Fehler-/Statuscode (0 = normal) | |
| Byte 40 | Status (3 = Motor aktiv) | |
| Byte 41 | Gang: 0 = L, 1 = M, 2 = H | |
| Wort 21 | Flags (Bremse? Ständer?) | unbekannt |
| Wort 26, 27 | 2026, 1015 – vermutlich Firmware-Datum | |

Die Anschluss-Zustände der Original-App (Diebstahlsperre, Rückwärts, Bremse, Tempomat, Seitenständer …)
sind noch nicht zugeordnet. Sie stecken vermutlich in Wort 21.

## Mitmachen

1. Android: Entwickleroptionen → „Bluetooth HCI-Snoop-Protokoll“ → Aktiviert, Bluetooth aus/an.
2. In der Original-App **genau eine** Einstellung ändern und die Uhrzeit notieren.
3. `adb bugreport bug.zip`, darin `FS/data/log/bt/btsnoop_hci.log` (oder `…/misc/bluetooth/logs/`).
4. `python3 tools/btsnoop_decode.py btsnoop_hci.log > session.txt`
5. Geänderte Wörter mit dem Test-Skript oder per Hand vergleichen und hier eintragen.
