import { chromium } from '/workspace/multichain-dashboard/node_modules/playwright/index.mjs';
const b = await chromium.launch();
for (const [n, o] of [['desktop', { viewport: { width: 1280, height: 900 } }], ['mobile', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }]]) {
  const p = await b.newPage(o); await p.goto('http://127.0.0.1:8913/'); await p.waitForFunction(() => window.__cost, null, { timeout: 60000 }); await p.waitForTimeout(3000);
  await p.screenshot({ path: `screens/${n}.png`, fullPage: n === 'desktop' }); if (n === 'mobile') await p.screenshot({ path: 'screens/mobile-full.png', fullPage: true });
  console.log(n, JSON.stringify(await p.evaluate(() => window.__cost)), await p.textContent('#othersInfo'), await p.textContent('#nonceInfo')); }
await b.close();
