// Live-Ansicht (Demo): AutoConnect, Tacho, Akku, Balken; Neuverbinden nach Abbruch; Screenshots hell/dunkel.
const { chromium } = require('playwright');
(async () => {
  const shots = process.argv[2] || '.';
  const browser = await chromium.launch();
  for (const scheme of ['dark', 'light']) {
    const page = await browser.newPage({ viewport: { width: 412, height: 915 }, colorScheme: scheme, deviceScaleFactor: scheme === 'dark' ? 2 : 1 });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('http://localhost:8765/index.html#demo');
    // AutoConnect: ohne Klick verbunden?
    await page.waitForFunction(() => document.getElementById('connText').textContent.includes('GEKOO'), null, { timeout: 5000 });
    await page.waitForTimeout(3500);   // Parameter lesen + bis in Stufe H
    const r = await page.evaluate(() => ({
      kmh: document.getElementById('kmh').textContent, rpm: document.getElementById('rpm').textContent,
      gear: document.querySelector('#gear .on')?.textContent, soc: document.getElementById('soc').textContent,
      cell: document.getElementById('cellV').textContent, needle: document.getElementById('needle').style.transform,
      ticks: document.querySelectorAll('#ticks .tick').length, limit: !!document.querySelector('#ticks .limit'),
      bars: ['power','batteryCurrent','phaseCurrent','fieldWeakening','throttleV','temperature'].map((id) => id + '=' + document.getElementById(id + 'Pct').textContent + '/' + document.getElementById(id + 'Max').textContent).join(' '),
      param: document.getElementById('paramState').textContent,
    }));
    console.log(scheme, JSON.stringify(r));
    await page.screenshot({ path: `${shots}/live-${scheme}.png` });
    if (scheme === 'dark') {
      // Abbruch simulieren → nach ~3 s automatisch neu verbunden
      await page.evaluate(() => window.__gekooMockDisconnect());
      await page.waitForTimeout(300);
      console.log('direkt nach Abbruch:', await page.textContent('#connText'), '| Knopf:', await page.textContent('#connectBtn'));
      await page.waitForFunction(() => document.getElementById('connText').textContent.includes('GEKOO'), null, { timeout: 8000 });
      const rpmBefore = await page.textContent('#rpm'); await page.waitForTimeout(1000);
      console.log('neu verbunden:', await page.textContent('#connText'), '| Live läuft:', rpmBefore !== await page.textContent('#rpm') || 'gleich', '| Listener doppelt?', await page.evaluate(() => document.getElementById('kmh').textContent));
      // Trennen-Knopf: kein Neuverbinden
      await page.click('#connectBtn');
      await page.waitForTimeout(4000);
      console.log('nach Trennen (soll getrennt bleiben):', await page.textContent('#connText'));
    }
    console.log('ERRORS', JSON.stringify(errors));
    await page.close();
  }
  await browser.close();
})();
