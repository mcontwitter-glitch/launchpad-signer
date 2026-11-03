// Screenshots of the live-read pages (no wallet). Serve the repo on 127.0.0.1:8913 first.
import { chromium } from '/workspace/multichain-dashboard/node_modules/playwright/index.mjs';
const b = await chromium.launch();
for (const [chain, path] of [['base', '/'], ['ethereum', '/ethereum/'], ['bnb', '/bnb/'], ['apechain', '/apechain/'], ['robinhood', '/robinhood/']])
for (const [n, o] of [['desktop', { viewport: { width: 1280, height: 900 } }], ['mobile', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }]]) {
  const p = await b.newPage(o); await p.goto('http://127.0.0.1:8913' + path); await p.waitForFunction(() => window.__cost, null, { timeout: 60000 }).catch(() => console.log(chain, n, 'no __cost yet')); await p.waitForTimeout(3000);
  const pre = chain === 'base' ? '' : chain + '-';
  await p.screenshot({ path: `screens/${pre}${n}.png`, fullPage: n === 'desktop' }); if (n === 'mobile') await p.screenshot({ path: `screens/${pre}mobile-full.png`, fullPage: true });
  console.log(chain, n, JSON.stringify(await p.evaluate(() => window.__cost)), '|', await p.textContent('#othersInfo'), '|', await p.textContent('#nonceInfo'), '|', await p.textContent('#costInfo')); }
await b.close();
