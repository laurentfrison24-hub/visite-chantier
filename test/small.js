const { chromium, devices } = require('playwright-core');
const path = require('path');
(async () => {
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true });
  // Compte-rendu
  const p0 = await b.newPage({ viewport: { width: 900, height: 1200 } });
  await p0.goto('file://' + path.join(__dirname, 'zip-out', 'compte-rendu.html'));
  await p0.screenshot({ path: '/tmp/compte-rendu.png', fullPage: true });
  // iPhone SE : éditeur
  const ctx = await b.newContext({ ...devices['iPhone SE'] });
  const p = await ctx.newPage();
  await p.goto('http://127.0.0.1:8765/');
  await p.click('#btn-new'); await p.waitForSelector('#view-chantier:not([hidden])');
  await p.fill('input[name=nom]', 'Test SE');
  await p.setInputFiles('#in-camera', path.join(__dirname, 'test-photo-portrait.jpg'));
  await p.waitForSelector('#photos .photo');
  await p.click('#photos .photo .photo-img'); await p.waitForSelector('#editor:not([hidden])');
  await p.waitForTimeout(400);
  const w = await p.locator('.width[data-width="2"]').boundingBox();
  const vw = p.viewportSize().width;
  console.log('SE viewport', vw, 'dernier bouton épaisseur fin à', Math.round(w.x + w.width), w.x + w.width <= vw ? 'OK' : 'DÉBORDE');
  await p.screenshot({ path: '/tmp/se-editor.png' });
  await b.close();
})();
