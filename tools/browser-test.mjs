// Headless test: page + injected mock EIP-1193 provider forwarding to an anvil Base fork (impersonated deployer).
import { chromium } from '/workspace/multichain-dashboard/node_modules/playwright/index.mjs';
const FORK = process.argv[2] || 'http://127.0.0.1:8912', PAGE = process.argv[3] || 'http://127.0.0.1:8913/';
const D = '0xb19f00e095b1387061d73751c772bba848d196b1';
const rpc = async (m, p = []) => (await (await fetch(FORK, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: m, params: p }) })).json()).result;
await rpc('anvil_impersonateAccount', [D]); await rpc('anvil_setBalance', [D, '0x8AC7230489E80000']);
const b = await chromium.launch(); const pg = await b.newPage(); let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; };
pg.on('pageerror', e => { console.log('PAGEERROR', e.message); fail++; });
await pg.addInitScript(([fork, d]) => { window.ethereum = { isMetaMask: true, on() {}, async request({ method, params }) {
  if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [d]; if (method === 'wallet_switchEthereumChain') return null;
  const j = await (await fetch(fork, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })).json(); if (j.error) throw Object.assign(Error(j.error.message), { code: j.error.code }); return j.result; } }; }, [FORK, D]);
await pg.goto(PAGE + '?rpc=' + encodeURIComponent(FORK)); await pg.click('#btnConnect');
await pg.waitForFunction(() => !document.querySelector('#send1')?.disabled, null, { timeout: 30000 }); ok(true, 'step 1 enabled at nonce 28');
ok(await pg.locator('#send2').isDisabled(), 'step 2 disabled before step 1');
// nonce guard: simulate a stray tx
await rpc('anvil_setNonce', [D, '0x1d']); await pg.click('#btnRefresh'); await pg.waitForTimeout(2500);
ok(await pg.locator('#send1').isDisabled(), 'step 1 BLOCKED when nonce is 29 instead of 28'); ok((await pg.textContent('#nonceInfo')).includes('BLOCKED'), 'nonce warning shown');
await rpc('anvil_setNonce', [D, '0x1c']); await pg.click('#btnRefresh'); await pg.waitForFunction(() => !document.querySelector('#send1')?.disabled);
for (let s = 1; s <= 23; s++) { await pg.waitForFunction(n => document.querySelector('#send' + n) && !document.querySelector('#send' + n).disabled, s, { timeout: 30000 });
  await pg.click('#send' + s); await pg.waitForFunction(n => document.querySelector('#card' + n)?.textContent.includes('✓ done') || document.querySelector('#card' + n)?.querySelector('.bad'), s, { timeout: 60000 });
  const t = await pg.textContent('#card' + s); ok(t.includes('✓ done'), `step ${s} sent via page and detected done` + (t.includes('✓ done') ? '' : ' :: ' + t.slice(-200))); }
ok(await pg.locator('#send24').isDisabled(), 'step 24 disabled right after schedule'); ok((await pg.textContent('#card24')).includes('Unlocks at'), 'countdown shown');
await rpc('evm_increaseTime', [48 * 3600 + 5]); await rpc('evm_mine'); await pg.click('#btnRefresh');
await pg.waitForFunction(() => !document.querySelector('#send24')?.disabled, null, { timeout: 30000 }); await pg.click('#send24');
await pg.waitForFunction(() => document.querySelector('#card24')?.textContent.includes('✓ done'), null, { timeout: 60000 }); ok(true, 'step 24 executed via page');
ok((await pg.textContent('#nonceInfo')).includes('All 24 steps done'), 'all done banner');
await pg.reload(); await pg.waitForFunction(() => document.querySelector('#nonceInfo')?.textContent.includes('All 24'), null, { timeout: 30000 }); ok(true, 'reload resumes: all done from on-chain state');
await b.close(); console.log(fail ? fail + ' FAILURES' : 'ALL PASS'); process.exit(fail ? 1 : 0);
