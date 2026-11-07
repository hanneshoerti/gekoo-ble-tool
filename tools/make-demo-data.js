// Erzeugt demo-data.js aus test/fixtures/session.txt (echter Mitschnitt).
import { readFileSync, writeFileSync } from 'node:fs';
import { FrameParser, wordsFromBlock } from '../gekoo.js';
const lines = readFileSync(new URL('../test/fixtures/session.txt', import.meta.url), 'utf8').trim().split('\n');
let now = ''; const live = []; let params;
const p = new FrameParser((f) => {
  if (f.cmd === 0x13 && !f.short && now >= '19:21:56' && now <= '19:22:40') live.push([...f.bytes]);
  if (f.cmd === 0x11 && !f.short) params = wordsFromBlock(f.bytes);
});
for (const l of lines) { const [t, d, ...b] = l.split(' '); now = t; if (d === 'RX') p.push(Uint8Array.from(b.map((h) => parseInt(h, 16)))); }
const step = live.filter((_, i) => i % 2 === 0);
writeFileSync(new URL('../demo-data.js', import.meta.url),
  `// Automatisch erzeugt (tools/make-demo-data.js) aus einem echten Mitschnitt.\n` +
  `export const DEMO_PARAMS = ${JSON.stringify(params)};\n` +
  `export const DEMO_LIVE = [\n${step.map((f) => '  ' + JSON.stringify(f)).join(',\n')}\n];\n`);
console.log('demo-data.js:', step.length, 'Live-Frames, Parameter', params.length, 'Wörter');
