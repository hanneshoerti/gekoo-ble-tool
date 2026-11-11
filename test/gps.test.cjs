// GPS-Vergleich: Demo (simuliertes GPS, Kalibrier-Messung) und echtes Browser-GPS ohne speed-Feld.
const { chromium } = require('playwright');
(async () => {
  const shots = process.argv[2] || '.';
  const browser = await chromium.launch();
  const errors = [];

  // 1) Demo-Modus
  const page = await browser.newPage({ viewport: { width: 400, height: 860 }, deviceScaleFactor: 2, colorScheme: 'dark' });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('http://localhost:8765/index.html#demo');
  await page.waitForFunction(() => document.getElementById('paramState').textContent.includes('Gelesen'), null, { timeout: 10000 });
  await page.click('nav button[data-tab=gps]');
  await page.waitForFunction(() => document.getElementById('cmpGps').textContent !== '–', null, { timeout: 5000 });
  await page.click('#measBtn');
  const t0 = Date.now();
  await page.waitForFunction(() => !document.getElementById('measResultRow').hidden, null, { timeout: 90000 });
  console.log('Messung fertig nach', Math.round((Date.now() - t0) / 1000), 's');
  console.log('Info:', await page.textContent('#measInfo'));
  console.log('Ergebnis:', await page.textContent('#measResult'));
  console.log('Vergleich:', await page.textContent('#cmpCtl'), 'vs', await page.textContent('#cmpGps'), '|', await page.textContent('#cmpDiff'), await page.textContent('#cmpDiffText'));
  await page.evaluate(() => document.querySelector('.toast')?.remove());
  await page.screenshot({ path: `${shots}/gps-vergleich.png` });
  await page.click('#measApply');
  console.log('übernommen:', await page.textContent('#measInfo'), '| tireCm =', await page.inputValue('#tireCm'));
  await page.close();

  // 2) Echtes Browser-GPS ohne speed (Fallback aus Positionen), 10 m pro Sekunde nach Norden = 36 km/h
  const ctx = await browser.newContext({ permissions: ['geolocation'], geolocation: { latitude: 47.0, longitude: 15.4, accuracy: 5 } });
  const p2 = await ctx.newPage();
  p2.on('pageerror', (e) => errors.push(e.message));
  await p2.goto('http://localhost:8765/index.html');
  await p2.click('#frOk').catch(() => {});
  await p2.click('nav button[data-tab=gps]');
  for (let i = 1; i <= 4; i++) {
    await p2.waitForTimeout(1000);
    await ctx.setGeolocation({ latitude: 47.0 + (i * 10) / 111195, longitude: 15.4, accuracy: 5 });
  }
  await p2.waitForTimeout(400);
  console.log('Browser-GPS:', await p2.textContent('#cmpGps'), 'km/h |', await p2.textContent('#gpsStatus'), '|', await p2.textContent('#gpsAcc'), '|', await p2.textContent('#cmpDiffText'));
  await p2.click('nav button[data-tab=live]');
  console.log('GPS gestoppt nach Tabwechsel:', await p2.evaluate(() => 'ok'));
  console.log('ERRORS', JSON.stringify(errors));
  await browser.close();
})();
