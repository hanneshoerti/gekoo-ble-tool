// Testet android-bridge.js mit einem gefälschten window.GekooNative,
// das sich wie MainActivity.java verhält (Hex-Strings, __gekooResolve, __gekooNotify).
const { chromium } = require('playwright');
const FAKE_NATIVE = `
window.__calls = [];
window.GekooNative = (() => {
  let dev, chr;
  const bt = import('/mock-device.js').then((m) => { const w = { navigator: {} }; m.installMockBluetooth(w); return w.navigator.bluetooth; });
  const R = (id, ok, v) => setTimeout(() => window.__gekooResolve(id, ok, v), 5);
  const hex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return {
    requestDevice(id) { window.__calls.push('requestDevice'); bt.then((b) => b.requestDevice()).then((d) => { dev = d; R(id, true, 'GEKOO-BLE'); }); },
    connect(id) { window.__calls.push('connect');
      dev.gatt.connect().then((s) => s.getPrimaryService()).then((s) => s.getCharacteristic()).then((c) => {
        chr = c; c.addEventListener('characteristicvaluechanged', (e) => window.__gekooNotify(hex(new Uint8Array(e.target.value.buffer))));
        R(id, true, ''); }); },
    startNotifications(id) { window.__calls.push('startNotifications'); R(id, true, ''); },
    write(id, h) { if (typeof h !== 'string' || /[^0-9a-f]/.test(h)) throw new Error('bad hex ' + h);
      chr.writeValueWithoutResponse(Uint8Array.from(h.match(/../g).map((x) => parseInt(x, 16)))); R(id, true, ''); },
    disconnect() { window.__calls.push('disconnect'); },
    saveFile(n, t) { window.__saved = { n, t }; return 'Download/Gekoo/' + n; },
  };
})();`;
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 412, height: 915 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.addInitScript(FAKE_NATIVE);
  await page.goto('http://localhost:8766/index.html');
  console.log('noBt hidden:', await page.$eval('#noBt', (e) => e.hidden));
  await page.waitForFunction(() => document.getElementById('connText').textContent.includes('GEKOO'), null, { timeout: 8000 }); // AutoConnect
  await page.waitForFunction(() => document.getElementById('kmh').textContent !== '–', null, { timeout: 5000 });
  await page.waitForTimeout(1500);
  console.log('LIVE', await page.textContent('#kmh'), 'km/h', await page.textContent('#rpm'), 'rpm, Gang', (await page.textContent('#gear')).trim());
  console.log('connText', await page.textContent('#connText'));
  await page.click('nav button[data-tab=params]');
  await page.click('#readBtn');
  await page.waitForSelector('.prm');
  await page.click('#backupBtn');
  const saved = await page.evaluate(() => window.__saved && { n: window.__saved.n, words: JSON.parse(window.__saved.t).words.length });
  console.log('BACKUP', JSON.stringify(saved), '| Toast:', await page.textContent('.toast'));
  const f = page.locator('.prm', { hasText: 'Tacho-Korrekturfaktor' }).locator('input');
  await f.fill('138'); await f.dispatchEvent('input');
  await page.click('#reviewBtn'); await page.check('#safeChk'); await page.click('#confirmWrite');
  await page.waitForFunction(() => /überprüft|fehlgeschlagen/.test(document.querySelector('.toast')?.textContent || ''), null, { timeout: 8000 });
  console.log('WRITE', await page.textContent('.toast'), '| Original jetzt', await page.locator('.prm', { hasText: 'Tacho-Korrekturfaktor' }).locator('.meta').textContent());
  await page.click('#connectBtn');
  console.log('nach Trennen:', await page.textContent('#connText'), 'calls', JSON.stringify(await page.evaluate(() => window.__calls)));
  // Verbindungsabbruch von nativer Seite
  await page.click('#connectBtn');
  await page.waitForTimeout(800);
  await page.evaluate(() => window.__gekooDisconnected());
  await page.waitForTimeout(300);
  console.log('nach Abbruch:', await page.textContent('#connText'), await page.textContent('#connectBtn'));
  console.log('ERRORS', JSON.stringify(errors));
  await browser.close();
})();
