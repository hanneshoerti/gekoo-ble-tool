// GEKOO-BLE Protokoll (Fardriver-artiger Controller, z. B. Typ "ND72260")
// Reverse-engineered aus einem Android-HCI-Mitschnitt der WeChat-Mini-App "BLE Tool".
// Details: PROTOCOL.md  ·  Lizenz: MIT

export const SERVICE_UUID = 0xffe0;
export const CHAR_UUID = 0xffe1;          // write-without-response + notify
export const CHUNK = 20;                  // die Original-App sendet in 20-Byte-Stücken
export const CHUNK_DELAY_MS = 100;        // ... mit ca. 100 ms Abstand

export const CMD = {
  POLL: Uint8Array.of(0xaa, 0x13, 0xff, 0x01, 0xaa, 0x13, 0x00, 0x01), // Live-Daten abfragen
  READ_PARAMS: Uint8Array.of(0xaa, 0x11, 0x00, 0x01),                 // Parameterblock lesen
  UNLOCK_WRITE: Uint8Array.of(0xaa, 0x21, 0x00, 0x01),                // vor jedem Schreiben
  READ_ID: Uint8Array.of(0xaa, 0x17, 0x00, 0x01),                     // Antwort: aa 17 00 <u16>
};

export const PARAM_WORDS = 64;            // 128 Byte, Wort 63 = Prüfsumme
const FRAME_LEN = { 0x13: 3 + 64, 0x11: 3 + PARAM_WORDS * 2 };
const SHORT_LEN = { 0x13: 4, 0x21: 4, 0x12: 4, 0x17: 5 };
const KNOWN_CMDS = new Set([0x11, 0x12, 0x13, 0x17, 0x21]);

/** Zerlegt den Notify-Strom in Frames. onFrame({cmd, bytes, short}) */
export class FrameParser {
  constructor(onFrame) { this.onFrame = onFrame; this.reset(); }
  reset() { this.buf = []; this.need = 0; }
  push(chunk) {
    let i = 0;
    // Beginnt ein Notify-Paket mit einem neuen Kopf, ist ein halb gesammelter Frame unvollständig → verwerfen.
    // (Fortsetzungsstücke beginnen nie mit "aa xx 00", siehe PROTOCOL.md)
    if (this.need && chunk[0] === 0xaa && chunk[2] === 0x00 && KNOWN_CMDS.has(chunk[1])) {
      this.dropped = (this.dropped || 0) + 1;
      this.reset();
    }
    while (i < chunk.length) {
      if (this.need) {
        const take = Math.min(this.need - this.buf.length, chunk.length - i);
        for (let k = 0; k < take; k++) this.buf.push(chunk[i + k]);
        i += take;
        if (this.buf.length === this.need) {
          const bytes = Uint8Array.from(this.buf);
          this.reset();
          this.onFrame({ cmd: bytes[1], bytes, short: false });
        }
        continue;
      }
      if (chunk[i] !== 0xaa) { i++; continue; }            // Resync auf 0xAA
      const cmd = chunk[i + 1];
      // Echo "aa 13 00 01" steht am Paketende oder direkt vor dem nächsten 0xAA
      const isEcho = cmd === 0x13 && chunk[i + 3] === 0x01 && (i + 4 === chunk.length || chunk[i + 4] === 0xaa);
      if (FRAME_LEN[cmd] && chunk[i + 2] === 0x00 && !isEcho) { this.need = FRAME_LEN[cmd]; continue; }
      // Kurze Antworten: aa 21 00 01 (Schreiben freigegeben), aa 12 00 aa (geschrieben),
      // aa 17 00 xx xx (Kennung), aa 13 00 01 (Echo)
      const len = Math.min(SHORT_LEN[cmd] ?? chunk.length - i, chunk.length - i);
      this.onFrame({ cmd, bytes: chunk.slice(i, i + len), short: true });
      i += len;
    }
  }
}

const s16 = (b, o) => { const v = b[o] | (b[o + 1] << 8); return v & 0x8000 ? v - 0x10000 : v; };
const u16 = (b, o) => b[o] | (b[o + 1] << 8);

// Kalibriert an der Anzeige der Original-App (3 Gänge, Polpaare 24)
export const SCALE = {
  voltage: 1 / 273.3,        // Wort 8
  throttle: 1 / 2450,        // Wort 2
  aux12v: 1 / 146.2,         // Wort 17
  rpmPolePairs: 4.395,       // Drehzahl = Wort 6 × 4,395 / Polpaare
  current: 1 / 32,           // Wort 12/13/15
};

/** Live-Frame dekodieren (67 Byte inkl. Kopf oder 64 Byte Nutzdaten). */
export function decodeRealtime(frame, { polePairs = 24, tireCm = 133 } = {}) {
  const p = frame.length === 67 ? frame.subarray(3) : frame;
  const w = (i) => s16(p, i * 2);
  const rpm = (w(6) * SCALE.rpmPolePairs) / (polePairs || 24);
  const id = w(13) * SCALE.current, iq = w(15) * SCALE.current;
  const voltage = w(8) * SCALE.voltage, temperature = w(18) / 100;
  return {
    // Plausibilitätsprüfung: falsch zusammengesetzte Frames nicht anzeigen
    valid: p[41] <= 2 && voltage > 5 && voltage < 150 && temperature > -40 && temperature < 150,
    voltage,
    batteryCurrent: w(9),
    rpm,
    kmh: rpm * (tireCm / 100) * 0.06,
    throttleV: w(2) * SCALE.throttle,
    aux12v: u16(p, 34) * SCALE.aux12v,
    temperature,
    phaseCurrent: Math.hypot(id, iq),
    fieldWeakening: Math.max(0, -w(12) * SCALE.current),
    errorCode: u16(p, 38),
    status: p[40],
    gear: ['L', 'M', 'H'][p[41]] ?? `?${p[41]}`,
    flags: u16(p, 42),
    words: Array.from({ length: 32 }, (_, i) => w(i)),
  };
}

// ---------------------------------------------------------------- Parameter

export const wordsFromBlock = (bytes) => {
  const p = bytes.length === 3 + PARAM_WORDS * 2 ? bytes.subarray(3) : bytes;
  return Array.from({ length: PARAM_WORDS }, (_, i) => u16(p, i * 2));
};

/** Prüfsumme: Summe aller 64 Wörter ≡ 0xFFFF (mod 65536). */
export const checksum = (words) => (0xffff - words.slice(0, 63).reduce((a, b) => a + b, 0)) & 0xffff;
export const checksumOk = (words) => checksum(words) === words[63];

export function buildWriteFrame(words) {
  const w = words.slice(0, 63).map((v) => v & 0xffff);
  w.push(checksum(w));
  const out = new Uint8Array(3 + PARAM_WORDS * 2);
  out.set([0xaa, 0x12, 0x00]);
  w.forEach((v, i) => { out[3 + i * 2] = v & 0xff; out[4 + i * 2] = v >> 8; });
  return out;
}

export function* chunks(bytes, size = CHUNK) {
  for (let i = 0; i < bytes.length; i += size) yield bytes.slice(i, i + size);
}

/**
 * Bekannte Parameter (mit der Original-App abgeglichen).
 * Alle anderen Wörter sind unbekannt und nur im Expertenmodus änderbar.
 */
export const PARAMS = [
  { i: 0, name: 'Max. Batteriestrom', unit: 'A', min: 5, max: 120, conf: 'ok', group: 'Strom',
    help: 'Höchster Strom aus dem Akku. Begrenzt die Leistung und schont Akku und BMS.' },
  { i: 1, name: 'Max. Phasenstrom', unit: 'A', min: 10, max: 260, conf: 'ok', group: 'Strom',
    help: 'Höchster Strom im Motor. Bestimmt die Zugkraft beim Anfahren. Zu hoch = Motor wird heiß.' },
  { i: 11, name: 'H: Höchstdrehzahl', unit: 'rpm', min: 0, max: 3000, conf: 'ok', group: 'Fahrstufen', speed: true,
    help: 'Drehzahlgrenze in Stufe H (schnell).' },
  { i: 12, name: 'M: Höchstdrehzahl', unit: 'rpm', min: 0, max: 3000, conf: 'ok', group: 'Fahrstufen', speed: true,
    help: 'Drehzahlgrenze in Stufe M (mittel).' },
  { i: 13, name: 'L: Höchstdrehzahl', unit: 'rpm', min: 0, max: 3000, conf: 'ok', group: 'Fahrstufen', speed: true,
    help: 'Drehzahlgrenze in Stufe L (langsam).' },
  { i: 14, name: 'H: Phasenstrom', unit: '%', min: 0, max: 100, conf: 'ok', group: 'Fahrstufen',
    help: 'Prozent vom max. Phasenstrom in Stufe H. Bestimmt die Zugkraft.' },
  { i: 15, name: 'M: Phasenstrom', unit: '%', min: 0, max: 100, conf: 'ok', group: 'Fahrstufen', help: 'Wie oben, Stufe M.' },
  { i: 16, name: 'L: Phasenstrom', unit: '%', min: 0, max: 100, conf: 'ok', group: 'Fahrstufen', help: 'Wie oben, Stufe L.' },
  { i: 17, name: 'H: Batteriestrom', unit: '%', min: 0, max: 100, conf: 'ok', group: 'Fahrstufen',
    help: 'Prozent vom max. Batteriestrom („Bus current“) in Stufe H. Bestimmt die Leistung.' },
  { i: 18, name: 'M: Batteriestrom', unit: '%', min: 0, max: 100, conf: 'ok', group: 'Fahrstufen', help: 'Wie oben, Stufe M.' },
  { i: 19, name: 'L: Batteriestrom', unit: '%', min: 0, max: 100, conf: 'ok', group: 'Fahrstufen', help: 'Wie oben, Stufe L.' },
  { i: 21, name: 'H: Feldschwächung', unit: 'A', min: 0, max: 120, conf: 'ok', group: 'Motor',
    help: 'Zusatzstrom, der den Motor über seine Grunddrehzahl treibt. Mehr = schneller, aber viel Wärme. Nur in Stufe H aktiv.' },
  { i: 34, name: 'Polpaare', unit: '', min: 1, max: 60, conf: 'ok', group: 'Motor',
    help: 'Magnet-Polpaare des Motors. Falscher Wert = falsche Drehzahl und falsche Limits.' },
  { i: 48, name: 'PWM-Frequenz', unit: 'kHz', min: 6, max: 20, conf: 'ok', group: 'Motor',
    help: 'Schaltfrequenz der Endstufe. Höher = leiser, Controller wärmer.' },
  { i: 49, name: 'Referenzstrom (Lernlauf)', unit: 'A', min: 5, max: 60, conf: 'ok', group: 'Motor',
    help: 'Strom, mit dem der Controller beim Lernlauf den Motor vermisst.' },
  { i: 50, name: 'Phasenverschiebung', unit: '°', min: 0, max: 360, conf: 'ok', group: 'Motor',
    help: 'Winkelkorrektur Hall-Sensor ↔ Magnet. Normalerweise vom Lernlauf.' },
  { i: 51, name: 'Encoder-Auflösung', unit: 'Linien', min: 0, max: 4096, conf: 'ok', group: 'Motor',
    help: 'Nur für Motoren mit Drehgeber. Bei Hall-Motoren ohne Bedeutung.' },
  { i: 26, name: 'Unterspannung (Abschaltung)', unit: 'V', min: 20, max: 90, conf: 'ok', group: 'Spannung',
    help: 'Unter dieser Akkuspannung schaltet der Controller ab (Tiefentladeschutz).' },
  { i: 27, name: 'Leistungsreduzierung Beginn', unit: 'V', min: 20, max: 90, conf: 'ok', group: 'Spannung',
    help: 'Ab hier wird die Leistung bei fast leerem Akku langsam reduziert.' },
  { i: 28, name: 'Leistungsreduzierung Ende', unit: 'V', min: 20, max: 90, conf: 'ok', group: 'Spannung',
    help: 'Hier ist die Leistung am stärksten reduziert.' },
  { i: 57, name: 'Rekuperation Spannungsgrenze', unit: 'V', min: 30, max: 100, conf: 'ok', group: 'Spannung',
    help: 'Über dieser Akkuspannung wird nicht mehr zurückgeladen. Knapp unter der Ladeschlussspannung wählen (13S: 54 V, 16S: 67 V, 20S: 84 V).' },
  { i: 22, name: 'Bremsmoment beim Bremsen', unit: 'Nm', min: 0, max: 100, conf: 'ok', group: 'Rekuperation',
    help: '„Brake feedback torque“. Wie stark der Motor mitbremst, wenn du den Bremshebel ziehst.' },
  { i: 45, name: 'Bremsmoment beim Gas loslassen', unit: 'Nm', min: 0, max: 100, conf: 'ok', group: 'Rekuperation',
    help: '„Release throttle feedback torque“. Motorbremse beim Gaswegnehmen.' },
  { i: 23, name: 'Rekuperationsstrom', unit: 'A', min: 0, max: 50, conf: 'ok', group: 'Rekuperation',
    help: '„Regenerative current“. Maximaler Ladestrom beim Bremsen.' },
  { i: 24, name: 'Mindestdrehzahl Rekuperation', unit: 'rpm', min: 0, max: 2000, conf: 'ok', group: 'Rekuperation',
    help: '„Minimum feedback speed“. Darunter bremst der Motor nicht mehr mit, damit es beim Anhalten nicht ruckelt.' },
  { i: 7, name: 'Tacho-Korrekturfaktor', unit: '%', min: 50, max: 250, conf: 'ok', group: 'Tacho',
    help: '„One-line coefficient“. Skaliert die Geschwindigkeit, die an den Tacho geht.' },
  { i: 59, name: 'Entladekoeffizient (SOC)', unit: '', min: 0, max: 255, conf: 'ok', group: 'Akku',
    help: 'Korrekturwert für die Akkustand-Berechnung.' },
  { i: 35, name: 'C_Kp (Stromregler P)', unit: '', min: 0, max: 65535, conf: 'ok', group: 'Experte', help: 'Regelparameter. Nicht ändern ohne Grund.' },
  { i: 36, name: 'C_Ki (Stromregler I)', unit: '', min: 0, max: 65535, conf: 'ok', group: 'Experte', help: 'Regelparameter. Nicht ändern ohne Grund.' },
  { i: 37, name: 'Spannungsausnutzung', unit: '%', min: 90, max: 115, conf: 'ok', group: 'Experte', help: '„Utilization“. Über 100 % etwas mehr Endgeschwindigkeit, mehr Wärme.' },
  { i: 38, name: 'Margin', unit: '', min: 0, max: 65535, conf: 'ok', group: 'Experte', help: 'Interner Reservewert.' },
  { i: 39, name: 'Adjustment coefficient', unit: '', min: 0, max: 65535, conf: 'ok', group: 'Experte', help: 'Interner Korrekturwert.' },
  { i: 40, name: 'Gegen-EMK (Back EMF)', unit: '', min: 0, max: 65535, conf: 'ok', group: 'Experte', help: 'Motorkonstante, wichtig für Feldschwächung.' },
  { i: 41, name: 'Nenndrehzahl', unit: 'rpm', min: 0, max: 65535, conf: 'ok', group: 'Experte', help: '„Rated speed“.' },
  { i: 43, name: 'S_Kp (Drehzahlregler P)', unit: '', min: 0, max: 65535, conf: 'ok', group: 'Experte', help: 'Regelparameter.' },
  { i: 44, name: 'S_Ki (Drehzahlregler I)', unit: '', min: 0, max: 65535, conf: 'ok', group: 'Experte', help: 'Regelparameter.' },
  { i: 53, name: 'LF-Parameter', unit: '', min: 0, max: 65535, conf: 'ok', group: 'Experte', help: 'Interner Filterwert.' },
  { i: 54, name: 'SF-Parameter', unit: '', min: 0, max: 65535, conf: 'ok', group: 'Experte', help: 'Interner Filterwert.' },
  { i: 55, name: 'Referenz 1', unit: '', min: 0, max: 65535, conf: 'ok', group: 'Experte', help: 'Wird vom Lernlauf gesetzt.' },
  { i: 56, name: 'Referenz 2', unit: '', min: 0, max: 65535, conf: 'ok', group: 'Experte', help: 'Wird vom Lernlauf gesetzt.' },
];

export const READ_ONLY = new Set([60, 63]); // 60 = Kennung (= Antwort auf 0x17), 63 = Prüfsumme
