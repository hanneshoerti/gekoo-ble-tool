// Spielt einen echten Mitschnitt (App ↔ Controller) durch das Protokoll-Modul.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { FrameParser, decodeRealtime, wordsFromBlock, checksumOk, buildWriteFrame, chunks } from '../gekoo.js';

const lines = readFileSync(new URL('./fixtures/session.txt', import.meta.url), 'utf8').trim().split('\n');
const hex = (s) => Uint8Array.from(s.split(' ').map((h) => parseInt(h, 16)));
const rx = [], tx = [];
let now = '';
const prx = new FrameParser((f) => rx.push({ ...f, t: now }));
for (const l of lines) {
  const [t, dir, ...b] = l.split(' ');
  const bytes = hex(b.join(' '));
  now = t;
  if (dir === 'RX') prx.push(bytes); else tx.push({ t, bytes });
}
const count = (c, short) => rx.filter((f) => f.cmd === c && f.short === short).length;
assert.equal(count(0x13, false), 2483, 'Live-Frames');
assert.equal(count(0x11, false), 15, 'Parameterblöcke');
assert.equal(count(0x12, true), 11, 'Schreib-Bestätigungen');
assert.ok(rx.filter((f) => f.cmd === 0x12).every((f) => f.bytes[3] === 0xaa));

// Alle gelesenen Blöcke haben gültige Prüfsumme
const blocks = rx.filter((f) => f.cmd === 0x11).map((f) => wordsFromBlock(f.bytes));
assert.ok(blocks.every(checksumOk), 'Prüfsumme gelesener Blöcke');

// Die von der App gesendeten Schreib-Frames lassen sich exakt nachbauen
let buf = [];
const writes = [];
for (const { bytes } of tx) {
  if (bytes[0] === 0xaa && bytes[1] === 0x12) buf = [...bytes];
  else if (buf.length) buf.push(...bytes);
  if (buf.length === 131) { writes.push(Uint8Array.from(buf)); buf = []; }
}
assert.equal(writes.length, 11);
for (const w of writes) {
  const words = wordsFromBlock(w);
  const rebuilt = buildWriteFrame(words);
  assert.deepEqual([...rebuilt], [...w], 'Schreib-Frame identisch');
  assert.deepEqual([...chunks(rebuilt)].map((c) => c.length), [20, 20, 20, 20, 20, 20, 11]);
}

// Live-Werte gegen die Screenshots der Original-App (Gang H, Vollgas, ~19:22:28)
const live = rx.filter((f) => f.cmd === 0x13 && !f.short).map((f) => ({ t: f.t, ...decodeRealtime(f.bytes) }));
const h = live.filter((d) => d.t >= '19:22:22' && d.t <= '19:22:30' && d.gear === 'H');
assert.ok(h.length > 10);
const avg = (k) => h.reduce((a, d) => a + d[k], 0) / h.length;
const near = (v, want, tol) => assert.ok(Math.abs(v - want) <= tol, `${v} ≈ ${want}`);
near(avg('rpm'), 860, 8);
near(avg('voltage'), 49.5, 0.6);
near(avg('throttleV'), 3.42, 0.15);
near(avg('aux12v'), 14.37, 0.15);
near(avg('fieldWeakening'), 61.3, 1.5);
near(avg('batteryCurrent'), 11, 1.5);
near(avg('kmh'), 68.6, 1);
console.log('OK –', live.length, 'Live-Frames,', blocks.length, 'Parameterblöcke,', writes.length, 'Schreibvorgänge geprüft');
console.log('Beispiel H-Gang:', Object.fromEntries(Object.entries(h[0]).filter(([k]) => !['words', 't'].includes(k)).map(([k, v]) => [k, typeof v === 'number' ? +v.toFixed(2) : v])));

// Fehlerfall aus der ersten APK: nur das erste 20-Byte-Stück jeder Antwort kommt an.
// Erwartung: keine falsch zusammengesetzten Frames, nichts Ungültiges wird angezeigt.
{
  const out = [];
  const p2 = new FrameParser((f) => out.push(f));
  for (const l of lines) {
    const [, dir, ...b] = l.split(' ');
    if (dir === 'RX' && b[0] === 'aa' && b[1] === '13' && b.length === 20) p2.push(hex(b.join(' ')));
  }
  const shown = out.filter((f) => f.cmd === 0x13 && !f.short).map((f) => decodeRealtime(f.bytes)).filter((d) => d.valid);
  assert.equal(shown.length, 0, 'keine Müll-Frames bei verlorenen Stücken');
  assert.ok(p2.dropped > 2000, 'unvollständige Frames werden verworfen');
  assert.ok(live.every((d) => d.valid), 'alle echten Frames gelten als gültig');
  console.log('OK – Fehlerfall "nur erstes Stück":', p2.dropped, 'unvollständige Frames verworfen, 0 angezeigt');
}
