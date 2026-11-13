// Skalierte Parameter (Gasgriff, Sanftanlauf) und Vergleich „seit dem letzten Lesen geändert“.
const { chromium } = require('playwright');
(async () => {
  const shots = process.argv[2] || '.';
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 400, height: 860 }, deviceScaleFactor: 2, colorScheme: 'dark' });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('http://localhost:8765/index.html#demo');
  await page.waitForFunction(() => document.getElementById('paramState').textContent.includes('Gelesen'), null, { timeout: 10000 });
  await page.waitForTimeout(24000);                   // ganzer Demo-Durchlauf: Griff losgelassen und Vollgas gesehen
  await page.click('nav button[data-tab=params]');
  const val = (name) => page.locator('.prm', { hasText: name }).locator('input');
  const vals = {};
  for (const n of ['Gasgriff: Leerlauf-Spannung', 'Gasgriff: Vollgas-Spannung', 'Sanftanlauf rückwärts']) vals[n] = await val(n).inputValue();
  const soft = page.locator('.prm').filter({ has: page.locator('.name', { hasText: /^Sanftanlauf$/ }) }).locator('input');
  vals.Sanftanlauf = await soft.inputValue();
  console.log('Werte:', JSON.stringify(vals), '| Vergleichs-Box sichtbar:', await page.isVisible('#extDiff'));
  // Gleichen Wert eintippen → keine Änderung (Rohwert bleibt 240)
  await soft.fill('0.88'); await soft.dispatchEvent('input');
  console.log('0,88 erneut eingegeben → Speicherleiste sichtbar:', await page.isVisible('#savebar'));
  // Ändern auf 1,00 s und Leerlauf zu niedrig (0,80 V) → Warnung
  await soft.fill('1.00'); await soft.dispatchEvent('input');
  const idle = val('Gasgriff: Leerlauf-Spannung'); await idle.fill('0.80'); await idle.dispatchEvent('input');
  await page.click('#reviewBtn');
  console.log('Dialog:', (await page.$$eval('#diffBody tr', (r) => r.map((x) => x.innerText.replace(/\s+/g, ' ')))).join(' | '));
  console.log('Warnungen:', JSON.stringify(await page.$$eval('#warnList li', (l) => l.map((x) => x.textContent))));
  await page.click('#cancelWrite');
  await idle.fill('1.00'); await idle.dispatchEvent('input');     // zurück auf den alten Wert
  await page.click('#reviewBtn'); await page.check('#safeChk'); await page.click('#confirmWrite');
  await page.waitForFunction(() => /überprüft|fehlgeschlagen/.test(document.querySelector('.toast')?.textContent || ''), null, { timeout: 8000 });
  console.log('Geschrieben:', await page.textContent('.toast'), '| Wort 5 im Controller =', await page.evaluate(() => window.__gekooMockGet(5)), '| Wort 4 =', await page.evaluate(() => window.__gekooMockGet(4)));
  console.log('Vergleichs-Box nach eigenem Schreiben sichtbar:', await page.isVisible('#extDiff'));
  // „Original-App“ ändert etwas: ein Schalter-Bit in Wort 29 und das Bremsmoment (Wort 22)
  await page.evaluate(() => { window.__gekooMockSet(29, window.__gekooMockGet(29) ^ 0x0008); window.__gekooMockSet(22, 6); });
  await page.click('#readBtn');
  await page.waitForSelector('#extDiff:not([hidden])');
  console.log('Vergleich:', (await page.$$eval('#extDiff li', (l) => l.map((x) => x.innerText.replace(/\s+/g, ' ')))).join(' || '));
  await page.evaluate(() => { document.querySelector('.toast')?.remove(); window.scrollTo(0, 0); });
  await page.screenshot({ path: `${shots}/vergleich.png` });
  console.log('ERRORS', JSON.stringify(errors));
  await browser.close();
})();
