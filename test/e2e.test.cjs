// End-to-End-Test im Browser gegen den simulierten Controller (#demo).
const { chromium } = require('playwright');
(async () => {
  const shots = process.argv[2] || '.';
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto('http://localhost:8765/index.html#demo');
  await page.waitForFunction(() => document.getElementById('connText').textContent.includes('GEKOO'), null, { timeout: 8000 }); // AutoConnect
  await page.waitForFunction(() => document.getElementById('kmh').textContent !== '–', null, { timeout: 5000 });
  await page.waitForTimeout(2500);
  const live = await page.evaluate(() => ['kmh','rpm','gear','voltage','batteryCurrent','temperature','throttleV','aux12v','errorCode'].map(id => id + '=' + document.getElementById(id).textContent.trim()).join(' '));
  console.log('LIVE', live);
  await page.screenshot({ path: shots + '/live.png' });
  await page.click('nav button[data-tab=params]');
  await page.click('#readBtn');
  await page.waitForSelector('.prm');
  console.log('STATE', await page.textContent('#paramState'));
  const h = page.locator('.prm', { hasText: 'H: Höchstdrehzahl' }).locator('input');
  console.log('H vorher', await h.inputValue());
  await h.fill('689');
  await h.dispatchEvent('input');
  console.log('HINT', await page.locator('.prm', { hasText: 'H: Höchstdrehzahl' }).locator('.hint').textContent());
  await page.screenshot({ path: shots + '/params.png' });
  await page.click('#reviewBtn');
  await page.screenshot({ path: shots + '/review.png' });
  await page.check('#safeChk');
  await page.click('#confirmWrite');
  await page.waitForSelector('.toast.ok, .toast.bad', { timeout: 8000 });
  console.log('TOAST', await page.textContent('.toast'));
  console.log('H nachher', await h.inputValue(), 'savebar hidden:', await page.$eval('#savebar', (e) => e.hidden));
  // ungültige Eingabe
  await h.fill('99999'); await h.dispatchEvent('input');
  console.log('INVALID', await page.locator('.prm', { hasText: 'H: Höchstdrehzahl' }).locator('.err').textContent());
  await page.waitForTimeout(800);
  await page.click('nav button[data-tab=live]');
  await page.waitForTimeout(800);
  console.log('LIVE nach Schreiben', await page.textContent('#rpm'));
  console.log('ERRORS', JSON.stringify(errors));
  await browser.close();
})();
