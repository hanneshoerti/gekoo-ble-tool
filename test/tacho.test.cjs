// Reifenumfang ändern → Tacho-Faktor berechnen → am (simulierten) Controller schreiben.
const { chromium } = require('playwright');
(async () => {
  const shots = process.argv[2] || '.';
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 412, height: 915 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('http://localhost:8765/index.html#demo');
  await page.click('nav button[data-tab=settings]');
  await page.waitForFunction(() => document.getElementById('connText').textContent.includes('GEKOO'), null, { timeout: 8000 }); // AutoConnect
  await page.waitForTimeout(500);
  await page.fill('#tireCm', '130'); await page.dispatchEvent('#tireCm', 'change');
  console.log('130 cm:', await page.textContent('#tachoInfo'), '| Knopf:', await page.textContent('#tachoApply'));
  await page.click('#tachoApply');
  await page.waitForSelector('#reviewDlg[open]');
  console.log('Dialog:', (await page.textContent('#diffBody')).replace(/\s+/g, ' ').trim());
  await page.screenshot({ path: shots + '/tacho-review.png' });
  await page.check('#safeChk'); await page.click('#confirmWrite');
  await page.waitForFunction(() => /überprüft|fehlgeschlagen/.test(document.querySelector('.toast')?.textContent || ''), null, { timeout: 8000 });
  console.log('Toast:', await page.textContent('.toast'));
  console.log('danach:', await page.textContent('#tachoInfo'), '| Knopf aktiv:', !(await page.isDisabled('#tachoApply')));
  // GPS-Kalibrierung: Tacho 48, GPS 50 → Faktor sollte auf ~140 steigen
  await page.click('#tachoBox summary');
  await page.fill('#calTacho', '48'); await page.fill('#calGps', '50');
  await page.click('#calBtn');
  console.log('Kalibrierung:', await page.textContent('.toast'), '| refCm =', await page.inputValue('#refCm'));
  console.log('Info:', await page.textContent('#tachoInfo'));
  await page.screenshot({ path: shots + '/tacho-settings.png', fullPage: true });
  console.log('ERRORS', JSON.stringify(errors));
  await browser.close();
})();
