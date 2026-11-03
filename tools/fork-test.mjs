// Drives every plan step through an anvil FORK of Base (impersonated deployer). Never touches mainnet state.
// Usage: node tools/fork-test.mjs http://127.0.0.1:8911 [plan.js]          (Base)
//        node tools/fork-test.mjs http://127.0.0.1:8912 ethereum/plan.js  (Ethereum fork)
import fs from 'node:fs'; import vm from 'node:vm';
const RPC = process.argv[2] || 'http://127.0.0.1:8911';
const ctx = { window: {} }; vm.runInNewContext(fs.readFileSync(process.argv[3] || 'plan.js', 'utf8'), ctx); const PL = ctx.window.PLAN;
let id = 0; const rpc = async (m, p = []) => { const j = await (await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method: m, params: p }) })).json(); if (j.error) throw Error(m + ': ' + JSON.stringify(j.error)); return j.result; };
const ethCall = c => rpc('eth_call', [{ to: c.to, data: c.data }, 'latest']).catch(() => '0x');
async function done(ch) { if (ch.type === 'code') return (await rpc('eth_getCode', [ch.to, 'latest'])).length > 2;
  if (ch.type === 'eq') return (await ethCall(ch)).toLowerCase() === ch.expect; if (ch.type === 'nonzero') { const r = await ethCall(ch); return r.length > 2 && BigInt(r) > 0n; }
  const r = await Promise.all(ch.of.map(c => ethCall(c).then(x => x.toLowerCase() === c.expect))); return ch.type === 'all' ? r.every(Boolean) : r.some(Boolean); }
if (Number(await rpc('eth_chainId')) !== PL.chainId) throw Error('fork chainId is not ' + PL.chainId);
const D = PL.deployer; await rpc('anvil_impersonateAccount', [D]); await rpc('anvil_setBalance', [D, '0xD3C21BCECCEDA1000000']);
const gas = {}; let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; };
ok(Number(await rpc('eth_getTransactionCount', [D, 'latest'])) === PL.startNonce, 'start nonce ' + PL.startNonce);
for (const s of PL.steps) {
  ok(!(await done(s.check)), `step ${s.step} not done before`);
  if (s.step === 24) { const ts = BigInt(await ethCall({ to: PL.predicted.timelock, data: '0xd45c4435' + s.opId.slice(2) }));
    let early = false; try { await rpc('eth_estimateGas', [{ from: D, to: s.to, data: s.data }]); early = true; } catch {} ok(!early, 'step 24 reverts before 48h');
    await rpc('evm_increaseTime', [48 * 3600 + 5]); await rpc('evm_mine'); }
  const n = Number(await rpc('eth_getTransactionCount', [D, 'latest'])); ok(n === s.expectedNonce, `step ${s.step} nonce ${n} == ${s.expectedNonce}`);
  const tx = { from: D, data: s.data, value: '0x' + BigInt(s.value).toString(16) }; if (s.to) tx.to = s.to;
  const h = await rpc('eth_sendTransaction', [tx]); let r; while (!(r = await rpc('eth_getTransactionReceipt', [h]))) await new Promise(r => setTimeout(r, 200));
  ok(r.status === '0x1', `step ${s.step} mined status ${r.status} gas ${Number(r.gasUsed)}`); gas[s.step] = Number(r.gasUsed);
  if (s.creates) ok(r.contractAddress.toLowerCase() === s.creates.toLowerCase(), `step ${s.step} created ${r.contractAddress} == predicted`);
  ok(await done(s.check), `step ${s.step} on-chain done-check true`);
}
const sel = s => ({ owner: '0x8da5cb5b', pendingOwner: '0xe30c3978' }[s]);
const P = PL.predicted, a = d => ethCall(d).then(x => '0x' + x.slice(26).toLowerCase());
ok(await a({ to: P.factory, data: sel('owner') }) === P.timelock.toLowerCase(), 'factory owner = timelock');
ok(await a({ to: P.factory, data: sel('pendingOwner') }) === '0x' + '0'.repeat(40), 'factory pendingOwner cleared');
ok(await a({ to: P.omniEscrow, data: sel('owner') }) === P.timelock.toLowerCase(), 'escrow owner = timelock');
const viem = await import('/workspace/multichain-dashboard/node_modules/viem/_esm/index.js');
const c = viem.createPublicClient({ transport: viem.http(RPC) }); const ab = viem.parseAbi(['function approver() view returns (address)', 'function feeWallet() view returns (address)', 'function platformFeeBps() view returns (uint16)', 'function peers(uint32) view returns (bytes32)', 'function hasRole(bytes32,address) view returns (bool)', 'function getMinDelay() view returns (uint256)']);
const rd = (address, functionName, args = []) => c.readContract({ address, abi: ab, functionName, args });
ok((await rd(P.factory, 'approver')).toLowerCase() === D, 'approver = deployer wallet');
ok((await rd(P.factory, 'feeWallet')) === PL.feeWallet && PL.feeWallet === '0x25411039F77529A543344603bD8acdd65fABA4d0', 'factory feeWallet = 0x2541…a4d0');
ok(Number(await rd(P.factory, 'platformFeeBps')) === 50, 'platformFeeBps = 50');
ok(Number(await rd(P.timelock, 'getMinDelay')) === 172800, 'timelock delay 48h');
for (const [k, o] of Object.entries(PL.others)) { const eid = { base: 30184, ethereum: 30101, bnb: 30102, apechain: 30312, robinhood: 30416 }[k]; ok((await rd(P.omniEscrow, 'peers', [eid])).toLowerCase() === '0x' + o.escrow.slice(2).toLowerCase().padStart(64, '0'), `peer ${k} eid ${eid} = ${o.escrow}`); }
fs.writeFileSync(PL.chainId === 8453 ? 'tools/gas-hints.json' : `tools/gas-hints-${PL.chain.key}.json`, JSON.stringify(gas, null, 1));
console.log('total gasUsed', Object.values(gas).reduce((a, b) => a + b, 0), fail ? `\n${fail} FAILURES` : '\nALL PASS'); process.exit(fail ? 1 : 0);
